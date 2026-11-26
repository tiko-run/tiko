"""Many Linear issues by a query or a saved view (spec 053, slice 3)."""

import httpx
import pytest

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in
from tests.linear_fake import KEY, FakeLinear, issue
from tests.test_api_keys import make_key, with_key

VIEW = "https://linear.app/acme/view/my-cycle-0a1b2c3d4e5f"


@pytest.fixture
def linear():
    fake = FakeLinear()
    app = create_app(
        Settings(db_path=":memory:", tiko_secret_key="test-secret-key"),
        linear_transport=httpx.MockTransport(fake),
    )
    client = signed_in(app)
    saved = client.put("/api/me/tracker", json={"token": KEY, "source": "linear"})
    assert saved.status_code == 200, saved.json()
    return app, client, fake


def search(client, jql: str, limit: int = 50):
    return client.post("/api/tasks/search", json={"jql": jql, "limit": limit, "source": "linear"})


def test_a_query_adds_its_issues_as_cards(linear):
    _, client, fake = linear
    found = search(client, "team = ENG AND cycle in openSprints()")
    assert found.status_code == 200, found.json()
    body = found.json()
    assert [t["key"] for t in body["tasks"]] == ["acme/ENG-1", "acme/ENG-2"]
    assert (body["total"], body["more"]) == (2, False)
    assert fake.filters[-1]["and"][1] == {"cycle": {"isActive": {"eq": True}}}


def test_more_than_fit_says_so_without_a_count(linear):
    _, client, fake = linear
    fake.issues = {f"ENG-{i}": issue(f"ENG-{i}") for i in range(1, 61)}
    body = search(client, "team = ENG").json()
    assert len(body["tasks"]) == 50
    assert (body["total"], body["more"]) == (None, True)


def test_a_count_checks_the_query(linear):
    _, client, _ = linear
    body = search(client, "labels = bug", limit=0).json()
    assert (body["tasks"], body["total"], body["more"]) == ([], 2, False)


def test_a_query_tiko_cannot_read_says_where(linear):
    _, client, fake = linear
    asked = len(fake.requests)
    refused = search(client, "team = ENG AND")
    assert refused.status_code == 422
    error = refused.json()["error"]
    assert error["code"] == "invalid_jql"
    assert "position 15" in error["message"]
    assert len(fake.requests) == asked


def test_a_saved_view_link_adds_its_issues(linear):
    _, client, fake = linear
    fake.views["0a1b2c3d4e5f"] = ["ENG-2"]
    body = search(client, VIEW).json()
    assert [t["key"] for t in body["tasks"]] == ["acme/ENG-2"]
    missing = search(client, VIEW.replace("0a1b", "ffff"))
    assert missing.json()["error"]["code"] == "invalid_jql"
    other = search(client, VIEW.replace("/acme/", "/other/"))
    assert "another Linear workspace" in other.json()["error"]["message"]


def test_found_issues_refresh_without_another_request(linear):
    _, client, fake = linear
    search(client, "team = ENG")
    asked = len(fake.requests)
    tasks = client.post("/api/tasks/resolve", json={"ref": "acme/ENG-1"}).json()
    assert tasks["task"]["summary"] == "Title of ENG-1"
    assert len(fake.requests) - asked <= 1


def test_suggestions_offer_linear_fields_and_workspace_values(linear):
    _, client, _ = linear
    fields = client.get("/api/jql/vocabulary?source=linear").json()["fields"]
    assert {"team", "cycle", "statusCategory", "assignee"} <= {f["name"] for f in fields}

    def values(field: str, prefix: str = "") -> list[str]:
        params = {"source": "linear", "field": field, "prefix": prefix}
        return [v["value"] for v in client.get("/api/jql/values", params=params).json()["values"]]

    assert values("team") == ["ENG"]
    assert values("status", "in") == ['"In Progress"', '"In Review"']
    assert values("labels") == ["bug", "Backend"]
    assert values("assignee", "cur")[0] == "currentUser()"
    assert values("assignee", "ada") == ['"Ada Lovelace"']
    assert values("cycle") == ["12", "13", "openSprints()", "nextSprint()"]
    assert values("priority", "h") == ["High"]
    assert values("statusCategory") == ['"To Do"', '"In Progress"', "Done"]


def test_without_a_key_a_linear_query_asks_to_connect():
    app = create_app(Settings(db_path=":memory:", tiko_secret_key="test-secret-key"))
    refused = search(signed_in(app), "team = ENG")
    assert refused.status_code == 422
    assert "Connect your Linear key" in refused.json()["error"]["message"]


def test_a_tracker_without_queries_is_refused(linear):
    _, client, _ = linear
    refused = client.post("/api/tasks/search", json={"jql": "x", "source": "github"})
    assert refused.status_code == 422


def test_api_v1_searches_linear(linear):
    app, client, _ = linear
    key = with_key(app, make_key(client)["token"])
    found = key.post("/api/v1/tasks/search", json={"source": "linear", "query": "team = ENG"})
    assert found.status_code == 200, found.json()
    body = found.json()
    assert [t["key"] for t in body["tasks"]] == ["acme/ENG-1", "acme/ENG-2"]
    assert body["more"] is False


def test_a_value_linear_refuses_is_a_mistake_in_the_query(linear):
    _, client, fake = linear
    fake.reject_filter = True
    refused = search(client, "team = ENG")
    assert (refused.status_code, refused.json()["error"]["code"]) == (422, "invalid_jql")


def test_a_count_asks_only_for_identifiers(linear):
    _, client, fake = linear
    search(client, "team = ENG", limit=0)
    assert b"labels" not in fake.requests[-1].content


def test_api_v1_counts_what_came_back_when_linear_gives_no_count(linear):
    app, client, fake = linear
    fake.issues = {f"ENG-{i}": issue(f"ENG-{i}") for i in range(1, 61)}
    key = with_key(app, make_key(client)["token"])
    body = key.post("/api/v1/tasks/search", json={"source": "linear", "query": "team = ENG"}).json()
    assert (len(body["tasks"]), body["total"], body["more"]) == (50, 50, True)
