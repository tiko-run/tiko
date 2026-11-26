"""Bare keys by prefix and the remembered choices (spec 053, slice 2)."""

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in
from tests.jira_fake import TOKEN, FakeJira, issue
from tests.linear_fake import KEY, FakeLinear
from tests.linear_fake import issue as linear_issue
from tests.test_api_keys import make_key, with_key
from tests.test_api_v1_read import board
from tests.test_demo import visitor
from tests.test_planning import LONG

JIRA = {"base_url": "https://jira.example.com", "token": TOKEN}


@pytest.fixture
def both():
    jira, linear = FakeJira(), FakeLinear()
    app = create_app(
        Settings(db_path=":memory:", tiko_secret_key="test-secret-key"),
        jira_transport=httpx.MockTransport(jira),
        linear_transport=httpx.MockTransport(linear),
    )
    client = signed_in(app)
    assert client.put("/api/settings", json={"provider": "jira", "jira": JIRA}).status_code == 200
    # CORE is a project in Jira and a team in Linear.
    jira.issues["CORE-5"] = issue("CORE-5")
    linear.teams = ["ENG", "CORE"]
    linear.issues["CORE-5"] = linear_issue("CORE-5")
    return app, client, jira, linear


def connect(client) -> None:
    saved = client.put("/api/me/tracker", json={"token": KEY, "source": "linear"})
    assert saved.status_code == 200, saved.json()


def resolve(client, ref: str, source: str | None = None):
    body = {"ref": ref} | ({"source": source} if source else {})
    return client.post("/api/tasks/resolve", json=body)


def card(response) -> tuple[str, str]:
    assert response.status_code == 200, response.json()
    task = response.json()["task"]
    return task["source"], task["key"]


def asked(fake, part: str) -> int:
    return sum(part in str(r.url) or part in r.content.decode() for r in fake.requests)


def test_without_linear_a_bare_key_goes_to_jira_with_no_extra_request(both):
    _, client, jira, linear = both
    # DEMO is also a prefix of the demo tasks every request can read: they never claim it.
    jira.issues["DEMO-5"] = issue("DEMO-5")
    jira.requests.clear()
    assert card(resolve(client, "CORE-5")) == ("jira", "CORE-5")
    assert card(resolve(client, "DEMO-5")) == ("jira", "DEMO-5")
    assert linear.requests == []
    assert asked(jira, "/project/") == 0


def test_the_demo_tasks_never_claim_a_bare_key_from_jira(both):
    _, client, jira, _ = both
    connect(client)
    jira.issues["DEMO-5"] = issue("DEMO-5")
    assert card(resolve(client, "DEMO-5")) == ("jira", "DEMO-5")


def test_a_linear_that_cannot_list_its_teams_is_skipped_for_a_while(both):
    _, client, _, linear = both
    connect(client)
    linear.status = 500
    for _ in range(3):
        assert card(resolve(client, "DEV-1")) == ("jira", "DEV-1")
    assert len(linear.requests) - asked(linear, "viewer") == 1


def test_a_prefix_only_linear_knows_goes_to_linear(both):
    _, client, jira, _ = both
    connect(client)
    assert card(resolve(client, "eng-1")) == ("linear", "acme/ENG-1")
    assert asked(jira, "/project/ENG") == 1


def test_a_prefix_only_jira_knows_goes_to_jira_without_asking_jira(both):
    _, client, jira, _ = both
    connect(client)
    jira.requests.clear()
    assert card(resolve(client, "DEV-1")) == ("jira", "DEV-1")
    assert asked(jira, "/project/") == 0


def test_a_prefix_both_know_asks_until_chosen(both):
    _, client, _, _ = both
    connect(client)
    refused = resolve(client, "CORE-5")
    assert refused.status_code == 409
    error = refused.json()["error"]
    assert (error["code"], error["prefix"], error["sources"]) == (
        "ambiguous_key",
        "CORE",
        ["jira", "linear"],
    )
    assert "jira:CORE-5 or linear:CORE-5" in error["message"]
    assert card(resolve(client, "CORE-5", "linear")) == ("linear", "acme/CORE-5")
    assert card(resolve(client, "CORE-5", "jira")) == ("jira", "CORE-5")


def test_a_remembered_choice_skips_the_question_and_can_change(both):
    _, client, _, _ = both
    connect(client)
    listed = client.put("/api/me/key-prefixes/core", json={"source": "linear"})
    assert listed.json() == {"choices": [{"prefix": "CORE", "source": "linear"}]}
    assert card(resolve(client, "CORE-5")) == ("linear", "acme/CORE-5")
    client.put("/api/me/key-prefixes/CORE", json={"source": "jira"})
    assert card(resolve(client, "CORE-5")) == ("jira", "CORE-5")
    assert client.delete("/api/me/key-prefixes/CORE").status_code == 204
    assert client.get("/api/me/key-prefixes").json() == {"choices": []}
    assert resolve(client, "CORE-5").status_code == 409


def test_a_choice_is_a_prefix_and_a_tracker_with_prefixes(both):
    _, client, _, _ = both
    bad = client.put("/api/me/key-prefixes/no-good", json={"source": "linear"})
    assert (bad.status_code, bad.json()["error"]["code"]) == (422, "validation_failed")
    github = client.put("/api/me/key-prefixes/CORE", json={"source": "github"})
    assert github.status_code == 422


def test_a_choice_is_kept_per_person(both):
    app, client, _, _ = both
    connect(client)
    client.put("/api/me/key-prefixes/CORE", json={"source": "linear"})
    url = client.post("/api/invites", json={"role": "member"}).json()["url"]
    bob = TestClient(app)
    bob.post(
        f"/api/invites/{url.split('=', 1)[1]}/accept",
        json={"username": "bob", "name": "Bob", "password": LONG},
    )
    assert bob.get("/api/me/key-prefixes").json() == {"choices": []}


def test_a_jira_that_cannot_be_asked_leaves_the_choice_open_and_is_asked_again(both):
    _, client, jira, linear = both
    connect(client)
    linear.teams = ["ENG"]
    jira.fail = 500
    assert resolve(client, "ENG-1").status_code == 409
    jira.fail = None
    assert card(resolve(client, "ENG-1")) == ("linear", "acme/ENG-1")


def test_answers_are_kept_between_keys(both):
    _, client, jira, linear = both
    connect(client)
    for _ in range(3):
        card(resolve(client, "ENG-1"))
    assert asked(linear, "teams(") == 1
    assert asked(jira, "/project/ENG") == 1


def test_every_page_of_teams_is_read(both):
    _, client, _, linear = both
    linear.teams = ["AAA", "BBB", "ENG"]
    linear.team_page = 1
    connect(client)
    assert card(resolve(client, "ENG-1")) == ("linear", "acme/ENG-1")
    assert asked(linear, "teams(") == 3


def test_api_v1_names_the_tracker_or_uses_the_choice(both):
    app, client, _, _ = both
    connect(client)
    board_id = board(client, "Plan", {"nodes": [], "edges": []})
    key = with_key(app, make_key(client, scope="write")["token"])
    url = f"/api/v1/boards/{board_id}/elements"
    refused = key.post(url, json={"elements": [{"kind": "card", "ref": "CORE-5"}]})
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "ambiguous_key")
    named = key.post(url, json={"elements": [{"kind": "card", "ref": "linear:CORE-5"}]})
    assert named.status_code == 200, named.json()
    client.put("/api/me/key-prefixes/CORE", json={"source": "jira"})
    chosen = key.post(url, json={"elements": [{"kind": "card", "ref": "CORE-5"}]})
    assert chosen.status_code == 200, chosen.json()
    cards = key.get(f"/api/v1/boards/{board_id}?elements=all").json()["elements"]
    assert sorted((e["source"], e["key"]) for e in cards if e["kind"] == "card") == [
        ("jira", "CORE-5"),
        ("linear", "acme/CORE-5"),
    ]


def test_a_demo_visitor_has_no_choices():
    guest = visitor(create_app(Settings(db_path=":memory:", tiko_demo=True)))
    for response in (
        guest.get("/api/me/key-prefixes"),
        guest.put("/api/me/key-prefixes/CORE", json={"source": "linear"}),
        guest.delete("/api/me/key-prefixes/CORE"),
    ):
        assert response.status_code == 403


def test_the_prefix_cache_stays_bounded():
    from app.adapters.tasks.jira_dc import PREFIX_ANSWERS, JiraPrefixes

    now = [0.0]
    cache = JiraPrefixes(lambda: now[0])
    for i in range(PREFIX_ANSWERS * 2):
        cache.put("site", f"P{i}", True)
    assert len(cache._known) <= PREFIX_ANSWERS
    assert cache.get("site", f"P{PREFIX_ANSWERS * 2 - 1}") is True
    assert cache.lock("site", "P1") is cache.lock("site", "P1")
