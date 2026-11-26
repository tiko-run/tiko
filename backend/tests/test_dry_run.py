"""Trying a write before making it (spec 057): the same answer, nothing written."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in
from tests.test_api_keys import make_key, with_key
from tests.test_api_v1_read import board
from tests.test_full_key import PEOPLE, allow
from tests.test_mcp import gantt_node


@pytest.fixture
def app():
    return create_app(Settings(db_path=":memory:"))


@pytest.fixture
def admin(app) -> TestClient:
    return signed_in(app)


@pytest.fixture
def full(app, admin):
    allow(admin)
    board_id = board(admin, "Plan", PEOPLE)
    return board_id, with_key(app, make_key(admin, scope="full")["token"])


def untouched(app, admin, board_id):
    """What a dry run must leave as it was: the saved board, copies, the API's elements."""
    return (
        admin.get(f"/api/boards/{board_id}").json(),
        app.state.copies.list(board_id),
        app.state.api_elements.of_board(board_id),
    )


def test_a_dry_add_answers_as_the_real_one_and_writes_nothing(app, admin, full):
    board_id, key = full
    before = untouched(app, admin, board_id)
    note = {"id": "agent-n", "kind": "note", "text": "Check with QA"}
    url = f"/api/v1/boards/{board_id}/elements"
    dry = key.post(url, json={"elements": [note], "dry_run": True})
    assert dry.status_code == 200, dry.json()
    assert untouched(app, admin, board_id) == before
    real = key.post(url, json={"elements": [note]})
    dry_body, real_body = dry.json(), real.json()
    assert dry_body.pop("dry_run") is True and real_body.pop("dry_run") is False
    assert dry_body == real_body
    assert real_body["elements"][0]["editable"] is True


def test_a_dry_change_names_peoples_work_and_saves_no_copy(app, admin, full):
    board_id, key = full
    before = untouched(app, admin, board_id)
    dry = key.patch(
        f"/api/v1/boards/{board_id}/elements",
        json={"changes": [{"id": "n1", "text": "Fixed"}], "dry_run": True},
    )
    assert dry.status_code == 200, dry.json()
    body = dry.json()
    assert body["overwrote"] == ["n1"] and body["elements"][0]["text"] == "Fixed"
    assert untouched(app, admin, board_id) == before


def test_a_dry_remove_lists_what_goes_with_the_arrows(app, admin, full):
    board_id, key = full
    before = untouched(app, admin, board_id)
    url = f"/api/v1/boards/{board_id}/elements/remove"
    dry = key.post(url, json={"ids": ["n2"], "dry_run": True})
    assert dry.status_code == 200, dry.json()
    assert sorted(dry.json()["removed"]) == ["e1", "n2"]
    assert sorted(dry.json()["overwrote"]) == ["e1", "n2"]
    assert untouched(app, admin, board_id) == before
    assert key.post(url, json={"ids": ["n2"]}).status_code == 204


def test_dry_gantt_steps_and_cards_write_nothing(app, admin):
    board_id = board(admin, "Plan", {"nodes": [gantt_node("g1", [])], "edges": []})
    allow(admin)
    key = with_key(app, make_key(admin, scope="full")["token"])
    before = untouched(app, admin, board_id)
    steps = key.patch(
        f"/api/v1/boards/{board_id}/modules/g1",
        json={"steps": [{"op": "add_row", "id": "a", "title": "API"}], "dry_run": True},
    )
    assert steps.status_code == 200, steps.json()
    assert [r["id"] for r in steps.json()["rows"]] == ["a"] and steps.json()["dry_run"] is True
    assert steps.json()["overwrote"] == ["g1"]
    cards = key.post(
        f"/api/v1/boards/{board_id}/elements",
        json={"elements": [{"id": "c1", "kind": "card", "ref": "DEMO-1"}], "dry_run": True},
    )
    assert cards.status_code == 200, cards.json()
    card = cards.json()["elements"][0]
    # The tracker's answer is kept as any task read keeps it, so the card reads its task.
    assert card["key"] == "DEMO-1" and card["task"] is not None
    assert untouched(app, admin, board_id) == before


def test_a_dry_run_on_an_open_board_reaches_no_tab(app, admin, full):
    from tests.test_live import Tab

    board_id, key = full
    headers = {"cookie": f"tiko_session={admin.cookies.get('tiko_session')}"}
    sockets = TestClient(app)
    sockets.__enter__()
    try:
        with sockets.websocket_connect(f"/api/boards/{board_id}/live", headers=headers) as socket:
            tab = Tab(socket)
            room = app.state.live._rooms[board_id]
            last, state = room.last, room.live.state()
            dry = key.post(
                f"/api/v1/boards/{board_id}/elements/remove",
                json={"ids": ["n2", "f1"], "dry_run": True},
            )
            assert dry.status_code == 200, dry.json()
            assert {"n2", "f1"} <= tab.ids()
            # Not even the room's own check ran: its document and saved board are as they were.
            assert room.last is last and room.live.state() == state
            assert app.state.copies.list(board_id) == []
    finally:
        sockets.__exit__(None, None, None)


def test_a_dry_arrange_moves_nothing(app, admin, full):
    board_id, key = full
    key.post(
        f"/api/v1/boards/{board_id}/elements",
        json={"elements": [{"id": "c1", "kind": "card", "ref": "DEMO-1"}]},
    )
    before = untouched(app, admin, board_id)
    dry = key.post(
        f"/api/v1/boards/{board_id}/arrange",
        json={"cards": ["c1"], "frame": {"id": "f1"}, "dry_run": True},
    )
    assert dry.status_code == 200, dry.json()
    assert dry.json()["elements"][0]["frame"] == "f1"
    assert untouched(app, admin, board_id) == before
