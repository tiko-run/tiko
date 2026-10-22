import pytest
from pydantic import SecretStr

from app.adapters.secrets.fernet import FernetSecretBox
from app.adapters.tasks.demo import DemoTaskProvider
from app.domain.boards import BoardDoc
from app.domain.errors import (
    JiraRateLimited,
    JiraUnauthorized,
    JiraUnavailable,
    JiraUnreachable,
    NotFound,
)
from app.domain.refresh import RefreshService
from app.domain.settings import SettingsService
from tests.conftest import add_person

DOC = BoardDoc.model_validate(
    {
        "nodes": [
            {"id": "a", "type": "task_card", "position": {"x": 0, "y": 0}, "data": {"key": k}}
            for k in ("DEMO-1", "DEMO-2")
        ]
    }
)


class Flaky:
    """Demo provider that fails with the queued errors before answering."""

    base_host = "jira.example.com"
    source_id = "jira"
    source_name = "Jira Data Center"
    source_note = None

    def __init__(self, *errors: Exception) -> None:
        self.errors = list(errors)
        self.calls = 0
        self.demo = DemoTaskProvider()

    def poll(self, keys):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return [task.model_copy(update={"source": self.source_id}) for task in self.demo.poll(keys)]


@pytest.fixture
def repos(store):
    mod, db = store
    boards = mod.BoardRepo(db)
    board_id = boards.create("b", BoardDoc(), add_person(store, "owner"))
    boards.save(board_id, 1, DOC)
    return board_id, boards, mod.SnapshotRepo(db).scoped("owner")


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def poll(service, repos, provider, board_id=None):
    default_id, boards, snapshots = repos
    tasks, (status,) = service.refresh(
        board_id or default_id, 30, boards, snapshots, {"jira": provider}, "jira"
    )
    return tasks, status


def test_one_poll_stores_snapshots(repos):
    _, _, snapshots = repos
    provider = Flaky()
    tasks, status = poll(RefreshService(), repos, provider)
    assert set(tasks) == {"jira:DEMO-1", "jira:DEMO-2"}
    assert provider.calls == 1
    assert (status.id, status.state, status.error) == ("jira", "ok", None)
    assert status.synced_at
    assert set(snapshots.get_many(["jira:DEMO-1", "jira:DEMO-2"])) == {"jira:DEMO-1", "jira:DEMO-2"}


def test_failure_is_a_source_status_not_an_exception(repos):
    service = RefreshService(Clock())
    poll(service, repos, Flaky())
    tasks, status = poll(service, repos, Flaky(JiraUnauthorized("Jira returned 401")))
    assert tasks == {}
    assert status.state == "error"
    assert (status.error.code, status.error.message) == ("jira_unauthorized", "Jira returned 401")
    # The last good sync time stays, so the UI can say how stale the cards are.
    assert status.synced_at


def test_backoff_doubles_and_resets(repos):
    clock = Clock()
    service = RefreshService(clock)
    provider = Flaky(JiraUnavailable("down"), JiraUnavailable("down"))

    _, status = poll(service, repos, provider)
    assert status.error.retry_after == 60
    clock.now += 59
    _, status = poll(service, repos, provider)
    assert (status.state, status.error.message, status.error.retry_after) == ("error", "down", 1)
    assert provider.calls == 1

    clock.now += 1
    _, status = poll(service, repos, provider)
    assert status.error.retry_after == 120
    clock.now += 119
    poll(service, repos, provider)
    assert provider.calls == 2

    clock.now += 1
    tasks, status = poll(service, repos, provider)
    assert tasks and status.state == "ok"

    # After a success the next outage starts again from interval × 2.
    provider.errors.append(JiraUnavailable("down"))
    _, status = poll(service, repos, provider)
    assert status.error.retry_after == 60


def test_unreachable_tracker_retries_at_normal_pace(repos):
    service = RefreshService(Clock())
    provider = Flaky(*[JiraUnreachable("Jira is unreachable")] * 3)
    for _ in range(3):
        _, status = poll(service, repos, provider)
        assert status.error.retry_after is None
    assert provider.calls == 3
    # The VPN is back: the very next tick syncs.
    tasks, status = poll(service, repos, provider)
    assert tasks and status.state == "ok"


def test_retry_after_and_cap(repos):
    clock = Clock()
    service = RefreshService(clock)
    provider = Flaky(JiraRateLimited("slow down", 500))
    _, status = poll(service, repos, provider)
    assert status.error.retry_after == 300
    clock.now += 299
    poll(service, repos, provider)
    assert provider.calls == 1
    clock.now += 1
    tasks, _ = poll(service, repos, provider)
    assert tasks


def test_auth_errors_do_not_back_off(repos):
    service = RefreshService(Clock())
    provider = Flaky(JiraUnauthorized("401"))
    poll(service, repos, provider)
    tasks, _ = poll(service, repos, provider)
    assert tasks


def test_failed_refresh_keeps_last_snapshot(repos):
    _, _, snapshots = repos
    service = RefreshService(Clock())
    poll(service, repos, Flaky())
    poll(service, repos, Flaky(JiraUnavailable("down")))
    assert set(snapshots.get_many(["jira:DEMO-1"])) == {"jira:DEMO-1"}


def test_missing_board(repos):
    with pytest.raises(NotFound):
        poll(RefreshService(), repos, Flaky(), board_id="nope")


def test_reset_clears_backoff(repos):
    service = RefreshService(Clock())
    poll(service, repos, Flaky(JiraUnavailable("down")))
    service.reset()
    tasks, _ = poll(service, repos, Flaky())
    assert tasks


def test_empty_board_reports_the_last_known_state(repos):
    _, boards, _ = repos
    service = RefreshService(Clock())
    empty = boards.create("empty", BoardDoc(), "owner")
    provider = Flaky()
    _, status = poll(service, repos, provider, board_id=empty)
    assert (status.state, provider.calls) == ("ok", 0)
    poll(service, repos, Flaky(JiraUnreachable("down")))
    _, status = poll(service, repos, provider, board_id=empty)
    assert status.state == "error"


def mixed_board(repos):
    """A card of the instance's tracker, a demo card with the same key, and one of a tracker
    this instance does not read."""
    _, boards, _ = repos
    cards = [("a", None), ("b", "demo"), ("c", "elsewhere")]
    doc = {
        "nodes": [
            {
                "id": node_id,
                "type": "task_card",
                "position": {"x": 0, "y": 0},
                "data": {"key": "DEMO-1"} | ({"source": source} if source else {}),
            }
            for node_id, source in cards
        ]
    }
    board_id = boards.create("mixed", BoardDoc(), "owner")
    boards.save(board_id, 1, BoardDoc.model_validate(doc))
    return board_id


def test_each_tracker_of_the_board_is_polled_once(repos):
    _, boards, snapshots = repos
    jira, demo = Flaky(), DemoTaskProvider()
    tasks, statuses = RefreshService().refresh(
        mixed_board(repos), 30, boards, snapshots, {"jira": jira, "demo": demo}, "jira"
    )
    assert {ref: task.state for ref, task in tasks.items()} == {
        "jira:DEMO-1": "ok",
        "demo:DEMO-1": "ok",
        "elsewhere:DEMO-1": "not_found",
    }
    assert jira.calls == 1
    assert sorted(status.id for status in statuses) == ["demo", "jira"]


def test_a_failing_tracker_leaves_the_others_alone(repos):
    """SC-003."""
    _, boards, snapshots = repos
    providers = {"jira": Flaky(JiraUnavailable("down")), "demo": DemoTaskProvider()}
    tasks, statuses = RefreshService(Clock()).refresh(
        mixed_board(repos), 30, boards, snapshots, providers, "jira"
    )
    assert "demo:DEMO-1" in tasks and "jira:DEMO-1" not in tasks
    assert {status.id: status.state for status in statuses} == {"jira": "error", "demo": "ok"}


class Racing(Flaky):
    """Tracker whose poll lets a token change land before it answers."""

    def __init__(self, source_id: str, during) -> None:
        super().__init__()
        self.source_id = source_id
        self.during = during

    def poll(self, keys):
        self.during()
        return super().poll(keys)


class LateWrite:
    """Task cache where a token change lands after the check, right before the write."""

    def __init__(self, snapshots, change) -> None:
        self.snapshots = snapshots
        self.change = change

    def put_many(self, tasks):
        self.change()
        self.snapshots.put_many(tasks)

    def forget(self, source):
        self.snapshots.forget(source)


def token_settings(store, snapshots):
    """Settings on the real token store, clearing the cache on a token change as main does."""
    mod, db = store
    repo = mod.SettingsRepo(db)
    repo.set_many({"jira_base_url": "https://jira.example.com"})
    return SettingsService(
        repo,
        mod.CredentialRepo(db),
        FernetSecretBox("test key"),
        secret_key_configured=True,
        on_token_change=lambda _user, source: snapshots.forget(source),
    )


TOKEN_CHANGES = {
    "jira replaced": ("jira", lambda s: s.set_token("owner", SecretStr("new"))),
    "jira removed": ("jira", lambda s: s.remove_token("owner")),
    "github replaced": ("github", lambda s: s.set_github_token("owner", SecretStr("new"))),
    "github removed": ("github", lambda s: s.remove_github_token("owner")),
}


def refresh_with_tokens(repos, settings, cache, provider):
    board_id, boards, _ = repos
    return RefreshService().refresh(
        board_id,
        30,
        boards,
        cache,
        {provider.source_id: provider},
        provider.source_id,
        "owner",
        settings.token_stamps("owner"),
        lambda: settings.token_stamps("owner"),
    )


@pytest.mark.parametrize("late", [False, True], ids=["during poll", "before write"])
@pytest.mark.parametrize("change", TOKEN_CHANGES.values(), ids=TOKEN_CHANGES.keys())
def test_a_poll_outlived_by_its_token_leaves_the_cache_empty(store, repos, change, late):
    """Issue 227: what the old token read stays out of the cache its change cleared."""
    _, _, snapshots = repos
    source, swap = change
    settings = token_settings(store, snapshots)
    settings.set_token("owner", SecretStr("old"))
    settings.set_github_token("owner", SecretStr("old"))
    in_poll = (lambda: None) if late else (lambda: swap(settings))
    cache = LateWrite(snapshots, lambda: swap(settings)) if late else snapshots
    tasks, _ = refresh_with_tokens(repos, settings, cache, Racing(source, in_poll))
    assert snapshots.get_many([f"{source}:DEMO-1", f"{source}:DEMO-2"]) == {}
    assert tasks == {}


def test_a_poll_with_the_same_token_fills_the_cache(store, repos):
    _, _, snapshots = repos
    settings = token_settings(store, snapshots)
    settings.set_github_token("owner", SecretStr("old"))
    refresh_with_tokens(repos, settings, snapshots, Racing("github", lambda: None))
    refs = ["github:DEMO-1", "github:DEMO-2"]
    assert set(snapshots.get_many(refs)) == set(refs)
