"""Reading a gantt through API v1 (spec 047, slice api-gantt)."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in
from tests.test_api_keys import make_key, with_key
from tests.test_api_v1_read import board

GANTT = {
    "start": "2026-10-01",
    "end": "2026-12-31",
    "scale": "week",
    "columns": ["missing-field"],
    "rows": [
        {"id": "p", "title": "Payments", "start": "2026-10-05", "end": "2026-10-09"},
        {
            "id": "r",
            "parent": "p",
            "key": "DEMO-7",
            "start": "2026-10-05",
            "end": "2026-10-09",
            "stages": [{"id": "s", "type": "nope", "start": "2026-10-05", "end": "2026-10-09"}],
        },
    ],
    "milestones": [{"id": "m", "date": "2026-12-20", "title": "Release"}],
    "links": [],
}
DOC = {
    "nodes": [
        {
            "id": "f",
            "type": "frame",
            "position": {"x": 0, "y": 0},
            "width": 2000,
            "height": 1000,
            "data": {"title": "Plan"},
        },
        {
            "id": "g",
            "type": "module",
            "position": {"x": 0, "y": 1100},
            "data": {"kind": "gantt", "title": "Release plan", "content": GANTT},
        },
        {
            "id": "u",
            "type": "module",
            "position": {"x": 0, "y": 1400},
            "data": {"kind": "future_thing", "content": {"kept": [1]}},
        },
        {"id": "n", "type": "sticky", "position": {"x": 0, "y": 2000}, "data": {"text": "hi"}},
    ],
    "edges": [],
}


@pytest.fixture
def app():
    return create_app(Settings(db_path=":memory:"))


@pytest.fixture
def admin(app) -> TestClient:
    return signed_in(app)


@pytest.fixture
def key(app, admin) -> TestClient:
    return with_key(app, make_key(admin)["token"])


def test_the_outline_lists_modules(admin, key):
    board_id = board(admin, "Plan", DOC)
    body = key.get(f"/api/v1/boards/{board_id}").json()
    assert body["modules"] == [
        {"id": "g", "module": "gantt", "title": "Release plan", "rows": 2},
        {"id": "u", "module": "future_thing", "title": None},
    ]
    found = key.get(f"/api/v1/boards/{board_id}?elements=all").json()["elements"]
    assert {e["id"]: e.get("module") for e in found if e["kind"] == "module"} == {
        "g": "gantt",
        "u": "future_thing",
    }


def test_a_gantt_reads_as_the_web_app_draws_it(app, admin, key):
    board_id = board(admin, "Plan", DOC)
    before = app.state.boards.get(board_id).doc.model_dump()
    response = key.get(f"/api/v1/boards/{board_id}/modules/g")
    assert response.status_code == 200, response.json()
    body = response.json()
    assert (body["id"], body["module"], body["title"], body["planning"]) == (
        "g",
        "gantt",
        "Release plan",
        True,
    )
    parent, row = body["gantt"]["rows"]
    assert (parent["title"], parent["depth"], "stages" in parent) == ("Payments", 0, False)
    assert (row["parent"], row["depth"], row["key"], row["source"]) == ("p", 1, "DEMO-7", "demo")
    assert row["task"]["title"] and row["task"]["fetched_at"]
    assert row["stages"][0]["type"] == {"id": "nope", "name": None}
    assert body["gantt"]["milestones"] == [{"id": "m", "date": "2026-12-20", "title": "Release"}]
    # A read writes nothing back, not even the dates it worked out.
    assert app.state.boards.get(board_id).doc.model_dump() == before


def test_planning_off_reads_no_stages(app, admin, key):
    assert admin.patch("/api/planning", json={"enabled": False}).status_code == 200
    board_id = board(admin, "Plan", DOC)
    body = key.get(f"/api/v1/boards/{board_id}/modules/g").json()
    assert body["planning"] is False
    assert all("stages" not in r and "values" not in r for r in body["gantt"]["rows"])


def test_another_kind_reads_without_its_content(admin, key):
    board_id = board(admin, "Plan", DOC)
    body = key.get(f"/api/v1/boards/{board_id}/modules/u").json()
    assert body == {"id": "u", "module": "future_thing", "title": None, "planning": True}


def test_what_is_not_a_reachable_module_is_not_found(app, admin):
    chosen, other = board(admin, "Chosen", DOC), board(admin, "Other", DOC)
    key = with_key(app, make_key(admin, boards=[chosen])["token"])
    for path in (f"{chosen}/modules/n", f"{chosen}/modules/nope", f"{other}/modules/g"):
        response = key.get(f"/api/v1/boards/{path}")
        assert (response.status_code, response.json()["error"]["code"]) == (404, "not_found")
    assert key.get(f"/api/v1/boards/{chosen}/modules/g").status_code == 200
