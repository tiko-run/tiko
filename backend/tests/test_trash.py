"""Spec 033 US4: a deleted board waits 30 days in its owner's trash."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.boards import TRASH_DAYS, BoardDoc, purge_trash
from app.domain.errors import NotFound, VersionConflict
from app.main import create_app
from tests.conftest import add_person, all_rows, signed_in
from tests.test_folders import folder, join, listed, me

NOW = datetime.now(UTC)


@pytest.fixture
def world():
    """ann owns a public board shared with bob as an editor; carl has no role on it."""
    app = create_app(Settings(db_path=":memory:", tiko_board_limit=2))
    admin = signed_in(app)
    ann, bob, carl = (join(app, admin, name) for name in ("ann", "bob", "carl"))
    board = ann.post("/api/boards", json={"name": "Sprint"}).json()["id"]
    assert ann.put(f"/api/boards/{board}/members/{me(bob)}", json={"role": "editor"}).is_success
    token = ann.put(f"/api/boards/{board}/public", json={"public": True}).json()["public_token"]
    return app, admin, ann, bob, carl, board, token


def trash(client: TestClient) -> list[dict]:
    response = client.get("/api/trash")
    assert response.status_code == 200, response.text
    return response.json()["boards"]


def test_a_deleted_board_is_closed_for_everyone_and_waits_in_its_owners_trash(world):
    app, admin, ann, bob, carl, board, token = world
    assert bob.delete(f"/api/boards/{board}").status_code == 403
    assert ann.delete(f"/api/boards/{board}").status_code == 204

    for client in (ann, bob, carl, admin):
        assert listed(client, board) is None
        for path in ("", "/members", "/preview"):
            assert client.get(f"/api/boards/{board}{path}").status_code == 404
        assert client.put(f"/api/boards/{board}/star").status_code == 404
    assert TestClient(app).get(f"/api/public/{token}").status_code == 404
    # Already in the trash: an ordinary delete finds nothing.
    assert ann.delete(f"/api/boards/{board}").status_code == 404

    [entry] = trash(ann)
    assert entry["id"] == board and entry["name"] == "Sprint"
    assert entry["owner"] == {"id": me(ann), "name": "Ann"}
    assert entry["deleted_by"] == {"id": me(ann), "name": "Ann"}
    deleted = datetime.fromisoformat(entry["deleted_at"])
    assert datetime.fromisoformat(entry["purge_at"]) == deleted + timedelta(days=TRASH_DAYS)
    assert trash(bob) == [] and trash(carl) == []


def test_a_restore_brings_back_members_roles_link_star_and_folder(world):
    app, _, ann, bob, _, board, token = world
    team = folder(bob, "Team")
    bob.put(f"/api/boards/{board}/star")
    bob.put(f"/api/boards/{board}/folder", json={"folder_id": team["id"]})
    ann.delete(f"/api/boards/{board}")
    # A trashed board is not lost access: the hourly job leaves its rows alone.
    app.state.folders.forget_unreachable()

    assert ann.post(f"/api/boards/{board}/restore").status_code == 204
    assert trash(ann) == []
    again = listed(bob, board)
    assert again["my_role"] == "editor" and again["starred"] and again["folder_id"] == team["id"]
    assert TestClient(app).get(f"/api/public/{token}").status_code == 200
    assert ann.post(f"/api/boards/{board}/restore").status_code == 404


def test_only_the_owner_and_an_admin_reach_the_trash(world):
    _, admin, ann, bob, carl, board, _ = world
    ann.delete(f"/api/boards/{board}")
    for client in (bob, carl):
        assert client.post(f"/api/boards/{board}/restore").status_code == 404
        assert client.delete(f"/api/boards/{board}?forever=1").status_code == 404

    [entry] = trash(admin)
    assert entry["owner"]["id"] == me(ann)
    # An admin restores anyone's board but deletes for good only their own.
    assert admin.delete(f"/api/boards/{board}?forever=1").status_code == 403
    assert admin.post(f"/api/boards/{board}/restore").status_code == 204
    assert listed(bob, board) is not None


def test_delete_for_good_takes_every_row_and_frees_the_limit(world):
    app, _, ann, bob, _, board, _ = world
    bob.put(f"/api/boards/{board}/star")
    assert ann.post("/api/boards", json={"name": "Second"}).status_code == 201
    # Only a board in the trash goes for good.
    assert ann.delete(f"/api/boards/{board}?forever=1").status_code == 404
    ann.delete(f"/api/boards/{board}")
    # A trashed board still counts against the limit.
    full = ann.post("/api/boards", json={"name": "Third"})
    assert full.status_code == 409 and full.json()["error"]["code"] == "board_limit"

    assert ann.delete(f"/api/boards/{board}?forever=1").status_code == 204
    assert board not in all_rows(app)
    assert trash(ann) == []
    assert ann.post("/api/boards", json={"name": "Third"}).status_code == 201


def test_a_removed_owner_hands_their_trash_to_the_admin(world):
    _, admin, ann, _, _, board, _ = world
    ann.delete(f"/api/boards/{board}")
    assert admin.delete(f"/api/people/{me(ann)}").status_code == 204
    [entry] = trash(admin)
    assert entry["owner"]["id"] == me(admin)
    assert admin.delete(f"/api/boards/{board}?forever=1").status_code == 204


def age(app, board_id: str, days: float) -> None:
    with app.state.boards._db.jobs() as conn:
        conn.execute(
            "UPDATE boards SET deleted_at = %s WHERE id = %s",
            (NOW - timedelta(days=days), board_id),
        )


def test_the_hourly_job_deletes_what_waited_30_days(world):
    app, _, ann, _, _, board, _ = world
    young = ann.post("/api/boards", json={"name": "Young"}).json()["id"]
    ann.delete(f"/api/boards/{board}")
    ann.delete(f"/api/boards/{young}")
    age(app, board, TRASH_DAYS + 0.01)
    age(app, young, TRASH_DAYS - 1)

    assert purge_trash(app.state.boards, NOW) == 1
    assert board not in all_rows(app)
    assert [b["id"] for b in trash(ann)] == [young]
    assert purge_trash(app.state.boards, NOW) == 0


def test_no_storage_read_or_write_reaches_a_trashed_board(store):
    mod, db = store
    owner, other = add_person(store, "u-owner"), add_person(store, "u-other")
    boards, members, folders = mod.BoardRepo(db), mod.MemberRepo(db), mod.FolderRepo(db)
    board = boards.create("Plan", BoardDoc(), owner)
    boards.ensure_public_token(board, "tok-trash")
    place = folders.add(other, "Mine", 10)
    boards.delete(board, owner)

    assert boards.listing(owner) == [] and boards.listing(owner, board) == []
    assert boards.listing(owner, others=True) == []
    for read in (boards.get, boards.load, boards.owner, boards.public_token):
        assert read(board) is None
    assert boards.preview(board, 1) is None
    assert boards.by_public_token("tok-trash") is None
    assert boards.ensure_public_token(board, "tok-new") is None
    assert boards.clear_public_token(board) is None
    for write in (
        lambda: boards.save(board, 1, BoardDoc()),
        lambda: boards.save_live(board, BoardDoc(), b""),
        lambda: boards.keep_live_state(board, b""),
        lambda: boards.rename(board, "New"),
        lambda: boards.delete(board, owner),
    ):
        with pytest.raises((NotFound, VersionConflict)):
            write()
    boards.keep_preview(board, 1, 1, "<svg/>")
    assert members.roles(board, owner) is None
    assert members.role(board, owner) is None
    assert members.members(board) == [] and members.everyone(board) is None
    members.set_role(board, other, "editor")
    members.set_everyone(board, "viewer")
    members.transfer(board, other)
    members.remove(board, owner)
    folders.star(other, board, True)
    assert folders.place(other, board, place.id) is False

    # Nothing above changed it: the restore finds the board as it was.
    assert boards.restore(board)
    assert boards.public_token(board) == "tok-trash"
    assert members.roles(board, owner) == ("owner", None)
    assert members.roles(board, other) == (None, None)
    assert boards.preview(board, 1) == (1, None)
    assert boards.listing(other) == []
