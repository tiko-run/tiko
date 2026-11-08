"""Spec 039 slice 3: the built-in stickers and the workspace's own pack."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain import stickers as stickers_domain
from app.main import create_app
from tests.conftest import signed_in
from tests.test_files import board, opened, picture, upload
from tests.test_folders import join

FIRE = "1f525"


@pytest.fixture
def client():
    return signed_in(create_app(Settings(db_path=":memory:")))


def place(client: TestClient, board_id: str, code: str = FIRE):
    return client.post(f"/api/boards/{board_id}/stickers/{code}")


def test_the_panel_lists_the_built_in_set(client):
    listed = client.get("/api/stickers")
    assert listed.status_code == 200
    stickers = listed.json()["stickers"]
    assert len(stickers) > 800
    fire = next(s for s in stickers if s["code"] == FIRE)
    assert fire["name"] == "fire"
    assert fire["category"] == "Smileys and emotions"


def test_a_built_in_sticker_shows_still_and_plays_under_the_pointer(client):
    still = opened(client.get(f"/api/stickers/{FIRE}/preview"))
    assert still.size == (96, 96)
    assert getattr(still, "n_frames", 1) == 1
    playing = opened(client.get(f"/api/stickers/{FIRE}/preview", params={"move": 1}))
    assert (playing.size, playing.n_frames > 10) == ((96, 96), True)
    assert client.get("/api/stickers/..%2Fcatalog/preview").status_code == 404
    assert TestClient(client.app).get(f"/api/stickers/{FIRE}/preview").status_code == 401


def test_a_placed_sticker_plays_from_the_board_at_thirty_frames(client):
    board_id = board(client)
    placed = place(client, board_id)
    assert placed.status_code == 201, placed.text
    body = placed.json()
    assert (body["width"], body["height"], body["moving"]) == (256, 256, True)
    url = f"/api/boards/{board_id}/files/{body['id']}"
    played = opened(client.get(url, params={"move": 1}))
    assert played.n_frames > 10
    played.seek(1)
    played.load()
    assert played.info["duration"] == 33
    assert getattr(opened(client.get(url, params={"w": 256})), "n_frames", 1) == 1


def test_a_sticker_is_stored_once_per_workspace(client):
    first = place(client, board(client)).json()["id"]
    assert place(client, board(client)).json()["id"] == first
    assert place(client, board(client), "1f680").json()["id"] != first
    assert place(client, board(client), "nope").status_code == 404


def test_only_an_editor_places_a_sticker():
    app = create_app(Settings(db_path=":memory:"))
    admin = signed_in(app)
    reader = join(app, admin, "rita")
    board_id = board(admin)
    reader_id = reader.get("/api/auth/status").json()["me"]["id"]
    admin.put(f"/api/boards/{board_id}/members/{reader_id}", json={"role": "viewer"})
    assert place(reader, board_id).status_code == 403


def test_a_picture_saved_to_the_pack_goes_on_any_board(client):
    first = board(client)
    file_id = upload(client, first, picture(300, 200)).json()["id"]
    saved = client.post("/api/stickers/pack", json={"file": file_id, "name": "  Logo  "})
    assert saved.status_code == 201, saved.text
    sticker = saved.json()
    assert (sticker["name"], sticker["file"]["id"]) == ("Logo", file_id)
    assert client.post("/api/stickers/pack", json={"file": file_id}).json()["id"] == sticker["id"]
    assert [s["id"] for s in client.get("/api/stickers/pack").json()["stickers"]] == [sticker["id"]]
    second = board(client)
    url = f"/api/boards/{second}/files/{file_id}"
    assert client.get(url).status_code == 404
    used = client.post(f"/api/boards/{second}/pack/{sticker['id']}")
    assert used.status_code == 201
    assert used.json()["id"] == file_id
    assert client.get(url).status_code == 200


def test_the_pack_shows_a_moving_sticker_still(client):
    file_id = place(client, board(client)).json()["id"]
    sticker = client.post("/api/stickers/pack", json={"file": file_id}).json()
    assert sticker["name"] == "Sticker"
    url = f"/api/stickers/pack/{sticker['id']}/picture"
    assert getattr(opened(client.get(url, params={"w": 96})), "n_frames", 1) == 1
    assert opened(client.get(url, params={"move": 1})).n_frames > 10


def test_removing_a_sticker_leaves_the_picture_on_its_board(client):
    board_id = board(client)
    file_id = upload(client, board_id, picture()).json()["id"]
    sticker = client.post("/api/stickers/pack", json={"file": file_id}).json()
    assert client.delete(f"/api/stickers/pack/{sticker['id']}").status_code == 204
    assert client.get("/api/stickers/pack").json()["stickers"] == []
    assert client.delete(f"/api/stickers/pack/{sticker['id']}").status_code == 404
    assert client.get(f"/api/boards/{board_id}/files/{file_id}").status_code == 200


def test_only_a_picture_of_the_workspace_is_saved(client):
    assert client.post("/api/stickers/pack", json={"file": "f" * 32}).status_code == 404


def test_the_pack_has_a_limit(client, monkeypatch):
    monkeypatch.setattr(stickers_domain, "PACK_LIMIT", 1)
    board_id = board(client)
    first = upload(client, board_id, picture()).json()["id"]
    second = upload(client, board_id, picture(color=(1, 2, 3))).json()["id"]
    assert client.post("/api/stickers/pack", json={"file": first}).status_code == 201
    full = client.post("/api/stickers/pack", json={"file": second})
    assert full.status_code == 409
    assert full.json()["error"]["code"] == "sticker_limit"


def test_the_pack_belongs_to_its_workspace():
    app = create_app(Settings(db_path=":memory:", tiko_demo=True))
    admin = signed_in(app)
    file_id = upload(admin, board(admin), picture()).json()["id"]
    sticker = admin.post("/api/stickers/pack", json={"file": file_id}).json()
    visitor = TestClient(app)
    assert visitor.post("/api/auth/demo", headers={"x-real-ip": "203.0.113.9"}).is_success
    theirs = visitor.get("/api/boards").json()["boards"][0]["id"]
    assert visitor.get("/api/stickers/pack").json()["stickers"] == []
    assert visitor.post(f"/api/boards/{theirs}/pack/{sticker['id']}").status_code == 404
    assert visitor.get(f"/api/stickers/pack/{sticker['id']}/picture").status_code == 404
    assert visitor.post("/api/stickers/pack", json={"file": file_id}).status_code == 404


def test_a_sticker_element_remembers_which_one_it_is(client):
    board_id = board(client)
    file_id = place(client, board_id).json()["id"]
    node = {
        "id": "s",
        "type": "image",
        "position": {"x": 0, "y": 0},
        "width": 160,
        "height": 160,
        "data": {"file": file_id, "w": 256, "h": 256, "color": "#ff8800", "sticker": FIRE},
    }
    doc = {"nodes": [node], "edges": []}
    assert client.put(f"/api/boards/{board_id}", json={"version": 1, "doc": doc}).is_success
    saved = client.get(f"/api/boards/{board_id}").json()["doc"]["nodes"][0]
    assert saved["data"]["sticker"] == FIRE
    bad = node | {"data": node["data"] | {"sticker": "../x"}}
    response = client.put(
        f"/api/boards/{board_id}", json={"version": 2, "doc": {"nodes": [bad], "edges": []}}
    )
    assert response.status_code == 422
