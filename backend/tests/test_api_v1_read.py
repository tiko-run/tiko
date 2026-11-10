"""Reading boards and tasks through API v1 (spec 046, slice api-read)."""

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import deps as v1_deps
from app.config import Settings
from app.domain import api_view
from app.main import create_app
from tests.conftest import signed_in
from tests.test_api_keys import make_key, with_key
from tests.test_people import invite, join

LONG = "long-enough-password"
DOC = {
    "nodes": [
        {
            "id": "f1",
            "type": "frame",
            "position": {"x": 100, "y": 200},
            "width": 600,
            "height": 400,
            "data": {"title": "In review"},
        },
        {
            "id": "n1",
            "type": "sticky",
            "parentId": "f1",
            "position": {"x": 10, "y": 20},
            "width": 200,
            "height": 200,
            "data": {"text": "Ask legal", "color": "pink"},
        },
        {
            "id": "c1",
            "type": "task_card",
            "position": {"x": 900, "y": 0},
            "data": {"key": "DEMO-1"},
        },
        {"id": "t1", "type": "text", "position": {"x": 0, "y": 900}, "data": {"text": "Notes"}},
        {"id": "a1", "type": "anchor", "position": {"x": 1200, "y": 0}},
    ],
    "edges": [
        {"id": "e1", "source": "n1", "target": "c1"},
        {"id": "e2", "source": "c1", "target": "a1"},
    ],
}


@pytest.fixture
def app():
    return create_app(Settings(db_path=":memory:"))


@pytest.fixture
def admin(app) -> TestClient:
    return signed_in(app)


def board(client: TestClient, name: str = "Release", doc: dict = DOC) -> str:
    board_id = client.post("/api/boards", json={"name": name}).json()["id"]
    saved = client.put(f"/api/boards/{board_id}", json={"version": 1, "doc": doc})
    assert saved.status_code == 200, saved.json()
    return board_id


def test_a_read_makes_no_welcome_board(app, admin):
    key = with_key(app, make_key(admin)["token"])
    assert key.get("/api/v1/boards").json() == {"boards": []}


def test_boards_list_what_the_key_reaches_with_links(app, admin):
    board_id = board(admin)
    key = with_key(app, make_key(admin)["token"])
    listed = key.get("/api/v1/boards", headers={"x-forwarded-host": "tiko.example.com:3000"})
    (found,) = listed.json()["boards"]
    assert found["id"] == board_id
    assert found["role"] == "owner"
    assert (found["public"], found["shared_with_everyone"]) == (False, False)
    assert found["url"] == f"http://tiko.example.com:3000/?board={board_id}"


def test_an_outline_counts_what_sits_where(app, admin):
    board_id = board(admin)
    key = with_key(app, make_key(admin)["token"])
    body = key.get(f"/api/v1/boards/{board_id}").json()
    assert body["board"]["name"] == "Release"
    (frame,) = body["frames"]
    assert (frame["id"], frame["title"], frame["x"], frame["y"]) == ("f1", "In review", 100, 200)
    assert frame["counts"] == {"note": 1}
    assert body["outside"]["counts"] == {"card": 1, "text": 1, "arrow": 2}


def test_elements_come_in_the_public_shape(app, admin):
    board_id = board(admin)
    key = with_key(app, make_key(admin)["token"])
    elements = key.get(f"/api/v1/boards/{board_id}?elements=all").json()["elements"]
    by_id = {e["id"]: e for e in elements}
    assert "a1" not in by_id
    note = by_id["n1"]
    assert (note["kind"], note["x"], note["y"], note["frame"]) == ("note", 110, 220, "f1")
    assert (note["text"], note["color"], note["editable"]) == ("Ask legal", "pink", False)
    card = by_id["c1"]
    assert (card["kind"], card["source"], card["key"]) == ("card", "demo", "DEMO-1")
    assert card["task"]["title"] and card["task"]["fetched_at"]
    assert by_id["e1"] == {"id": "e1", "kind": "arrow", "from": "n1", "to": "c1", "editable": False}
    assert by_id["e2"]["to"] is None


def test_one_frame_comes_with_its_arrows(app, admin):
    board_id = board(admin)
    key = with_key(app, make_key(admin)["token"])
    body = key.get(f"/api/v1/boards/{board_id}?frame=f1").json()
    assert {e["id"] for e in body["elements"]} == {"n1", "e1"}
    assert key.get(f"/api/v1/boards/{board_id}?frame=c1").status_code == 404


def test_elements_page_by_id(app, admin, monkeypatch):
    monkeypatch.setattr(api_view, "PAGE", 2)
    board_id = board(admin)
    key = with_key(app, make_key(admin)["token"])
    seen, after, more = [], None, True
    while more:
        url = f"/api/v1/boards/{board_id}?elements=all" + (f"&after={after}" if after else "")
        body = key.get(url).json()
        seen += [e["id"] for e in body["elements"]]
        after, more = seen[-1], body["more"]
    assert seen == sorted(["f1", "n1", "c1", "t1", "e1", "e2"])


def test_a_key_for_chosen_boards_sees_no_other(app, admin):
    chosen, other = board(admin, "Chosen"), board(admin, "Other")
    key = with_key(app, make_key(admin, boards=[chosen])["token"])
    assert [b["id"] for b in key.get("/api/v1/boards").json()["boards"]] == [chosen]
    response = key.get(f"/api/v1/boards/{other}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_an_admin_key_reaches_only_boards_shared_with_them(app, admin):
    member = join(app, invite(admin))
    private = board(member, "Private")
    shared = board(member, "Shared")
    assert member.put(f"/api/boards/{shared}/everyone", json={"role": "viewer"}).status_code == 204
    # In the web app the admin is owner of both.
    assert admin.get(f"/api/boards/{private}").status_code == 200
    key = with_key(app, make_key(admin)["token"])
    assert [b["id"] for b in key.get("/api/v1/boards").json()["boards"]] == [shared]
    assert key.get(f"/api/v1/boards/{shared}").json()["board"]["role"] == "viewer"
    assert key.get(f"/api/v1/boards/{private}").status_code == 404


def test_a_member_key_reads_shared_boards(app, admin):
    shared = board(admin, "Team")
    assert admin.put(f"/api/boards/{shared}/everyone", json={"role": "editor"}).status_code == 204
    member = join(app, invite(admin))
    key = with_key(app, make_key(member, password=LONG)["token"])
    assert key.get(f"/api/v1/boards/{shared}").json()["board"]["role"] == "editor"


def test_search_reads_the_demo_tasks(app, admin):
    key = with_key(app, make_key(admin)["token"])
    body = key.post("/api/v1/tasks/search", json={"source": "demo", "query": '"login"'}).json()
    assert body["tasks"]
    assert set(body["tasks"][0]) == {
        "source",
        "key",
        "title",
        "status",
        "assignee",
        "due",
        "url",
        "fetched_at",
    }


def test_search_says_what_it_cannot_do(app, admin):
    key = with_key(app, make_key(admin)["token"])
    github = key.post("/api/v1/tasks/search", json={"source": "github", "query": "x"})
    assert (github.status_code, github.json()["error"]["code"]) == (422, "validation_failed")
    jira = key.post("/api/v1/tasks/search", json={"source": "jira", "query": "project = X"})
    assert jira.json()["error"]["code"] == "jira_not_configured"
    caldav = key.post("/api/v1/tasks/search", json={"source": "caldav", "limit": 80})
    assert (caldav.status_code, caldav.json()["error"]["code"]) == (422, "invalid_request")


def test_reads_have_a_budget(app, admin, monkeypatch):
    monkeypatch.setattr(v1_deps, "READS", 3)
    key = with_key(app, make_key(admin)["token"])
    answers = [key.get("/api/v1/boards") for _ in range(4)]
    assert [a.status_code for a in answers] == [200, 200, 200, 429]
    assert answers[3].json()["error"]["code"] == "rate_limited"
    assert int(answers[3].headers["retry-after"]) >= 1


def test_v1_answers_unknown_routes_in_its_own_shape(app, admin):
    key = with_key(app, make_key(admin)["token"])
    missing = key.get("/api/v1/nothing")
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "not_found")
    wrong = key.delete("/api/v1/boards")
    assert (wrong.status_code, wrong.json()["error"]["code"]) == (405, "method_not_allowed")
