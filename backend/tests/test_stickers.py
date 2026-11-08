"""Spec 039 slice 3: the built-in stickers and the workspace's own pack."""

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.adapters.stickers import lottie
from app.adapters.stickers.lottie import LottieStickers
from app.config import Settings
from app.domain import stickers as stickers_domain
from app.main import create_app
from tests.conftest import signed_in
from tests.test_files import board, opened, picture, upload

FIRE = "1f525"


@pytest.fixture
def client():
    return signed_in(create_app(Settings(db_path=":memory:")))


def sticker(client: TestClient, code: str = FIRE, **params):
    return client.get(f"/api/stickers/{code}/picture", params=params)


def moving_webp() -> bytes:
    frames = [Image.new("RGBA", (64, 64), (i * 40, 0, 0, 255)) for i in range(4)]
    out = io.BytesIO()
    frames[0].save(out, "WEBP", save_all=True, append_images=frames[1:], duration=50, loop=0)
    return out.getvalue()


def test_the_panel_lists_the_built_in_set(client):
    listed = client.get("/api/stickers")
    assert listed.status_code == 200
    stickers = listed.json()["stickers"]
    assert len(stickers) > 800
    fire = next(s for s in stickers if s["code"] == FIRE)
    assert fire["name"] == "fire"
    assert fire["category"] == "Smileys and emotions"


def test_the_panel_shows_a_sticker_small_and_plays_it_under_the_pointer(client):
    still = opened(sticker(client, w=96))
    assert still.size == (96, 96)
    assert getattr(still, "n_frames", 1) == 1
    playing = opened(sticker(client, w=96, move=1))
    assert (playing.size, playing.n_frames > 10) == ((96, 96), True)
    assert sticker(client, "nope").status_code == 404
    assert client.get("/api/stickers/..%2Fcatalog/picture").status_code == 404
    assert sticker(TestClient(client.app)).status_code == 401


def test_a_board_shows_a_sticker_large_at_thirty_frames(client):
    still = opened(sticker(client, w=512))
    assert (still.size, getattr(still, "n_frames", 1)) == ((256, 256), 1)
    played = opened(sticker(client, w=512, move=1))
    assert played.size == (256, 256)
    played.seek(1)
    played.load()
    assert played.info["duration"] == 33


def test_a_built_in_sticker_takes_no_room_in_the_workspace():
    client = signed_in(create_app(Settings(db_path=":memory:", tiko_files_quota_mb=1)))
    board_id = board(client)
    for code in ("1f525", "1f680", "1f389", "1f914", "1f602", "1f44d"):
        assert sticker(client, code, w=512, move=1).status_code == 200
    # Six large stickers are past a megabyte; the quota still has room for a picture.
    assert upload(client, board_id, picture(100, 100)).status_code == 201


def test_a_guest_sees_stickers_through_the_public_link(client):
    board_id = board(client)
    token = client.put(f"/api/boards/{board_id}/public", json={"public": True}).json()
    guest = TestClient(client.app)
    url = f"/api/public/{token['public_token']}/stickers/{FIRE}/picture"
    assert guest.get(url, params={"w": 512, "move": 1}).status_code == 200
    client.put(f"/api/boards/{board_id}/public", json={"public": False})
    assert guest.get(url).status_code == 404


def test_a_drawn_sticker_is_kept_and_read_again(tmp_path, monkeypatch):
    art = LottieStickers(tmp_path)
    first = art.picture(FIRE, large=False, moving=False)
    assert first is not None
    assert len(list(tmp_path.glob("*.webp"))) == 1
    monkeypatch.setattr(lottie, "_draw", lambda *_: pytest.fail("drawn twice"))
    assert art.picture(FIRE, large=False, moving=False) == first


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


def test_the_pack_shows_a_moving_picture_still_and_plays_it(client):
    file_id = upload(client, board(client), moving_webp(), "image/webp").json()["id"]
    saved = client.post("/api/stickers/pack", json={"file": file_id}).json()
    assert saved["name"] == "Sticker"
    url = f"/api/stickers/pack/{saved['id']}/picture"
    assert getattr(opened(client.get(url, params={"w": 96})), "n_frames", 1) == 1
    assert opened(client.get(url, params={"move": 1})).n_frames == 4


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


def test_a_sticker_element_names_its_sticker_and_no_file(client):
    board_id = board(client)
    node = {
        "id": "s",
        "type": "image",
        "position": {"x": 0, "y": 0},
        "width": 160,
        "height": 160,
        "data": {"w": 256, "h": 256, "color": "#ff8800", "moving": True, "sticker": FIRE},
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
