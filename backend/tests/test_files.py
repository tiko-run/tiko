"""Spec 039: pictures on a board, stored once per workspace and served by the board's access."""

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.domain.files import MAX_BYTES
from app.main import create_app
from tests.conftest import signed_in
from tests.test_folders import join


def picture(width=800, height=600, kind="PNG", color=(200, 40, 40), **save) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), color).save(out, kind, **save)
    return out.getvalue()


def board(client: TestClient) -> str:
    return client.post("/api/boards", json={"name": "Pictures"}).json()["id"]


def upload(client: TestClient, board_id: str, data: bytes, mime="image/png"):
    return client.post(
        f"/api/boards/{board_id}/files", content=data, headers={"content-type": mime}
    )


def opened(response) -> Image.Image:
    assert response.status_code == 200, response.text
    return Image.open(io.BytesIO(response.content))


@pytest.fixture
def client():
    return signed_in(create_app(Settings(db_path=":memory:")))


def test_a_picture_is_stored_with_its_size_and_colour(client):
    board_id = board(client)
    response = upload(client, board_id, picture())
    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["width"], body["height"], body["color"]) == (800, 600, "#c82828")
    assert len(body["id"]) == 32


def test_the_same_bytes_are_stored_once(client):
    board_id = board(client)
    first = upload(client, board_id, picture()).json()["id"]
    assert upload(client, board(client), picture()).json()["id"] == first
    assert upload(client, board_id, picture(color=(0, 0, 0))).json()["id"] != first


def test_the_canvas_gets_the_narrowest_copy_wide_enough(client):
    board_id = board(client)
    file_id = upload(client, board_id, picture(3840, 2160)).json()["id"]
    url = f"/api/boards/{board_id}/files/{file_id}"
    for asked, served in [(100, 512), (512, 512), (600, 1024), (2000, 2048)]:
        response = client.get(url, params={"w": asked})
        assert response.headers["content-type"] == "image/webp"
        assert opened(response).size[0] == served
    original = client.get(url)
    assert original.headers["content-type"] == "image/png"
    assert opened(original).size == (3840, 2160)
    # Wider than every copy: only the original is sharp enough.
    assert opened(client.get(url, params={"w": 3000})).size[0] == 3840
    assert "immutable" in original.headers["cache-control"]
    assert original.headers["x-content-type-options"] == "nosniff"


def test_a_small_picture_has_no_copies(client):
    board_id = board(client)
    file_id = upload(client, board_id, picture(300, 200)).json()["id"]
    response = client.get(f"/api/boards/{board_id}/files/{file_id}", params={"w": 512})
    assert response.headers["content-type"] == "image/png"


def test_a_gif_is_drawn_still(client):
    frames = [Image.new("RGB", (300, 200), c) for c in ((255, 0, 0), (0, 0, 255))]
    out = io.BytesIO()
    frames[0].save(out, "GIF", save_all=True, append_images=frames[1:], duration=100, loop=0)
    board_id = board(client)
    file_id = upload(client, board_id, out.getvalue(), "image/gif").json()["id"]
    url = f"/api/boards/{board_id}/files/{file_id}"
    still = client.get(url, params={"w": 1024})
    assert still.headers["content-type"] == "image/webp"
    assert opened(still).size == (300, 200)
    assert getattr(opened(still), "n_frames", 1) == 1
    assert opened(client.get(url)).format == "GIF"


def test_location_and_camera_data_are_removed_and_the_picture_turned(client):
    exif = Image.Exif()
    exif[0x0112] = 6  # turned: the camera was held on its side
    exif[0x010F] = "Camera maker"
    exif[0x8825] = {2: (55.0, 45.0, 0.0)}  # GPS latitude
    data = picture(400, 300, "JPEG", exif=exif.tobytes())
    board_id = board(client)
    body = upload(client, board_id, data, "image/jpeg").json()
    assert (body["width"], body["height"]) == (300, 400)
    served = client.get(f"/api/boards/{board_id}/files/{body['id']}")
    assert b"Camera maker" not in served.content
    image = opened(served)
    assert image.size == (300, 400)
    assert not image.getexif()


@pytest.mark.parametrize(
    ("data", "mime", "status"),
    [
        (b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml", 415),
        (b"not a picture at all", "image/png", 415),
        (picture(kind="JPEG"), "application/octet-stream", 415),
    ],
)
def test_what_is_not_a_picture_is_refused(client, data, mime, status):
    response = upload(client, board(client), data, mime)
    assert response.status_code == status
    assert response.json()["error"]["code"] == "unsupported_file"


def test_a_picture_named_for_another_type_is_read_for_what_it_is(client):
    board_id = board(client)
    file_id = upload(client, board_id, picture(kind="JPEG"), "image/png").json()["id"]
    served = client.get(f"/api/boards/{board_id}/files/{file_id}")
    assert served.headers["content-type"] == "image/jpeg"


def test_too_big_files_and_pictures_are_refused(client):
    board_id = board(client)
    heavy = upload(client, board_id, b"\0" * (MAX_BYTES + 1))
    assert heavy.status_code == 413
    out = io.BytesIO()
    Image.new("1", (8000, 7000)).save(out, "PNG")
    huge = upload(client, board_id, out.getvalue())
    assert huge.status_code == 413
    assert huge.json()["error"]["code"] == "file_too_large"


def test_the_workspace_quota_holds():
    client = signed_in(create_app(Settings(db_path=":memory:", tiko_files_quota_mb=1)))
    board_id = board(client)
    noise = Image.effect_noise((1200, 1200), 100).convert("RGB")
    out = io.BytesIO()
    noise.save(out, "PNG")
    response = upload(client, board_id, out.getvalue())
    assert response.status_code == 507
    assert response.json()["error"]["code"] == "file_quota"
    assert upload(client, board_id, picture(100, 100)).status_code == 201


def test_a_viewer_reads_and_only_an_editor_uploads():
    app = create_app(Settings(db_path=":memory:"))
    admin = signed_in(app)
    reader = join(app, admin, "rita")
    board_id = board(admin)
    reader_id = reader.get("/api/auth/status").json()["me"]["id"]
    admin.put(f"/api/boards/{board_id}/members/{reader_id}", json={"role": "viewer"})
    file_id = upload(admin, board_id, picture()).json()["id"]
    assert reader.get(f"/api/boards/{board_id}/files/{file_id}").status_code == 200
    assert upload(reader, board_id, picture(color=(1, 2, 3))).status_code == 403
    outsider = join(app, admin, "otto")
    assert outsider.get(f"/api/boards/{board_id}/files/{file_id}").status_code in (403, 404)


def test_a_picture_of_another_workspace_is_not_found():
    app = create_app(Settings(db_path=":memory:", tiko_demo=True))
    admin = signed_in(app)
    visitor = TestClient(app)
    assert visitor.post("/api/auth/demo", headers={"x-real-ip": "203.0.113.9"}).is_success
    theirs = visitor.get("/api/boards").json()["boards"][0]["id"]
    file_id = upload(admin, board(admin), picture()).json()["id"]
    assert visitor.get(f"/api/boards/{theirs}/files/{file_id}").status_code == 404
    # The same bytes in their workspace are a file of its own.
    assert upload(visitor, theirs, picture()).json()["id"] != file_id


def test_a_public_link_shows_the_pictures_until_it_is_turned_off(client):
    board_id = board(client)
    file_id = upload(client, board_id, picture()).json()["id"]
    token = client.put(f"/api/boards/{board_id}/public", json={"public": True}).json()
    guest = TestClient(client.app)
    url = f"/api/public/{token['public_token']}/files/{file_id}"
    assert guest.get(url, params={"w": 512}).status_code == 200
    client.put(f"/api/boards/{board_id}/public", json={"public": False})
    assert guest.get(url).status_code == 404


def test_an_image_element_is_part_of_the_board(client):
    board_id = board(client)
    file_id = upload(client, board_id, picture()).json()["id"]
    image = {
        "id": "pic",
        "type": "image",
        "position": {"x": 0, "y": 0},
        "width": 400,
        "height": 300,
        "data": {"file": file_id, "w": 800, "h": 600, "color": "#c82828", "rotation": 15},
    }
    uploading = image | {"id": "up", "data": {"w": 10, "h": 10, "color": "#000000"}}
    doc = {"nodes": [image, uploading], "edges": []}
    assert client.put(f"/api/boards/{board_id}", json={"version": 1, "doc": doc}).is_success
    nodes = client.get(f"/api/boards/{board_id}").json()["doc"]["nodes"]
    assert nodes[0]["data"]["file"] == file_id
    assert "file" not in nodes[1]["data"]
    bad = image | {"data": image["data"] | {"color": "red' onload='x"}}
    response = client.put(
        f"/api/boards/{board_id}", json={"version": 2, "doc": {"nodes": [bad], "edges": []}}
    )
    assert response.status_code == 422


def test_a_still_gif_loses_its_comment(client):
    out = io.BytesIO()
    still = Image.new("P", (40, 30), 0)
    still.paste(3, (0, 0, 20, 30))
    still.save(out, "GIF", comment=b"secret note", transparency=0)
    board_id = board(client)
    file_id = upload(client, board_id, out.getvalue(), "image/gif").json()["id"]
    served = client.get(f"/api/boards/{board_id}/files/{file_id}")
    assert b"secret note" not in served.content
    assert "transparency" in opened(served).info


def test_a_moving_webp_loses_its_exif_and_keeps_moving(client):
    exif = Image.Exif()
    exif[0x010F] = "Camera maker"
    frames = [Image.new("RGB", (64, 48), c) for c in ((255, 0, 0), (0, 0, 255))]
    out = io.BytesIO()
    frames[0].save(
        out, "WEBP", save_all=True, append_images=frames[1:], duration=200, exif=exif.tobytes()
    )
    assert b"Camera maker" in out.getvalue()
    board_id = board(client)
    file_id = upload(client, board_id, out.getvalue(), "image/webp").json()["id"]
    served = client.get(f"/api/boards/{board_id}/files/{file_id}")
    assert b"Camera maker" not in served.content
    assert opened(served).n_frames == 2
    # It plays at its own pace, not at a default one, from itself: no lighter copy is kept.
    moving = client.get(f"/api/boards/{board_id}/files/{file_id}", params={"move": 1})
    assert moving.content == served.content
    played = opened(moving)
    played.seek(1)
    played.load()
    assert played.info["duration"] == 200


def test_a_wide_animated_webp_plays_from_its_copy_at_its_own_pace(client):
    frames = [Image.new("RGB", (1100, 40), c) for c in ((255, 0, 0), (0, 0, 255), (0, 255, 0))]
    out = io.BytesIO()
    frames[0].save(out, "WEBP", save_all=True, append_images=frames[1:], duration=[70, 120, 70])
    board_id = board(client)
    file_id = upload(client, board_id, out.getvalue(), "image/webp").json()["id"]
    played = opened(client.get(f"/api/boards/{board_id}/files/{file_id}", params={"move": 1}))
    assert played.width == 1024
    timing = []
    for n in range(played.n_frames):
        played.seek(n)
        played.load()
        timing.append(played.info["duration"])
    assert timing == [70, 120, 70]


def test_a_wide_gamut_picture_gets_srgb_copies(client):
    from PIL import ImageCms

    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    data = picture(1200, 800, "PNG", icc_profile=srgb)
    board_id = board(client)
    file_id = upload(client, board_id, data).json()["id"]
    copy = client.get(f"/api/boards/{board_id}/files/{file_id}", params={"w": 512})
    assert copy.headers["content-type"] == "image/webp"


def test_a_very_tall_picture_is_kept_without_the_copies_webp_cannot_hold(client):
    out = io.BytesIO()
    Image.new("L", (1000, 40000), 200).save(out, "PNG")
    board_id = board(client)
    response = upload(client, board_id, out.getvalue())
    assert response.status_code == 201, response.text
    served = client.get(f"/api/boards/{board_id}/files/{response.json()['id']}", params={"w": 512})
    assert served.headers["content-type"] == "image/png"


def test_a_picture_of_a_trashed_board_is_not_served(client):
    board_id = board(client)
    file_id = upload(client, board_id, picture()).json()["id"]
    assert client.delete(f"/api/boards/{board_id}").status_code == 204
    assert client.get(f"/api/boards/{board_id}/files/{file_id}").status_code == 404


def test_a_board_serves_only_the_pictures_it_shows(client):
    first, second = board(client), board(client)
    file_id = upload(client, first, picture()).json()["id"]
    url = f"/api/boards/{second}/files/{file_id}"
    assert client.get(url).status_code == 404
    image = {
        "id": "pic",
        "type": "image",
        "position": {"x": 0, "y": 0},
        "width": 400,
        "height": 300,
        "data": {"file": file_id, "w": 800, "h": 600, "color": "#c82828"},
    }
    doc = {"nodes": [image], "edges": []}
    assert client.put(f"/api/boards/{second}", json={"version": 1, "doc": doc}).is_success
    assert client.get(url).status_code == 200
    # Taking the picture off the board does not take it back: the board showed it already.
    empty = {"nodes": [], "edges": []}
    assert client.put(f"/api/boards/{second}", json={"version": 2, "doc": empty}).is_success
    assert client.get(url).status_code == 200


def test_a_gif_plays_from_a_lighter_animated_webp(client):
    frames = [Image.effect_noise((480, 360), 60 + i * 20).convert("RGB") for i in range(6)]
    out = io.BytesIO()
    frames[0].save(out, "GIF", save_all=True, append_images=frames[1:], duration=80, loop=0)
    board_id = board(client)
    body = upload(client, board_id, out.getvalue(), "image/gif").json()
    assert body["moving"] is True
    url = f"/api/boards/{board_id}/files/{body['id']}"
    moving = client.get(url, params={"move": 1})
    assert moving.headers["content-type"] == "image/webp"
    played = opened(moving)
    assert played.n_frames == 6
    played.seek(1)
    played.load()
    assert played.info["duration"] == 80
    assert len(moving.content) < len(out.getvalue())
    still = opened(client.get(url, params={"w": 512, "move": 0}))
    assert getattr(still, "n_frames", 1) == 1
    assert upload(client, board_id, picture()).json()["moving"] is False


def test_an_animation_too_long_to_decode_is_refused(client):
    frames = [Image.new("L", (1000, 1000), i % 256) for i in range(120)]
    out = io.BytesIO()
    frames[0].save(out, "GIF", save_all=True, append_images=frames[1:], duration=40)
    response = upload(client, board(client), out.getvalue(), "image/gif")
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large"
