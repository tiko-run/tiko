"""Writing to boards through API v1 (spec 046, slices api-write and api-arrange)."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in
from tests.test_api_keys import make_key, with_key
from tests.test_api_v1_read import board

HUMAN = {
    "nodes": [
        {
            "id": "f1",
            "type": "frame",
            "position": {"x": 100, "y": 100},
            "width": 480,
            "height": 320,
            "data": {"title": "Sprint"},
        },
        {
            "id": "n1",
            "type": "sticky",
            "position": {"x": 900, "y": 0},
            "width": 200,
            "height": 200,
            "data": {"text": "Written by a person", "color": "yellow"},
        },
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
def setup(app, admin):
    board_id = board(admin, "Plan", HUMAN)
    key = with_key(app, make_key(admin, scope="write")["token"])
    return board_id, key


def code(response) -> str:
    return response.json()["error"]["code"]


def elements(key: TestClient, board_id: str) -> dict:
    found = key.get(f"/api/v1/boards/{board_id}?elements=all").json()["elements"]
    return {e["id"]: e for e in found}


def add(key, board_id, *items):
    return key.post(f"/api/v1/boards/{board_id}/elements", json={"elements": list(items)})


def test_a_read_key_cannot_write(app, admin):
    board_id = board(admin, "Plan", HUMAN)
    reader = with_key(app, make_key(admin)["token"])
    response = add(reader, board_id, {"kind": "note", "text": "hi"})
    assert (response.status_code, code(response)) == (403, "scope_required")


def test_elements_are_added_and_marked_as_the_callers(setup):
    board_id, key = setup
    response = add(
        key,
        board_id,
        {"id": "agent-n1", "kind": "note", "text": "Blocked on QA", "color": "pink", "frame": "f1"},
        {"id": "agent-c1", "kind": "card", "ref": "DEMO-1"},
        {"id": "agent-a1", "kind": "arrow", "from": "agent-n1", "to": "agent-c1"},
        {"kind": "text", "text": "Plain words", "x": 50, "y": 900},
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["created"][:3] == ["agent-n1", "agent-c1", "agent-a1"]
    assert len(body["created"]) == 4
    now = elements(key, board_id)
    note = now["agent-n1"]
    assert (note["frame"], note["text"], note["color"], note["editable"]) == (
        "f1",
        "Blocked on QA",
        "pink",
        True,
    )
    # Placed inside the frame, below its title.
    assert note["x"] >= 100 and note["y"] >= 100 + 40
    assert now["agent-c1"]["task"]["title"]
    assert (now["agent-a1"]["from"], now["agent-a1"]["to"]) == ("agent-n1", "agent-c1")
    text = next(e for e in body["elements"] if e["kind"] == "text")
    assert (text["x"], text["y"]) == (50, 900)
    assert now["n1"]["editable"] is False


def test_a_retry_answers_with_what_is_there(setup):
    board_id, key = setup
    note = {"id": "agent-n1", "kind": "note", "text": "First"}
    assert add(key, board_id, note).json()["created"] == ["agent-n1"]
    again = add(key, board_id, note | {"text": "Second"})
    assert again.status_code == 200
    assert again.json()["created"] == []
    assert again.json()["elements"][0]["text"] == "First"


def test_an_id_a_person_holds_is_a_conflict(setup):
    board_id, key = setup
    response = add(key, board_id, {"id": "n1", "kind": "note", "text": "mine now"})
    assert (response.status_code, code(response)) == (409, "conflict")


def test_people_elements_move_but_keep_their_words(setup):
    board_id, key = setup
    patch = key.patch(
        f"/api/v1/boards/{board_id}/elements", json={"changes": [{"id": "n1", "text": "edited"}]}
    )
    assert (patch.status_code, code(patch)) == (409, "not_api_element")
    moved = key.patch(
        f"/api/v1/boards/{board_id}/elements",
        json={"changes": [{"id": "n1", "x": 10, "y": 20, "frame": "f1"}]},
    )
    assert moved.status_code == 200, moved.json()
    note = elements(key, board_id)["n1"]
    assert (note["x"], note["y"], note["frame"], note["text"]) == (
        10,
        20,
        "f1",
        "Written by a person",
    )


def test_taking_an_element_out_of_its_frame_keeps_its_place(setup):
    board_id, key = setup
    add(key, board_id, {"id": "agent-n1", "kind": "note", "x": 150, "y": 200, "frame": "f1"})
    out = key.patch(
        f"/api/v1/boards/{board_id}/elements", json={"changes": [{"id": "agent-n1", "frame": None}]}
    )
    assert out.status_code == 200
    note = elements(key, board_id)["agent-n1"]
    assert (note["x"], note["y"], note["frame"]) == (150, 200, None)


def test_only_the_api_elements_go(setup):
    board_id, key = setup
    add(key, board_id, {"id": "agent-n1", "kind": "note", "text": "temp"})
    url = f"/api/v1/boards/{board_id}/elements/remove"
    assert key.post(url, json={"ids": ["agent-n1"]}).status_code == 204
    assert key.post(url, json={"ids": ["agent-n1"]}).status_code == 204
    person = key.post(url, json={"ids": ["n1"]})
    assert (person.status_code, code(person)) == (409, "not_api_element")
    assert "agent-n1" not in elements(key, board_id)


def test_a_removal_never_takes_a_persons_arrow(app, admin, setup):
    board_id, key = setup
    add(key, board_id, {"id": "agent-n1", "kind": "note", "text": "temp"})
    current = admin.get(f"/api/boards/{board_id}").json()
    doc = current["doc"] | {"edges": [{"id": "e1", "source": "n1", "target": "agent-n1"}]}
    saved = admin.put(f"/api/boards/{board_id}", json={"version": current["version"], "doc": doc})
    assert saved.status_code == 200
    response = key.post(f"/api/v1/boards/{board_id}/elements/remove", json={"ids": ["agent-n1"]})
    assert (response.status_code, code(response)) == (409, "keeps_people_work")


def test_a_batch_is_all_or_nothing(app, setup):
    board_id, key = setup
    before = elements(key, board_id)
    rows = app.state.api_elements.of_board(board_id)
    missing = add(
        key,
        board_id,
        {"id": "agent-ok", "kind": "note", "text": "fine"},
        {"kind": "arrow", "from": "agent-ok", "to": "nowhere"},
    )
    assert missing.status_code == 404
    bad_colour = add(
        key,
        board_id,
        {"id": "agent-ok", "kind": "note", "text": "fine"},
        {"kind": "frame", "title": "Odd", "color": "purple"},
    )
    assert (bad_colour.status_code, code(bad_colour)) == (422, "validation_failed")
    assert elements(key, board_id) == before
    taken = add(key, board_id, {"id": "n1", "kind": "note", "text": "mine now"})
    assert code(taken) == "conflict"
    # No row was written for any of them, not even for a moment's claim on a person's note.
    assert app.state.api_elements.of_board(board_id) == rows


def test_a_public_board_needs_a_key_that_chose_it(app, admin, setup):
    board_id, key = setup
    assert admin.put(f"/api/boards/{board_id}/public", json={"public": True}).status_code == 200
    refused = add(key, board_id, {"kind": "note", "text": "leak"})
    assert (refused.status_code, code(refused)) == (403, "public_board")
    chosen = with_key(app, make_key(admin, scope="write", boards=[board_id])["token"])
    assert add(chosen, board_id, {"kind": "note", "text": "on purpose"}).status_code == 200


def test_a_new_board_joins_a_key_for_chosen_boards(app, admin):
    first = board(admin, "First", HUMAN)
    key = with_key(app, make_key(admin, scope="write", boards=[first])["token"])
    made = key.post("/api/v1/boards", json={"name": "Made by an agent"})
    assert made.status_code == 201
    new_id = made.json()["id"]
    assert {b["id"] for b in key.get("/api/v1/boards").json()["boards"]} == {first, new_id}
    assert add(key, new_id, {"kind": "note", "text": "hello"}).status_code == 200


def test_arrange_by_status_in_a_new_frame(setup):
    board_id, key = setup
    cards = [{"id": f"c{i}", "kind": "card", "ref": f"DEMO-{i}"} for i in (1, 2, 3, 4)]
    assert add(key, board_id, *cards).status_code == 200
    response = key.post(
        f"/api/v1/boards/{board_id}/arrange",
        json={
            "cards": ["c1", "c2", "c3", "c4"],
            "layout": "status",
            "frame": {"title": "By status"},
        },
    )
    assert response.status_code == 200, response.json()
    (frame_id,) = response.json()["created"]
    now = elements(key, board_id)
    assert now[frame_id]["title"] == "By status"
    assert {now[f"c{i}"]["frame"] for i in (1, 2, 3, 4)} == {frame_id}
    # One column per status: cards of one status share x.
    by_status: dict[str, set[float]] = {}
    for i in (1, 2, 3, 4):
        card = now[f"c{i}"]
        by_status.setdefault(card["task"]["status"], set()).add(card["x"])
    assert all(len(xs) == 1 for xs in by_status.values())
    frame = now[frame_id]
    for i in (1, 2, 3, 4):
        assert now[f"c{i}"]["y"] < frame["y"] + frame["h"]


def test_a_running_vote_keeps_words_but_lets_things_move(app, admin, setup):
    board_id, key = setup
    add(key, board_id, {"id": "agent-n1", "kind": "note", "text": "Option A"})
    vote = admin.post(
        f"/api/boards/{board_id}/votes", json={"name": "Pick", "elements": ["agent-n1"]}
    )
    assert vote.status_code == 201, vote.json()
    url = f"/api/v1/boards/{board_id}/elements"
    text = key.patch(url, json={"changes": [{"id": "agent-n1", "text": "Option B"}]})
    assert (text.status_code, code(text)) == (409, "vote_running")
    assert key.patch(url, json={"changes": [{"id": "agent-n1", "x": 5, "y": 5}]}).status_code == 200


def test_cards_must_exist(setup):
    board_id, key = setup
    response = add(key, board_id, {"kind": "card", "ref": "DEMO-99999"})
    assert (response.status_code, code(response)) == (404, "task_not_found")


def test_an_api_write_reaches_an_open_tab_and_keeps_a_persons_edit():
    from tests.test_live import LONG, World, sticky

    world = World()
    try:
        board_id = world.board([sticky("mine")])
        ann = world.clients["ann"]
        made = ann.post(
            "/api/me/api-keys",
            json={"name": "agent", "password": LONG, "scope": "write"},
        ).json()
        key = with_key(world.app, made["token"])
        with world.tab("ann", board_id) as tab:
            assert tab.ids() == {"mine"}
            # The person adds a note while the agent writes: neither loses the other's.
            tab.add(sticky("typed-by-ann"), order=2)
            response = add(key, board_id, {"id": "agent-n1", "kind": "note", "text": "from AI"})
            assert response.status_code == 200, response.json()
            assert tab.ids() == {"mine", "typed-by-ann", "agent-n1"}
        # Saved before the answer: a read right after it sees the note.
        assert "agent-n1" in elements(key, board_id)
    finally:
        world.sockets.__exit__(None, None, None)


def test_a_null_place_is_refused_in_words(setup):
    board_id, key = setup
    nulls = {"changes": [{"id": "n1", "x": None, "y": None}]}
    response = key.patch(f"/api/v1/boards/{board_id}/elements", json=nulls)
    assert (response.status_code, code(response)) == (422, "invalid_request")
