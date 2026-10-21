"""Spec 033 US3: stars and folders are a person's own."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.folders import FOLDER_LIMIT
from app.main import create_app
from tests.conftest import all_rows, signed_in

LONG = "long-enough-password"


def join(app, admin: TestClient, name: str) -> TestClient:
    url = admin.post("/api/invites", json={"role": "member"}).json()["url"]
    client = TestClient(app)
    accepted = client.post(
        f"/api/invites/{url.split('=', 1)[1]}/accept",
        json={"username": name, "name": name.title(), "password": LONG},
    )
    assert accepted.is_success, accepted.text
    return client


def me(client: TestClient) -> str:
    return client.get("/api/auth/status").json()["me"]["id"]


@pytest.fixture
def world():
    """ann owns a board shared with bob as an editor; carl has no role on it."""
    app = create_app(Settings(db_path=":memory:"))
    admin = signed_in(app)
    ann, bob, carl = (join(app, admin, name) for name in ("ann", "bob", "carl"))
    board = ann.post("/api/boards", json={"name": "Sprint"}).json()["id"]
    shared = ann.put(f"/api/boards/{board}/members/{me(bob)}", json={"role": "editor"})
    assert shared.is_success
    return app, ann, bob, carl, board


def listed(client: TestClient, board_id: str) -> dict | None:
    boards = client.get("/api/boards").json()["boards"]
    return next((b for b in boards if b["id"] == board_id), None)


def folder(client: TestClient, name: str) -> dict:
    response = client.post("/api/folders", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def forget(app) -> int:
    return app.state.folders.forget_unreachable()


def test_a_star_is_the_persons_own(world):
    _, ann, bob, _, board = world
    assert listed(ann, board)["starred"] is False
    assert ann.put(f"/api/boards/{board}/star").status_code == 204
    # Twice is fine: the star is a state, not a counter.
    assert ann.put(f"/api/boards/{board}/star").status_code == 204
    assert listed(ann, board)["starred"] is True
    assert listed(bob, board)["starred"] is False
    assert ann.get(f"/api/boards/{board}").json()["starred"] is True
    assert ann.delete(f"/api/boards/{board}/star").status_code == 204
    assert listed(ann, board)["starred"] is False


def test_no_star_or_folder_on_a_board_one_cannot_open(world):
    _, _, _, carl, board = world
    place = folder(carl, "Mine")
    assert carl.put(f"/api/boards/{board}/star").status_code == 404
    assert (
        carl.put(f"/api/boards/{board}/folder", json={"folder_id": place["id"]}).status_code == 404
    )


def test_folders_are_kept_in_order(world):
    _, ann, bob, _, _ = world
    team, archive, ideas = (folder(ann, name) for name in ("Team", "Archive", "Ideas"))
    assert [f["position"] for f in (team, archive, ideas)] == [1, 2, 3]
    assert bob.get("/api/folders").json() == {"folders": []}

    moved = ann.patch(f"/api/folders/{ideas['id']}", json={"position": 1})
    assert moved.json() == {"id": ideas["id"], "name": "Ideas", "position": 1}
    renamed = ann.patch(f"/api/folders/{team['id']}", json={"name": "  Squad  "})
    assert renamed.json()["name"] == "Squad"
    # Past the end lands last.
    ann.patch(f"/api/folders/{ideas['id']}", json={"position": 9})
    names = [(f["name"], f["position"]) for f in ann.get("/api/folders").json()["folders"]]
    assert names == [("Squad", 1), ("Archive", 2), ("Ideas", 3)]


def test_folder_names_and_changes_are_checked(world):
    _, ann, bob, _, _ = world
    for name in ("", "   ", "x" * 61):
        assert ann.post("/api/folders", json={"name": name}).status_code == 422
    assert ann.post("/api/folders", json={"name": "x" * 60}).status_code == 201
    team = folder(ann, "Team")
    assert ann.patch(f"/api/folders/{team['id']}", json={}).status_code == 422
    assert ann.patch(f"/api/folders/{team['id']}", json={"position": 0}).status_code == 422
    # Someone else's folder is not there for them.
    assert bob.patch(f"/api/folders/{team['id']}", json={"name": "Mine"}).status_code == 404
    assert bob.delete(f"/api/folders/{team['id']}").status_code == 404
    assert ann.get("/api/folders").json()["folders"][1]["name"] == "Team"


def test_folder_limit(world):
    app, ann, _, _, _ = world
    user = me(ann)
    for n in range(FOLDER_LIMIT):
        assert app.state.folders.add(user, f"f{n}", FOLDER_LIMIT) is not None
    response = ann.post("/api/folders", json={"name": "One more"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "folder_limit"


def test_a_board_sits_in_one_folder_of_its_keeper(world):
    _, ann, bob, _, board = world
    team, archive = folder(ann, "Team"), folder(ann, "Archive")
    theirs = folder(bob, "Theirs")

    assert ann.put(f"/api/boards/{board}/folder", json={"folder_id": team["id"]}).status_code == 204
    assert listed(ann, board)["folder_id"] == team["id"]
    assert listed(bob, board)["folder_id"] is None
    ann.put(f"/api/boards/{board}/folder", json={"folder_id": archive["id"]})
    assert listed(ann, board)["folder_id"] == archive["id"]
    # A folder of someone else answers as missing and changes nothing.
    wrong = ann.put(f"/api/boards/{board}/folder", json={"folder_id": theirs["id"]})
    assert wrong.status_code == 404
    assert listed(ann, board)["folder_id"] == archive["id"]
    assert ann.put(f"/api/boards/{board}/folder", json={"folder_id": None}).status_code == 204
    assert listed(ann, board)["folder_id"] is None


def test_deleting_a_folder_keeps_its_boards(world):
    _, ann, _, _, board = world
    team = folder(ann, "Team")
    ann.put(f"/api/boards/{board}/folder", json={"folder_id": team["id"]})
    assert ann.delete(f"/api/folders/{team['id']}").status_code == 204
    assert listed(ann, board)["folder_id"] is None
    assert ann.get(f"/api/boards/{board}").status_code == 200
    assert ann.get("/api/folders").json() == {"folders": []}


def test_losing_access_takes_the_star_and_the_place(world):
    app, ann, bob, _, board = world
    keep = folder(bob, "Keep")
    bob.put(f"/api/boards/{board}/star")
    bob.put(f"/api/boards/{board}/folder", json={"folder_id": keep["id"]})
    ann.put(f"/api/boards/{board}/star")
    assert forget(app) == 0

    ann.delete(f"/api/boards/{board}/members/{me(bob)}")
    assert listed(bob, board) is None
    assert forget(app) == 2
    # Access given back starts without them; ann's own star stays.
    ann.put(f"/api/boards/{board}/members/{me(bob)}", json={"role": "viewer"})
    back = listed(bob, board)
    assert (back["starred"], back["folder_id"]) == (False, None)
    assert listed(ann, board)["starred"] is True
    assert bob.get("/api/folders").json()["folders"] == [keep]


def test_everyone_role_and_admins_keep_their_stars(world):
    app, ann, _, carl, board = world
    ann.put(f"/api/boards/{board}/everyone", json={"role": "viewer"})
    assert carl.put(f"/api/boards/{board}/star").status_code == 204
    admin = signed_in(app)
    assert admin.put(f"/api/boards/{board}/star").status_code == 204
    assert forget(app) == 0
    ann.put(f"/api/boards/{board}/everyone", json={"role": None})
    # Carl had it through everyone; the admin opens every board.
    assert forget(app) == 1
    assert admin.get("/api/boards").json()["all"][0]["starred"] is True


def test_leaving_the_workspace_takes_folders_too(world):
    app, ann, bob, _, board = world
    folder(bob, "Keep")
    bob.put(f"/api/boards/{board}/star")
    bob_id = me(bob)
    admin = signed_in(app)
    assert admin.delete(f"/api/people/{bob_id}").is_success
    # The account stays; its folder and star in this workspace go.
    assert forget(app) == 2
    assert "Keep" not in all_rows(app)


def test_rows_go_with_their_board_and_person(world):
    app, ann, bob, _, board = world
    team = folder(ann, "Team")
    ann.put(f"/api/boards/{board}/star")
    ann.put(f"/api/boards/{board}/folder", json={"folder_id": team["id"]})
    bob.put(f"/api/boards/{board}/star")
    assert ann.delete(f"/api/boards/{board}").status_code == 204
    rows = all_rows(app)
    assert board not in rows
    assert "Team" in rows
