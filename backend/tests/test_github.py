import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters.tasks import github as github_adapter
from app.adapters.tasks.github import GitHubApi, GitHubReaders, SharedGitHub, to_task
from app.config import Settings
from app.domain.boards import BoardDoc
from app.domain.errors import (
    TaskNotFound,
    TooManyRepositories,
    TrackerRateLimited,
    TrackerUnavailable,
    TrackerUnreachable,
)
from app.domain.tasks import github_key, valid_key
from app.main import create_app
from tests.conftest import signed_in
from tests.github_fake import REPO, T_ANN, T_BOB, TOKEN, FakeGitHub, issue


class Clock:
    def __init__(self) -> None:
        self.now = 1_000_000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def fake() -> FakeGitHub:
    return FakeGitHub()


@pytest.fixture
def clock() -> Clock:
    return Clock()


def reader(fake: FakeGitHub, clock: Clock, token: str | None = None) -> SharedGitHub:
    client = httpx.Client(transport=httpx.MockTransport(fake), follow_redirects=True)
    return SharedGitHub(GitHubApi(client, token, clock), clock)


@pytest.mark.parametrize(
    ("ref", "key"),
    [
        ("octo-org/widgets#12", "octo-org/widgets#12"),
        (" https://github.com/octo-org/widgets/issues/12 ", "octo-org/widgets#12"),
        ("https://github.com/octo-org/widgets/pull/7/files", "octo-org/widgets#7"),
        ("https://www.github.com/octo-org/widgets/issues/12#issuecomment-1", "octo-org/widgets#12"),
        ("https://github.com/octo-org/widgets.js/issues/3?q=1", "octo-org/widgets.js#3"),
    ],
)
def test_github_links_and_keys(ref, key):
    assert github_key(ref) == key


@pytest.mark.parametrize(
    "ref",
    [
        "DEV-1",
        "widgets#12",
        "octo-org/widgets#0",
        "https://github.com/octo-org/widgets",
        "https://github.com/octo-org/widgets/discussions/5",
        "https://example.com/octo-org/widgets/issues/12",
        "https://jira.example.com/browse/DEV-1",
    ],
)
def test_other_refs_are_not_github(ref):
    assert github_key(ref) is None


def test_a_key_is_checked_by_its_tracker():
    assert valid_key("github", "octo-org/widgets#12")
    assert not valid_key("github", "DEV-1")
    assert valid_key(None, "DEV-1")
    assert not valid_key(None, "octo-org/widgets#12")
    assert not valid_key("jira", "octo-org/widgets#12")


def node(data: dict) -> dict:
    return {"id": "a", "type": "jira_card", "position": {"x": 0, "y": 0}, "data": data}


def test_a_board_takes_github_keys_on_github_cards_only():
    BoardDoc.model_validate({"nodes": [node({"key": "octo-org/widgets#12", "source": "github"})]})
    BoardDoc.model_validate({"nodes": [node({"key": "DEV-1"})]})
    for data in ({"key": "octo-org/widgets#12"}, {"key": "DEV-1", "source": "github"}):
        with pytest.raises(ValueError, match="invalid issue key"):
            BoardDoc.model_validate({"nodes": [node(data)]})


PULL = {"pull_request": {"merged_at": None}}


@pytest.mark.parametrize(
    ("fields", "status", "category", "kind"),
    [
        ({}, "Open", "new", "Issue"),
        (
            {"labels": [{"name": "bug"}, {"name": "In Progress"}]},
            "In Progress",
            "indeterminate",
            "Issue",
        ),
        ({"labels": [{"name": "planned"}]}, "planned", "new", "Issue"),
        ({"labels": [{"name": "shipped"}]}, "shipped", "done", "Issue"),
        ({"state": "closed", "state_reason": "completed"}, "Closed", "done", "Issue"),
        ({"state": "closed", "labels": [{"name": "planned"}]}, "Closed", "done", "Issue"),
        ({"state": "closed", "state_reason": "not_planned"}, "Not planned", "done", "Issue"),
        ({"state": "closed", "state_reason": "duplicate"}, "Duplicate", "done", "Issue"),
        (PULL, "Open", "indeterminate", "Pull request"),
        (PULL | {"draft": True}, "Draft", "indeterminate", "Pull request"),
        (PULL | {"labels": [{"name": "planned"}]}, "Open", "indeterminate", "Pull request"),
        (PULL | {"state": "closed"}, "Closed", "done", "Pull request"),
        (
            {"state": "closed", "pull_request": {"merged_at": "2026-10-01T09:00:00Z"}},
            "Merged",
            "done",
            "Pull request",
        ),
    ],
)
def test_status_from_state_and_labels(fields, status, category, kind):
    task = to_task(f"{REPO}#5", issue(5, **fields))
    assert (task.status_name, task.status_category, task.type_name) == (status, category, kind)
    assert (task.source, task.key, task.assignee_name) == ("github", f"{REPO}#5", "alex-rivera")
    assert task.priority_name is None


def test_resolve_reads_one_issue_and_takes_githubs_name(fake, clock):
    task = reader(fake, clock).resolve("Octo-Org/Widgets#1")
    assert (task.key, task.summary) == (f"{REPO}#1", "Title of #1")
    assert task.url == f"https://github.com/{REPO}/issues/1"
    assert fake.paths() == ["/repos/Octo-Org/Widgets/issues/1"]


@pytest.mark.parametrize("key", [f"{REPO}#99", "octo-org/nothing#1"])
def test_resolve_of_a_missing_task(fake, clock, key):
    with pytest.raises(TaskNotFound):
        reader(fake, clock).resolve(key)


def test_poll_asks_once_per_repository_and_answers_from_memory(fake, clock):
    github = reader(fake, clock)
    keys = [f"{REPO}#1", f"{REPO}#2", f"{REPO}#99"]
    tasks = github.poll(keys)
    assert [(t.key, t.state) for t in tasks] == [
        (f"{REPO}#1", "ok"),
        (f"{REPO}#2", "ok"),
        (f"{REPO}#99", "not_found"),
    ]
    assert fake.paths() == [f"/repos/{REPO}/issues"]
    clock.now += 30
    fake.repos[REPO][1] = issue(1, state="closed")
    # Not due yet: one repository without a token is asked every 75 seconds.
    assert github.poll(keys)[0].status_name == "Open"
    assert len(fake.requests) == 1
    clock.now += 50
    assert github.poll(keys)[0].status_name == "Closed"
    assert len(fake.requests) == 2


def test_a_card_keeps_the_key_it_was_added_with(fake, clock):
    assert reader(fake, clock).poll(["OCTO-ORG/widgets#1"])[0].key == "OCTO-ORG/widgets#1"


def test_more_repositories_wait_longer(fake, clock):
    for n in range(8):
        fake.repos[f"octo-org/repo-{n}"] = {1: issue(1, f"octo-org/repo-{n}")}
    github = reader(fake, clock)
    keys = [f"octo-org/repo-{n}#1" for n in range(8)]
    github.poll(keys)
    assert len(fake.requests) == 8
    # Eight repositories share 48 requests an hour: each is due every 10 minutes.
    clock.now += 590
    github.poll(keys)
    assert len(fake.requests) == 8
    clock.now += 20
    github.poll(keys)
    assert len(fake.requests) == 16


def test_an_hour_of_three_boards_stays_inside_the_limit(fake, clock):
    for n in range(5):
        fake.repos[f"octo-org/repo-{n}"] = {1: issue(1, f"octo-org/repo-{n}")}
    github = reader(fake, clock)
    boards = [[f"octo-org/repo-{n}#1" for n in range(5)]] * 3
    for _ in range(120):
        for keys in boards:
            assert len(github.poll(keys)) == 5
        clock.now += 30
    assert len(fake.requests) <= 60 * (1 - 0.2) + 5


def test_a_long_list_of_due_repositories_is_spread_over_refreshes(fake, clock):
    for n in range(25):
        fake.repos[f"octo-org/repo-{n}"] = {1: issue(1, f"octo-org/repo-{n}")}
    fake.limit = fake.remaining = 5000
    github = reader(fake, clock, TOKEN)
    keys = [f"octo-org/repo-{n}#1" for n in range(25)]
    assert len(github.poll(keys)) == 10
    assert len(github.poll(keys)) == 20
    assert len(github.poll(keys)) == 25


def many(count: int) -> dict[int, dict]:
    return {
        n: issue(n, updated_at=f"2026-10-01T09:{n // 60:02d}:{n % 60:02d}Z")
        for n in range(1, count + 1)
    }


def test_tasks_the_page_does_not_reach_are_read_one_by_one(fake, clock):
    fake.repos[REPO] = many(150)
    github = reader(fake, clock)
    # The page holds the 100 newest; 1, 2, 3 and 4 are older and wait their turn, three a turn.
    keys = [f"{REPO}#{n}" for n in (1, 2, 3, 4, 150)]
    assert {t.key for t in github.poll(keys)} == {f"{REPO}#{n}" for n in (1, 2, 3, 150)}
    assert len(fake.requests) == 4
    # The three extra reads are paid for: the next turn waits four shares of the limit.
    clock.now += 290
    github.poll(keys)
    assert len(fake.requests) == 4
    clock.now += 20
    assert len(github.poll(keys)) == 5


def test_reads_one_by_one_stay_inside_the_hourly_limit(fake, clock):
    fake.repos[REPO] = many(150)
    github = reader(fake, clock)
    keys = [f"{REPO}#{n}" for n in range(1, 46)]
    for _ in range(120):
        github.poll(keys)
        clock.now += 30
    assert len(fake.requests) <= 60 * (1 - 0.2) + 4
    assert len(github.poll(keys)) > 30


def test_repositories_of_closed_boards_do_not_slow_the_rest(fake, clock):
    for n in range(20):
        fake.repos[f"octo-org/repo-{n}"] = {1: issue(1, f"octo-org/repo-{n}")}
    github = reader(fake, clock)
    github.poll([f"octo-org/repo-{n}#1" for n in range(20)])
    clock.now += 3700
    github.poll([f"{REPO}#1"])
    asked = len(fake.requests)
    # One repository is left, so it is due every 75 seconds again.
    clock.now += 80
    github.poll([f"{REPO}#1"])
    assert len(fake.requests) == asked + 1


def test_a_deleted_task_the_list_does_not_reach_is_found_out(fake, clock):
    fake.repos[REPO] = many(150)
    github = reader(fake, clock)
    assert github.poll([f"{REPO}#1"])[0].state == "ok"
    del fake.repos[REPO][1]
    clock.now += 1800
    assert github.poll([f"{REPO}#1"])[0].state == "ok"
    for _ in range(12):
        clock.now += 1800
        github.poll([f"{REPO}#1"])
    assert github.poll([f"{REPO}#1"])[0].state == "not_found"


def test_unchanged_repository_costs_nothing_with_a_token(fake, clock):
    fake.limit = fake.remaining = 5000
    github = reader(fake, clock, TOKEN)
    github.poll([f"{REPO}#1"])
    clock.now += 30
    assert github.poll([f"{REPO}#1"])[0].state == "ok"
    assert fake.requests[-1].headers["if-none-match"]
    assert github.source_note is None


def test_the_server_token_never_opens_a_private_repository(fake, clock):
    fake.private.add(REPO)
    fake.limit = fake.remaining = 5000
    github = reader(fake, clock, TOKEN)
    with pytest.raises(TaskNotFound):
        github.resolve(f"{REPO}#1")
    assert [t.state for t in github.poll([f"{REPO}#1"])] == ["no_token"]
    assert f"/repos/{REPO}/issues" not in fake.paths()


def test_a_repository_made_private_stops_being_served_at_once(fake, clock):
    fake.limit = fake.remaining = 5000
    github = reader(fake, clock, TOKEN)
    assert github.poll([f"{REPO}#1"])[0].summary == "Title of #1"
    fake.private.add(REPO)
    clock.now += 60
    hidden = github.poll([f"{REPO}#1"])[0]
    assert (hidden.state, hidden.summary) == ("no_token", "")
    with pytest.raises(TaskNotFound):
        github.resolve(f"{REPO}#2")
    fake.private.clear()
    clock.now += 60
    assert github.poll([f"{REPO}#1"])[0].state == "ok"


def test_a_used_up_limit_waits_for_the_reset_without_asking(fake, clock):
    github = reader(fake, clock)
    github.poll([f"{REPO}#1"])
    fake.remaining = 0
    fake.reset = int(clock.now) + 600
    clock.now += 80
    with pytest.raises(TrackerRateLimited) as limited:
        github.poll([f"{REPO}#1"])
    assert 500 < limited.value.retry_after <= 600
    assert "GITHUB_TOKEN" in limited.value.message
    asked = len(fake.requests)
    clock.now += 300
    with pytest.raises(TrackerRateLimited):
        github.resolve(f"{REPO}#2")
    assert len(fake.requests) == asked
    fake.remaining = 60
    clock.now += 301
    assert github.poll([f"{REPO}#1"])[0].state == "ok"


def test_outage_and_no_network(fake, clock):
    fake.fail = 502
    with pytest.raises(TrackerUnavailable):
        reader(fake, clock).poll([f"{REPO}#1"])

    def down(request):
        raise httpx.ConnectError("no route")

    client = httpx.Client(transport=httpx.MockTransport(down))
    with pytest.raises(TrackerUnreachable):
        SharedGitHub(GitHubApi(client, None, clock), clock).poll([f"{REPO}#1"])


def test_a_cap_on_repositories(fake, clock, monkeypatch):
    monkeypatch.setattr(github_adapter, "MAX_REPOS", 1)
    github = reader(fake, clock)
    github.resolve(f"{REPO}#1")
    with pytest.raises(TooManyRepositories):
        github.resolve("octo-org/other#1")
    # A board over the cap keeps what is followed and leaves the rest for later.
    assert len(github.poll([f"{REPO}#1", "octo-org/other#1"])) == 1
    # A repository nobody asked about for an hour gives its place away.
    clock.now += 3700
    fake.repos["octo-org/other"] = {1: issue(1, "octo-org/other")}
    assert github.resolve("octo-org/other#1").state == "ok"


@pytest.fixture
def app_client(fake):
    settings = Settings(db_path=":memory:", tiko_secret_key="test-secret-key")
    return signed_in(create_app(settings, github_transport=httpx.MockTransport(fake)))


def board_with(client, *keys: str) -> str:
    board_id = client.post("/api/boards", json={"name": "b"}).json()["id"]
    nodes = [
        {
            "id": f"n{i}",
            "type": "jira_card",
            "position": {"x": 0, "y": 0},
            "data": {"key": key, "source": "github" if "#" in key else "demo"},
        }
        for i, key in enumerate(keys)
    ]
    saved = client.put(f"/api/boards/{board_id}", json={"version": 1, "doc": {"nodes": nodes}})
    assert saved.status_code == 200, saved.text
    return board_id


def test_a_github_link_is_a_task_on_any_instance(app_client):
    link = f"https://github.com/{REPO}/issues/1"
    body = app_client.post("/api/tasks/resolve", json={"ref": link}).json()
    assert (body["task"]["source"], body["task"]["key"]) == ("github", f"{REPO}#1")
    assert (
        app_client.post("/api/tasks/resolve", json={"ref": "DEMO-1"}).json()["task"]["source"]
        == "demo"
    )
    missing = app_client.post("/api/tasks/resolve", json={"ref": f"{REPO}#99"})
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "task_not_found")


def test_github_tasks_refresh_next_to_the_demo_ones(app_client, fake):
    board_id = board_with(app_client, f"{REPO}#1", "DEMO-1")
    body = app_client.post(f"/api/boards/{board_id}/refresh").json()
    assert set(body["tasks"]) == {f"github:{REPO}#1", "demo:DEMO-1"}
    github = next(s for s in body["sources"] if s["id"] == "github")
    assert (github["name"], github["state"]) == ("GitHub", "ok")
    assert github["note"] == "Updates every few minutes without a token"
    assert app_client.get(f"/api/boards/{board_id}").json()["tasks"][f"github:{REPO}#1"]["summary"]


def test_a_used_up_limit_leaves_the_other_trackers_alone(app_client, fake):
    board_id = board_with(app_client, f"{REPO}#1", "DEMO-1")
    fake.remaining = 0
    body = app_client.post(f"/api/boards/{board_id}/refresh").json()
    assert set(body["tasks"]) == {"demo:DEMO-1"}
    states = {s["id"]: s for s in body["sources"]}
    assert states["demo"]["state"] == "ok"
    assert states["github"]["error"]["code"] == "tracker_rate_limited"
    assert states["github"]["error"]["retry_after"] > 0


def test_a_guest_sees_public_github_tasks_in_full(app_client, fake):
    fake.repos["octo-org/secret"] = {1: issue(1, "octo-org/secret")}
    fake.private.add("octo-org/secret")
    board_id = board_with(app_client, f"{REPO}#1", "octo-org/secret#1")
    link = app_client.put(f"/api/boards/{board_id}/public", json={"public": True}).json()
    token = link["public_token"]
    guest = TestClient(app_client.app)
    tasks = guest.get(f"/api/public/{token}").json()["tasks"]
    assert tasks[f"github:{REPO}#1"]["summary"] == "Title of #1"
    hidden = tasks["github:octo-org/secret#1"]
    assert (hidden["state"], hidden["summary"]) == ("private", "")
    body = guest.post(f"/api/public/{token}/refresh").json()
    assert [s["id"] for s in body["sources"]] == ["github"]


def test_a_guest_is_told_when_github_fails(app_client, fake):
    board_id = board_with(app_client, f"{REPO}#1", "DEMO-1")
    link = app_client.put(f"/api/boards/{board_id}/public", json={"public": True}).json()
    fake.remaining = 0
    body = TestClient(app_client.app).post(f"/api/public/{link['public_token']}/refresh").json()
    states = {s["id"]: s for s in body["sources"]}
    assert states["demo"]["state"] == "ok"
    assert states["github"]["error"]["code"] == "tracker_rate_limited"
    assert states["github"]["error"]["retry_after"] > 0
    assert body["tasks"][f"github:{REPO}#1"]["state"] == "private"


def test_labels_and_the_author_ride_with_the_task():
    labels = [{"name": "bug", "color": "D73A4A"}, {"name": " docs ", "color": "nope"}, "plain"]
    task = to_task(f"{REPO}#5", issue(5, labels=labels))
    assert [(label.name, label.color) for label in task.labels] == [
        ("bug", "d73a4a"),
        ("docs", ""),
        ("plain", ""),
    ]
    assert [(row.label, row.value) for row in task.rows] == [("Author", "sam-lee")]
    assert to_task(f"{REPO}#5", issue(5, user=None)).rows == []


def test_tasks_of_other_trackers_and_old_cached_ones_have_no_chips_or_rows(app_client):
    from app.domain.tasks import Task

    demo = app_client.post("/api/tasks/resolve", json={"ref": "DEMO-1"}).json()["task"]
    assert (demo["labels"], demo["rows"]) == ([], [])
    old = Task.model_validate({"source": "jira", "key": "DEV-1", "url": "", "fetched_at": "x"})
    assert (old.labels, old.rows) == ([], [])


def test_a_guest_gets_no_labels_of_a_task_it_cannot_read(app_client, fake):
    fake.repos["octo-org/secret"] = {1: issue(1, "octo-org/secret", labels=[{"name": "x"}])}
    fake.private.add("octo-org/secret")
    board_id = board_with(app_client, "octo-org/secret#1")
    link = app_client.put(f"/api/boards/{board_id}/public", json={"public": True}).json()
    task = TestClient(app_client.app).get(f"/api/public/{link['public_token']}").json()["tasks"]
    assert task["github:octo-org/secret#1"]["labels"] == []
    assert task["github:octo-org/secret#1"]["rows"] == []


SECRET = "octo-org/secret"
HIDDEN = "Title of #7"


def readers(fake: FakeGitHub, clock: Clock, server_token: str | None = None) -> GitHubReaders:
    client = httpx.Client(transport=httpx.MockTransport(fake), follow_redirects=True)
    return GitHubReaders(client, server_token, clock)


@pytest.fixture
def private(fake) -> FakeGitHub:
    fake.limit = fake.remaining = 5000
    fake.repos[SECRET] = {7: issue(7, SECRET)}
    fake.private.add(SECRET)
    fake.tokens = {T_ANN: {SECRET}, T_BOB: set()}
    return fake


def test_a_persons_token_reads_what_it_is_given(private, clock):
    github = readers(private, clock)
    ann, bob = github.of("ann", T_ANN), github.of("bob", T_BOB)
    assert ann.resolve(f"{SECRET}#7").summary == HIDDEN
    assert ann.poll([f"{SECRET}#7"])[0].summary == HIDDEN
    # A token that leaves the repository out is told what GitHub tells it: nothing is there.
    assert [t.state for t in bob.poll([f"{SECRET}#7"])] == ["not_found"]
    with pytest.raises(TaskNotFound):
        bob.resolve(f"{SECRET}#7")
    # Nobody's token fills the shared reader.
    assert [t.state for t in github.shared.poll([f"{SECRET}#7"])] == ["no_token"]
    assert ann.source_note is None


def test_a_persons_reader_is_kept_between_requests_and_asks_on_its_own_limit(private, clock):
    github = readers(private, clock)
    github.of("ann", T_ANN).poll([f"{REPO}#1"])
    asked = len(private.requests)
    assert github.of("ann", T_ANN).poll([f"{REPO}#1"])[0].state == "ok"
    assert len(private.requests) == asked
    # A new token starts a new reader; an unused one is dropped after an hour.
    assert github.of("ann", T_BOB) is not github.of("ann", T_ANN)
    clock.now += 3700
    kept = github.of("bob", T_BOB)
    assert list(github._own) == ["bob"] and github.of("bob", T_BOB) is kept
    # The shared reader was never asked: a person with a token spends their own limit.
    assert all(r.headers.get("authorization") for r in private.requests)


def test_a_persons_token_leaves_a_tenth_of_the_limit_alone(private, clock):
    private.remaining = 501
    private.reset = int(clock.now) + 600
    ann = readers(private, clock).of("ann", T_ANN)
    assert ann.resolve(f"{REPO}#1").state == "ok"
    asked = len(private.requests)
    with pytest.raises(TrackerRateLimited) as limited:
        ann.resolve(f"{REPO}#2")
    assert limited.value.retry_after == 600
    assert len(private.requests) == asked
    clock.now += 601
    private.remaining = 5000
    assert ann.resolve(f"{REPO}#2").state == "ok"


def test_a_rejected_token_leaves_public_tasks_working(private, clock):
    github = readers(private, clock)
    ann = github.of("ann", T_ANN)
    assert ann.poll([f"{REPO}#1", f"{SECRET}#7"])[1].summary == HIDDEN
    private.revoked.add(T_ANN)
    clock.now += 60
    states = {t.key: t.state for t in ann.poll([f"{REPO}#1", f"{SECRET}#7"])}
    assert states == {f"{REPO}#1": "ok", f"{SECRET}#7": "no_token"}
    assert "rejected your token" in ann.source_note
    # The token is left alone for a while, then tried again.
    asked = [r for r in private.requests if r.headers.get("authorization") == f"Bearer {T_ANN}"]
    clock.now += 60
    ann.poll([f"{REPO}#1"])
    assert asked == [
        r for r in private.requests if r.headers.get("authorization") == f"Bearer {T_ANN}"
    ]
    private.revoked.clear()
    clock.now += 300
    assert ann.poll([f"{SECRET}#7"])[0].summary == HIDDEN
    assert ann.source_note is None


@pytest.fixture
def team(private):
    settings = Settings(db_path=":memory:", tiko_secret_key="test-secret-key")
    app = create_app(settings, github_transport=httpx.MockTransport(private))
    admin = signed_in(app)
    people = {}
    for name in ("ann", "bob"):
        url = admin.post("/api/invites", json={"role": "member"}).json()["url"]
        client = TestClient(app)
        accepted = client.post(
            f"/api/invites/{url.split('=', 1)[1]}/accept",
            json={"username": name, "name": name.title(), "password": "long-enough-password"},
        )
        assert accepted.is_success
        people[name] = client
    return people


def test_my_github_token(team, private):
    ann = team["ann"]
    assert ann.get("/api/me/tracker").json()["github_token_state"] == "none"
    private.revoked.add("made-up")
    refused = ann.put("/api/me/tracker", json={"token": "made-up", "source": "github"})
    assert (refused.status_code, refused.json()["error"]["code"]) == (422, "validation_failed")
    assert ann.get("/api/me/tracker").json()["github_token_state"] == "none"
    saved = ann.put("/api/me/tracker", json={"token": f" {T_ANN}\n", "source": "github"})
    assert saved.json() == {
        "provider": "demo",
        "base_url": None,
        "token_state": "none",
        "github_token_state": "set",
    }
    assert T_ANN not in ann.get("/api/me/tracker").text + ann.get("/api/settings").text
    assert ann.delete("/api/me/tracker").status_code == 204
    assert ann.get("/api/me/tracker").json()["github_token_state"] == "set"
    assert ann.delete("/api/me/tracker", params={"source": "github"}).status_code == 204
    assert ann.get("/api/me/tracker").json()["github_token_state"] == "none"


def test_a_private_task_is_seen_by_its_tokens_owner_only(team, private):
    """SC-005: the title of a private task never reaches a person without a token or a guest."""
    ann, bob = team["ann"], team["bob"]
    assert ann.put("/api/me/tracker", json={"token": T_ANN, "source": "github"}).is_success
    link = f"https://github.com/{SECRET}/issues/7"
    assert ann.post("/api/tasks/resolve", json={"ref": link}).json()["task"]["summary"] == HIDDEN
    refused = bob.post("/api/tasks/resolve", json={"ref": link})
    assert (refused.status_code, refused.json()["error"]["code"]) == (404, "task_not_found")
    board_id = board_with(ann, f"{REPO}#1", f"{SECRET}#7")
    assert ann.put(f"/api/boards/{board_id}/everyone", json={"role": "viewer"}).is_success
    token = ann.put(f"/api/boards/{board_id}/public", json={"public": True}).json()["public_token"]
    mine = ann.post(f"/api/boards/{board_id}/refresh").json()["tasks"]
    assert mine[f"github:{SECRET}#7"]["summary"] == HIDDEN

    def states(response) -> dict[str, str]:
        return {task["key"]: task["state"] for task in response.json()["tasks"].values()}

    guest = TestClient(ann.app)
    seen = {
        "bob": [bob.post(f"/api/boards/{board_id}/refresh"), bob.get(f"/api/boards/{board_id}")],
        "guest": [guest.get(f"/api/public/{token}"), guest.post(f"/api/public/{token}/refresh")],
    }
    assert states(seen["bob"][0]) == {f"{REPO}#1": "ok", f"{SECRET}#7": "no_token"}
    assert states(seen["guest"][0]) == {f"{REPO}#1": "ok", f"{SECRET}#7": "private"}
    for responses in seen.values():
        for response in responses:
            assert response.is_success
            assert HIDDEN.encode() not in response.content
    # With a token that leaves the repository out, bob is told there is no such task.
    assert bob.put("/api/me/tracker", json={"token": T_BOB, "source": "github"}).is_success
    assert states(bob.post(f"/api/boards/{board_id}/refresh")) == {
        f"{REPO}#1": "ok",
        f"{SECRET}#7": "not_found",
    }


def test_a_demo_visitor_cannot_keep_a_token(private):
    settings = Settings(db_path=":memory:", tiko_secret_key="test-secret-key", tiko_demo=True)
    app = create_app(settings, github_transport=httpx.MockTransport(private))
    visitor = TestClient(app)
    assert visitor.post("/api/auth/demo").is_success
    refused = visitor.put("/api/me/tracker", json={"token": T_ANN, "source": "github"})
    assert refused.status_code == 403
    assert visitor.get("/api/me/tracker").json()["github_token_state"] == "none"
