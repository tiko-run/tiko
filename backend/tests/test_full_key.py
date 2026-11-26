"""A key with full access, saved copies and restore (spec 055)."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in
from tests.test_api_keys import make_key, with_key
from tests.test_api_v1_read import board
from tests.test_api_v1_write import HUMAN, stored

PEOPLE = {
    "nodes": [
        *HUMAN["nodes"],
        {
            "id": "n2",
            "type": "sticky",
            "parentId": "f1",
            "position": {"x": 10, "y": 60},
            "width": 200,
            "height": 200,
            "data": {"text": "Archive me", "color": "blue"},
        },
        {
            "id": "r1",
            "type": "timer",
            "parentId": "n1",
            "position": {"x": -46, "y": 0},
            "width": 40,
            "height": 40,
            "data": {"note": "", "dueAt": "2099-01-01T09:00:00.000Z"},
        },
    ],
    "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
}


@pytest.fixture
def app():
    return create_app(Settings(db_path=":memory:"))


@pytest.fixture
def admin(app) -> TestClient:
    return signed_in(app)


def allow(admin: TestClient, on: bool = True) -> None:
    assert admin.put("/api/settings", json={"full_keys": on}).status_code == 200


@pytest.fixture
def full(app, admin):
    allow(admin)
    board_id = board(admin, "Plan", PEOPLE)
    return board_id, with_key(app, make_key(admin, scope="full")["token"])


def code(response) -> str:
    return response.json()["error"]["code"]


def change(key, board_id, *changes):
    return key.patch(f"/api/v1/boards/{board_id}/elements", json={"changes": list(changes)})


def remove(key, board_id, *ids):
    return key.post(f"/api/v1/boards/{board_id}/elements/remove", json={"ids": list(ids)})


def copies(key, board_id) -> list[dict]:
    answer = key.get(f"/api/v1/boards/{board_id}/copies")
    assert answer.status_code == 200, answer.json()
    return answer.json()["copies"]


def test_a_full_key_needs_the_workspace_to_allow_it(app, admin):
    refused = admin.post(
        "/api/me/api-keys", json={"name": "agent", "password": "x" * 20, "scope": "full"}
    )
    assert refused.status_code in (401, 403)
    allow(admin)
    assert admin.get("/api/settings").json()["full_keys"] is True
    assert make_key(admin, scope="full")["key"]["scope"] == "full"


def test_a_full_key_changes_and_removes_people_work_after_a_copy(full, admin):
    board_id, key = full
    assert copies(key, board_id) == []
    renamed = change(key, board_id, {"id": "f1", "title": "Goal: faster releases"})
    assert renamed.status_code == 200, renamed.json()
    (saved,) = copies(key, board_id)
    assert (saved["reason"], saved["elements"], saved["by"]) == ("key", 4, "Admin")
    # The copy already holds what the next call removes as it stands: no second copy.
    assert remove(key, board_id, "n2", "r1").status_code == 204
    assert len(copies(key, board_id)) == 1
    nodes = stored(admin, board_id)
    assert nodes["f1"]["data"]["title"] == "Goal: faster releases"
    assert "n2" not in nodes and "r1" not in nodes


def test_one_session_of_tidying_makes_one_copy(full):
    board_id, key = full
    change(key, board_id, {"id": "n1", "text": "Fixed typo"})
    change(key, board_id, {"id": "n1", "text": "Fixed typo again"})
    remove(key, board_id, "n2")
    assert len(copies(key, board_id)) == 1


def test_work_people_do_between_two_calls_gets_its_own_copy(full, admin):
    board_id, key = full
    change(key, board_id, {"id": "n1", "text": "Agent wrote this"})
    doc = admin.get(f"/api/boards/{board_id}").json()
    for node in doc["doc"]["nodes"]:
        if node["id"] == "n2":
            node["data"]["text"] = "A person changed this meanwhile"
    saved = admin.put(
        f"/api/boards/{board_id}", json={"version": doc["version"], "doc": doc["doc"]}
    )
    assert saved.status_code == 200, saved.json()
    remove(key, board_id, "n2")
    assert len(copies(key, board_id)) == 2


def test_adding_and_restyling_save_no_copy(full):
    board_id, key = full
    change(key, board_id, {"id": "n1", "color": "pink", "x": 0, "y": 0})
    key.post(f"/api/v1/boards/{board_id}/elements", json={"elements": [{"kind": "note"}]})
    assert copies(key, board_id) == []


def test_a_write_key_still_keeps_off_people_work(app, admin, full):
    board_id, _ = full
    writer = with_key(app, make_key(admin, scope="write")["token"])
    assert code(change(writer, board_id, {"id": "n1", "text": "x"})) == "not_api_element"
    assert copies(writer, board_id) == []
    reads = with_key(app, make_key(admin)["token"])
    assert reads.get(f"/api/v1/boards/{board_id}/copies").status_code == 403


def test_switched_off_a_full_key_acts_as_a_write_key_and_says_why(full, admin):
    board_id, key = full
    allow(admin, False)
    refused = change(key, board_id, {"id": "n1", "text": "x"})
    assert code(refused) == "not_api_element"
    assert "admin" in refused.json()["error"]["message"]


def test_reads_mark_everything_editable_for_a_full_key(full):
    board_id, key = full
    found = key.get(f"/api/v1/boards/{board_id}?elements=all").json()["elements"]
    assert all(e["editable"] for e in found)


def test_restore_puts_the_board_back_and_can_be_undone(full, admin):
    board_id, key = full
    remove(key, board_id, "n2", "f1")
    (before,) = copies(key, board_id)
    restored = key.post(f"/api/v1/boards/{board_id}/copies/{before['id']}/restore")
    assert restored.status_code == 204, restored.json()
    nodes = stored(admin, board_id)
    assert {"f1", "n2", "n1", "r1"} <= nodes.keys()
    assert nodes["n2"]["data"]["text"] == "Archive me"
    newest = copies(key, board_id)
    assert [c["reason"] for c in newest] == ["restore", "key"]
    assert newest[0]["elements"] == 2
    # Restoring the same copy again: the board equals the newest copy, so none is added.
    key.post(f"/api/v1/boards/{board_id}/copies/{newest[1]['id']}/restore")
    assert len(copies(key, board_id)) == 3


def test_only_a_full_key_restores(app, admin, full):
    board_id, key = full
    remove(key, board_id, "n2")
    (saved,) = copies(key, board_id)
    writer = with_key(app, make_key(admin, scope="write")["token"])
    refused = writer.post(f"/api/v1/boards/{board_id}/copies/{saved['id']}/restore")
    assert code(refused) == "scope_required"
    missing = key.post(f"/api/v1/boards/{board_id}/copies/nope/restore")
    assert missing.status_code == 404


def test_a_board_keeps_its_newest_copies(app, full):
    board_id, key = full
    repo = app.state.copies
    doc = app.state.boards.get(board_id).doc
    for _ in range(22):
        repo.add(board_id, doc, None, "key")
    assert len(copies(key, board_id)) == 20
    assert repo.purge("2999-01-01T00:00:00+00:00") == 20


def test_with_the_board_open_a_copy_comes_first_and_a_restore_reaches_the_tab(app, admin):
    from tests.test_live import Tab

    allow(admin)
    board_id = board(admin, "Plan", PEOPLE)
    key = with_key(app, make_key(admin, scope="full")["token"])
    headers = {"cookie": f"tiko_session={admin.cookies.get('tiko_session')}"}
    sockets = TestClient(app)
    sockets.__enter__()
    try:
        with sockets.websocket_connect(f"/api/boards/{board_id}/live", headers=headers) as socket:
            tab = Tab(socket)
            assert board_id in app.state.live._rooms
            assert remove(key, board_id, "n2", "f1").status_code == 204
            assert "n2" not in tab.ids()
            (saved,) = copies(key, board_id)
            restored = key.post(f"/api/v1/boards/{board_id}/copies/{saved['id']}/restore")
            assert restored.status_code == 204, restored.json()
            assert {"n1", "n2", "f1", "r1"} <= tab.ids()
            assert [c["reason"] for c in copies(key, board_id)] == ["restore", "key"]
    finally:
        sockets.__exit__(None, None, None)


def test_a_copy_past_its_days_does_not_spare_a_new_one(app, full):
    board_id, key = full
    change(key, board_id, {"id": "n1", "text": "Fixed"})
    with app.state.copies._db.jobs() as conn:
        conn.execute(
            "UPDATE board_copies SET saved_at = now() - interval '15 days' WHERE board_id = %s",
            (board_id,),
        )
    remove(key, board_id, "n2")
    assert len(copies(key, board_id)) == 2


def test_a_full_key_removes_a_gantt_a_tab_wrote_with_one_copy(app, admin):
    from tests.test_live import Tab
    from tests.test_mcp import gantt_node

    allow(admin)
    board_id = board(admin, "Plan", PEOPLE)
    key = with_key(app, make_key(admin, scope="full")["token"])
    # As the web app writes it: no `collapsed`, which a parsed copy fills in.
    row = {"id": "a", "title": "Payments", "start": "2026-10-05", "end": "2026-10-09"}
    gantt = gantt_node("g1", [row], y=600) | {"width": 960, "height": 320}
    headers = {"cookie": f"tiko_session={admin.cookies.get('tiko_session')}"}
    sockets = TestClient(app)
    sockets.__enter__()
    try:
        with sockets.websocket_connect(f"/api/boards/{board_id}/live", headers=headers) as socket:
            tab = Tab(socket)
            tab.add(gantt, order=5)
            assert "g1" in tab.ids()
            renamed = change(key, board_id, {"id": "f1", "title": "Goals"})
            assert renamed.status_code == 200, renamed.json()
            removed = remove(key, board_id, "g1")
            assert removed.status_code == 204, removed.json()
            assert "g1" not in tab.ids()
            assert len(copies(key, board_id)) == 1
    finally:
        sockets.__exit__(None, None, None)
