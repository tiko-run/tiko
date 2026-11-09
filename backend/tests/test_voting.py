import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in

pytestmark = pytest.mark.shared_rows

LONG = "long-enough-password"
PEOPLE = ["ann", "bob", "carl", "dave"]


@pytest.fixture(scope="module")
def world():
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("TIKO_PASSWORD", "test-password")
        app = create_app(Settings(db_path=":memory:"))
        admin = signed_in(app)
        clients, ids = {"admin": admin}, {}
        for name in PEOPLE:
            url = admin.post("/api/invites", json={"role": "member"}).json()["url"]
            client = TestClient(app)
            client.post(
                f"/api/invites/{url.split('=', 1)[1]}/accept",
                json={"username": name, "name": name.title(), "password": LONG},
            )
            clients[name] = client
            ids[name] = client.get("/api/auth/status").json()["me"]["id"]
        yield app, clients, ids


def new_board(world) -> str:
    """ann owns it, bob edits, carl views, dave has no role."""
    _, clients, ids = world
    ann = clients["ann"]
    board_id = ann.post("/api/boards", json={"name": "Retro"}).json()["id"]
    version = ann.get(f"/api/boards/{board_id}").json()["version"]
    doc = {
        "nodes": [
            {"id": n, "type": "sticky", "position": {"x": 0, "y": 0}, "data": {"text": n.upper()}}
            for n in ("a", "b", "c")
        ],
        "edges": [],
    }
    assert ann.put(f"/api/boards/{board_id}", json={"version": version, "doc": doc}).is_success
    for who, role in (("bob", "editor"), ("carl", "viewer")):
        assert ann.put(f"/api/boards/{board_id}/members/{ids[who]}", json={"role": role}).is_success
    return board_id


def start(client, board_id, **settings):
    body = {"name": "Topics", "elements": ["a", "b", "c"], **settings}
    return client.post(f"/api/boards/{board_id}/votes", json=body)


def ballot(client, board_id, round_id, element, delta=1):
    return client.post(
        f"/api/boards/{board_id}/votes/{round_id}/ballot",
        json={"element": element, "delta": delta},
    )


def test_editors_start_a_round_and_only_one_runs(world):
    _, clients, _ = world
    board_id = new_board(world)
    assert start(clients["carl"], board_id).status_code == 403
    assert start(clients["dave"], board_id).status_code == 404
    started = start(clients["bob"], board_id)
    assert started.status_code == 201
    view = started.json()
    assert view["state"] == "running" and view["joined"] and view["left"] == 5
    assert start(clients["ann"], board_id).status_code == 409


def test_votes_stay_secret_until_the_end_and_anonymous_results_name_nobody(world):
    _, clients, _ = world
    board_id = new_board(world)
    round_id = start(clients["bob"], board_id, votes=3).json()["id"]
    for _ in range(3):
        assert ballot(clients["carl"], board_id, round_id, "a").is_success
    assert ballot(clients["carl"], board_id, round_id, "b").status_code == 422
    assert ballot(clients["ann"], board_id, round_id, "b").is_success
    assert ballot(clients["ann"], board_id, round_id, "zzz").status_code == 422

    seen = clients["ann"].get(f"/api/boards/{board_id}/votes").json()["running"]
    assert seen["mine"] == {"b": 1} and seen["results"] is None
    assert seen["joined_count"] == 3 and seen["done_count"] == 1
    # ann owns the board: she sees who is still voting, never what they picked.
    assert seen["still_voting"] == ["Ann", "Bob"]
    assert (
        clients["carl"].get(f"/api/boards/{board_id}/votes").json()["running"]["still_voting"]
        is None
    )

    assert clients["carl"].post(f"/api/boards/{board_id}/votes/{round_id}/end").status_code == 403
    ended = clients["bob"].post(f"/api/boards/{board_id}/votes/{round_id}/end").json()
    assert ended["state"] == "ended"
    assert [(r["element"], r["count"], r["text"], r["voters"]) for r in ended["results"]] == [
        ("a", 3, "A", None),
        ("b", 1, "B", None),
    ]
    assert ballot(clients["carl"], board_id, round_id, "c").status_code == 409
    past = clients["carl"].get(f"/api/boards/{board_id}/votes").json()
    assert past["running"] is None and past["past"][0]["voted_count"] == 2


def test_an_open_round_names_voters_and_one_vote_per_element_holds(world):
    _, clients, _ = world
    board_id = new_board(world)
    round_id = start(clients["ann"], board_id, stack=False, anonymous=False).json()["id"]
    assert ballot(clients["bob"], board_id, round_id, "c").is_success
    assert ballot(clients["bob"], board_id, round_id, "c").status_code == 422
    assert ballot(clients["bob"], board_id, round_id, "c", -1).is_success
    assert ballot(clients["bob"], board_id, round_id, "c", -1).status_code == 422
    assert ballot(clients["bob"], board_id, round_id, "a").is_success
    ended = clients["ann"].post(f"/api/boards/{board_id}/votes/{round_id}/end").json()
    assert ended["results"] == [
        {"element": "a", "count": 1, "text": "A", "voters": [{"name": "Bob", "count": 1}]}
    ]


def test_a_round_ends_when_its_time_runs_out(world):
    app, clients, _ = world
    board_id = new_board(world)
    voting = app.state.voting
    round_id = start(clients["ann"], board_id, minutes=1).json()["id"]
    real = voting._clock
    try:
        later = real() + 61
        voting._clock = lambda: later
        assert clients["carl"].get(f"/api/boards/{board_id}/votes").json()["running"] is None
        view = clients["carl"].get(f"/api/boards/{board_id}/votes/{round_id}").json()
        assert view["state"] == "ended"
    finally:
        voting._clock = real


def test_only_the_starter_or_owner_extends_renames_and_deletes(world):
    _, clients, _ = world
    board_id = new_board(world)
    view = start(clients["bob"], board_id, minutes=2).json()
    base = f"/api/boards/{board_id}/votes/{view['id']}"
    assert clients["carl"].post(f"{base}/extend").status_code == 403
    longer = clients["ann"].post(f"{base}/extend").json()
    assert longer["ends_at"] > view["ends_at"]
    assert clients["bob"].patch(base, json={"name": "Next"}).json()["name"] == "Next"
    assert clients["carl"].delete(base).status_code == 403
    assert clients["ann"].delete(base).status_code == 204
    assert clients["ann"].get(base).status_code == 404


def test_nobody_outside_the_board_reads_its_votes(world):
    _, clients, _ = world
    board_id = new_board(world)
    round_id = start(clients["ann"], board_id).json()["id"]
    base = f"/api/boards/{board_id}/votes"
    for _ in range(2):
        assert clients["dave"].get(base).status_code == 404
        assert clients["dave"].get(f"{base}/{round_id}").status_code == 404
        clients["ann"].post(f"{base}/{round_id}/end")


def test_an_untimed_round_cannot_be_extended_and_only_notes_and_cards_take_part(world):
    _, clients, _ = world
    board_id = new_board(world)
    view = start(clients["ann"], board_id, minutes=None).json()
    assert view["ends_at"] is None
    extended = clients["ann"].post(f"/api/boards/{board_id}/votes/{view['id']}/extend")
    assert extended.status_code == 422
    clients["ann"].post(f"/api/boards/{board_id}/votes/{view['id']}/end")

    other = new_board(world)
    ann = clients["ann"]
    version = ann.get(f"/api/boards/{other}").json()["version"]
    frame = {"id": "f", "type": "frame", "position": {"x": 0, "y": 0}, "data": {"title": "F"}}
    doc = {"nodes": [frame], "edges": []}
    assert ann.put(f"/api/boards/{other}", json={"version": version, "doc": doc}).is_success
    refused = ann.post(f"/api/boards/{other}/votes", json={"name": "F", "elements": ["f"]})
    assert refused.status_code == 422


def test_done_is_kept_apart_from_spending_every_vote(world):
    _, clients, _ = world
    board_id = new_board(world)
    round_id = start(clients["ann"], board_id, votes=1).json()["id"]
    spent = ballot(clients["bob"], board_id, round_id, "a").json()
    assert spent["done"] and not spent["marked_done"]
    marked = clients["carl"].post(
        f"/api/boards/{board_id}/votes/{round_id}/done", json={"done": True}
    )
    assert marked.json()["marked_done"]


def test_a_save_without_an_open_board_keeps_the_notes_of_a_vote(world):
    _, clients, _ = world
    board_id = new_board(world)
    start(clients["ann"], board_id, elements=["a"])
    ann = clients["ann"]
    version = ann.get(f"/api/boards/{board_id}").json()["version"]
    empty = {"nodes": [], "edges": []}
    assert ann.put(f"/api/boards/{board_id}", json={"version": version, "doc": empty}).is_success
    left = [n["id"] for n in ann.get(f"/api/boards/{board_id}").json()["doc"]["nodes"]]
    assert left == ["a"]
