"""Keys that keep a Gantt plan (spec 056): REST, with rights and saved copies."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in
from tests.test_api_keys import make_key, with_key
from tests.test_api_v1_read import board
from tests.test_mcp import gantt_node

ROW = {"id": "p", "title": "Payments", "start": "2026-10-05", "end": "2026-10-09"}
PEOPLE = {"nodes": [gantt_node("g1", [ROW, {**ROW, "id": "c", "title": "Checkout"}])], "edges": []}


@pytest.fixture
def app():
    return create_app(Settings(db_path=":memory:"))


@pytest.fixture
def admin(app) -> TestClient:
    return signed_in(app)


def code(response) -> str:
    return response.json()["error"]["code"]


def steps(key, board_id, module, *items):
    return key.patch(f"/api/v1/boards/{board_id}/modules/{module}", json={"steps": list(items)})


def copies(key, board_id) -> list[dict]:
    return key.get(f"/api/v1/boards/{board_id}/copies").json()["copies"]


def plan(key, board_id, module) -> dict:
    return key.get(f"/api/v1/boards/{board_id}/modules/{module}").json()["gantt"]


def test_a_key_adds_a_gantt_and_keeps_it(app, admin):
    board_id = board(admin, "Plan", {"nodes": [], "edges": []})
    key = with_key(app, make_key(admin, scope="write")["token"])
    made = key.post(
        f"/api/v1/boards/{board_id}/modules",
        json={"id": "q1", "title": "Q1", "start": "2026-10-01", "end": "2026-12-31"},
    )
    assert made.status_code == 201, made.json()
    assert made.json()["created"] == ["q1"]
    answer = steps(
        key,
        board_id,
        "q1",
        {
            "op": "add_row",
            "id": "p",
            "title": "Payments",
            "start": "2026-10-05",
            "end": "2026-10-30",
        },
        {"op": "add_row", "title": "Checkout", "parent": "p"},
        {"op": "add_row", "task": "DEMO-1", "parent": "p"},
    )
    assert answer.status_code == 200, answer.json()
    body = answer.json()
    assert [m["step"] for m in body["created"]] == [0, 1, 2]
    rows = {r["id"]: r for r in body["rows"]}
    task_row = rows[body["created"][2]["id"]]
    assert task_row["key"] == "DEMO-1" and task_row["parent"] == "p"
    assert [r["id"] for r in plan(key, board_id, "q1")["rows"]][0] == "p"
    # A plan is people's work too: the first change saves the board, the next one need not.
    assert len(copies(key, board_id)) == 1
    again = steps(key, board_id, "q1", {"op": "update_row", "id": "p", "shift": 7})
    assert again.status_code == 200, again.json()
    assert len(copies(key, board_id)) == 1


def test_a_write_key_keeps_off_a_persons_gantt(app, admin):
    board_id = board(admin, "Plan", PEOPLE)
    key = with_key(app, make_key(admin, scope="write")["token"])
    refused = steps(key, board_id, "g1", {"op": "remove_row", "id": "c"})
    assert code(refused) == "not_api_element"
    assert len(plan(key, board_id, "g1")["rows"]) == 2


def test_a_full_key_changes_a_persons_gantt_after_a_copy(app, admin):
    assert admin.put("/api/settings", json={"full_keys": True}).status_code == 200
    board_id = board(admin, "Plan", PEOPLE)
    key = with_key(app, make_key(admin, scope="full")["token"])
    moved = steps(
        key,
        board_id,
        "g1",
        {"op": "move_row", "id": "c", "parent": "p"},
        {"op": "update_row", "id": "p", "title": "Payments v2"},
    )
    assert moved.status_code == 200, moved.json()
    rows = plan(key, board_id, "g1")["rows"]
    assert [(r["id"], r.get("parent")) for r in rows] == [("p", None), ("c", "p")]
    (saved,) = copies(key, board_id)
    assert saved["reason"] == "key"


def test_a_failing_step_names_itself_and_changes_nothing(app, admin):
    board_id = board(admin, "Plan", {"nodes": [], "edges": []})
    key = with_key(app, make_key(admin, scope="write")["token"])
    key.post(
        f"/api/v1/boards/{board_id}/modules",
        json={"id": "q1", "start": "2026-10-01", "end": "2026-12-31"},
    )
    failed = steps(
        key,
        board_id,
        "q1",
        {"op": "add_row", "id": "a", "title": "A"},
        {"op": "move_row", "id": "nope", "parent": "a"},
    )
    assert failed.status_code == 422
    assert failed.json()["error"]["message"] == "step 1 (move_row): row nope not found"
    assert plan(key, board_id, "q1")["rows"] == []
    missing = steps(key, board_id, "nope", {"op": "set_range", "scale": "month"})
    assert missing.status_code == 404


def test_a_gantt_open_in_a_tab_takes_steps_and_the_tab_sees_them(app, admin):
    from tests.test_live import Tab

    assert admin.put("/api/settings", json={"full_keys": True}).status_code == 200
    board_id = board(admin, "Plan", {"nodes": [], "edges": []})
    key = with_key(app, make_key(admin, scope="full")["token"])
    headers = {"cookie": f"tiko_session={admin.cookies.get('tiko_session')}"}
    sockets = TestClient(app)
    sockets.__enter__()
    try:
        with sockets.websocket_connect(f"/api/boards/{board_id}/live", headers=headers) as socket:
            tab = Tab(socket)
            # As the web app writes it: rows without `collapsed`.
            tab.add(gantt_node("g1", [ROW]) | {"width": 960, "height": 320}, order=5)
            assert "g1" in tab.ids()
            answer = steps(key, board_id, "g1", {"op": "add_row", "id": "n", "title": "New"})
            assert answer.status_code == 200, answer.json()
            tab.sync()
            content = tab.live.read()[0]["g1"]["data"]["content"]
            assert [r["id"] for r in content["rows"]] == ["p", "n"]
            assert len(copies(key, board_id)) == 1
    finally:
        sockets.__exit__(None, None, None)


def test_milestones_and_links_through_rest(app, admin):
    board_id = board(admin, "Plan", {"nodes": [], "edges": []})
    key = with_key(app, make_key(admin, scope="write")["token"])
    key.post(
        f"/api/v1/boards/{board_id}/modules",
        json={"id": "q1", "start": "2026-10-01", "end": "2026-12-31"},
    )
    answer = steps(
        key,
        board_id,
        "q1",
        {"op": "add_row", "id": "a", "title": "API"},
        {"op": "add_row", "id": "b", "title": "Client"},
        {"op": "link", "from": "a", "to": "b"},
        {"op": "add_milestone", "date": "2026-12-01", "title": "Beta"},
    )
    assert answer.status_code == 200, answer.json()
    assert [m["step"] for m in answer.json()["created"]] == [0, 1, 2, 3]
    read = plan(key, board_id, "q1")
    assert read["links"] == [{"from": "a", "to": "b"}]
    assert read["milestones"][0]["title"] == "Beta"
    stage = {"op": "add_stage", "row": "a", "type": "t", "start": "2026-10-05", "end": "2026-10-09"}
    unknown = steps(key, board_id, "q1", stage)
    assert unknown.json()["error"]["message"] == "step 0 (add_stage): stage type t not found"
    types = key.get("/api/v1/planning").json()["types"]
    staged = steps(key, board_id, "q1", stage | {"type": types[0]["id"]})
    assert staged.status_code == 200, staged.json()
    (row,) = staged.json()["rows"]
    assert row["stages"][0]["type"]["id"] == types[0]["id"]
