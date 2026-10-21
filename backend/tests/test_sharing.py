import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in

# The apps of its module fixtures keep their people and boards across the tests.
pytestmark = pytest.mark.shared_rows

LONG = "long-enough-password"
PEOPLE = ["ann", "bob", "carl", "dave"]
STICKY = {"id": "s", "type": "sticky", "position": {"x": 0, "y": 0}, "data": {"text": "Hi"}}


@pytest.fixture(scope="module")
def world(monkeypatch_module):
    return make_world()


def make_world():
    """ann owns each board, bob edits, carl views, dave has no role, admin is admin."""
    app = create_app(Settings(db_path=":memory:"))
    admin = signed_in(app)
    clients = {"admin": admin}
    ids = {}
    for name in PEOPLE:
        url = admin.post("/api/invites", json={"role": "member"}).json()["url"]
        client = TestClient(app)
        client.post(
            f"/api/invites/{url.split('=', 1)[1]}/accept",
            json={"username": name, "name": name.title(), "password": LONG},
        )
        clients[name] = client
        ids[name] = client.get("/api/auth/status").json()["me"]["id"]
    return clients, ids


@pytest.fixture(scope="module")
def monkeypatch_module():
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("TIKO_PASSWORD", "test-password")
        yield patch


def new_board(world) -> str:
    clients, ids = world
    ann = clients["ann"]
    board_id = ann.post("/api/boards", json={"name": "Sprint"}).json()["id"]
    assert ann.put(
        f"/api/boards/{board_id}/members/{ids['bob']}", json={"role": "editor"}
    ).is_success
    assert ann.put(
        f"/api/boards/{board_id}/members/{ids['carl']}", json={"role": "viewer"}
    ).is_success
    return board_id


def call(world, who: str, route: str, board_id: str):
    clients, ids = world
    client = clients[who]
    base = f"/api/boards/{board_id}"
    if route == "save":
        version = clients["ann"].get(base).json()["version"]
        return client.put(base, json={"version": version, "doc": {"nodes": [], "edges": []}})
    if route == "preview":
        version = clients["ann"].get(base).json()["version"]
        doc = {"nodes": [STICKY], "edges": []}
        assert clients["ann"].put(base, json={"version": version, "doc": doc}).is_success
        return client.get(f"{base}/preview")
    requests = {
        "get": ("GET", base, None),
        "refresh": ("POST", f"{base}/refresh", None),
        "members": ("GET", f"{base}/members", None),
        "rename": ("PATCH", base, {"name": "Renamed"}),
        "share": ("PUT", f"{base}/members/{ids['dave']}", {"role": "viewer"}),
        "unshare": ("DELETE", f"{base}/members/{ids['carl']}", None),
        "everyone": ("PUT", f"{base}/everyone", {"role": "viewer"}),
        "transfer": ("POST", f"{base}/transfer", {"user_id": ids["bob"]}),
        "delete": ("DELETE", base, None),
        "duplicate": ("POST", f"{base}/duplicate", None),
    }
    method, path, body = requests[route]
    return client.request(method, path, json=body)


VIEW = {"ann": 200, "bob": 200, "carl": 200, "dave": 404, "admin": 200}
EDIT = {"ann": 200, "bob": 200, "carl": 403, "dave": 404, "admin": 200}
OWN = {"ann": 200, "bob": 403, "carl": 403, "dave": 404, "admin": 200}
MATRIX = {
    "get": VIEW,
    "preview": VIEW,
    "refresh": VIEW,
    "members": VIEW,
    "save": EDIT,
    "rename": EDIT,
    "share": OWN,
    "unshare": {**OWN, "ann": 204, "admin": 204},
    "everyone": {**OWN, "ann": 204, "admin": 204},
    "transfer": {**OWN, "ann": 204, "admin": 204},
    "delete": {**OWN, "ann": 204, "admin": 204},
    "duplicate": {who: 201 if code == 200 else code for who, code in VIEW.items()},
}


@pytest.mark.parametrize(
    "route,who", [(route, who) for route, row in MATRIX.items() for who in row]
)
def test_access_matrix(world, route, who):
    response = call(world, who, route, new_board(world))
    assert response.status_code == MATRIX[route][who], response.text
    if response.status_code == 404:
        assert response.json()["error"]["code"] == "not_found"
    if response.status_code == 403:
        assert response.json()["error"]["code"] == "forbidden"


def names(client: TestClient, key: str = "boards") -> set[str]:
    return {board["id"] for board in client.get("/api/boards").json()[key]}


def test_lists_show_only_what_a_person_can_open(world):
    clients, _ = world
    board_id = new_board(world)
    assert board_id in names(clients["bob"]) and board_id in names(clients["carl"])
    assert board_id not in names(clients["dave"])
    assert board_id not in names(clients["admin"]) and board_id in names(clients["admin"], "all")
    mine = next(
        b for b in clients["carl"].get("/api/boards").json()["boards"] if b["id"] == board_id
    )
    assert mine["my_role"] == "viewer" and mine["owner"]["name"] == "Ann"
    assert clients["dave"].get("/api/boards").json()["all"] == []


def test_everyone_role_and_the_higher_role_wins(world):
    clients, ids = world
    board_id = new_board(world)
    ann = clients["ann"]
    assert ann.put(f"/api/boards/{board_id}/everyone", json={"role": "editor"}).status_code == 204
    assert board_id in names(clients["dave"])
    assert clients["carl"].get(f"/api/boards/{board_id}").json()["my_role"] == "editor"
    body = ann.get(f"/api/boards/{board_id}/members").json()
    assert body["everyone_role"] == "editor"
    assert [m["role"] for m in body["members"]] == ["owner", "editor", "viewer"]
    ann.put(f"/api/boards/{board_id}/everyone", json={"role": None})
    assert board_id not in names(clients["dave"])


def test_owner_stays_until_transferred(world):
    clients, ids = world
    board_id = new_board(world)
    ann = clients["ann"]
    response = ann.delete(f"/api/boards/{board_id}/members/{ids['ann']}")
    assert (response.status_code, response.json()["error"]["code"]) == (409, "owner_required")
    response = ann.put(f"/api/boards/{board_id}/members/{ids['ann']}", json={"role": "viewer"})
    assert response.status_code == 409
    assert ann.post(f"/api/boards/{board_id}/transfer", json={"user_id": ids["bob"]}).is_success
    roles = {
        m["user"]["username"]: m["role"]
        for m in ann.get(f"/api/boards/{board_id}/members").json()["members"]
    }
    assert roles == {"bob": "owner", "ann": "editor", "carl": "viewer"}
    assert ann.delete(f"/api/boards/{board_id}").status_code == 403


def test_disabled_people_cannot_be_added(world):
    clients, ids = world
    board_id = new_board(world)
    clients["admin"].patch(f"/api/accounts/{ids['dave']}", json={"disabled": True})
    try:
        response = clients["ann"].put(
            f"/api/boards/{board_id}/members/{ids['dave']}", json={"role": "viewer"}
        )
        assert response.status_code == 404
        found = clients["ann"].get("/api/people/directory", params={"q": "da"}).json()["people"]
        assert found == []
    finally:
        clients["admin"].patch(f"/api/accounts/{ids['dave']}", json={"disabled": False})
    signed_in(clients["admin"].app, "dave", LONG)
    found = clients["ann"].get("/api/people/directory", params={"q": "DA"}).json()["people"]
    assert [p["username"] for p in found] == ["dave"]


def test_each_new_person_gets_their_own_welcome_board(world):
    clients, ids = world
    # A fresh session: an earlier test disabled dave, which ended the old one.
    dave = signed_in(clients["admin"].app, "dave", LONG)
    boards = dave.get("/api/boards").json()["boards"]
    own = [b for b in boards if b["owner"]["id"] == ids["dave"]]
    assert [b["name"] for b in own] == ["Welcome to tiko"]
