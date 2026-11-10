"""Personal API keys and how they sign a request in (spec 046, slice api-keys)."""

import json
import os
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.api_keys import ApiKeys, KeyIn
from app.domain.errors import Forbidden
from app.main import create_app
from tests.conftest import PASSWORD, run_sql, signed_in
from tests.test_people import invite, join

CONTRACT = Path(__file__).parents[2] / "specs/046-api-mcp/contracts/openapi-v1.json"


@pytest.fixture
def app():
    return create_app(Settings(db_path=":memory:"))


@pytest.fixture
def admin(app) -> TestClient:
    return signed_in(app)


def make_key(client: TestClient, password: str = PASSWORD, **body) -> dict:
    response = client.post(
        "/api/me/api-keys", json={"name": "laptop agent", "password": password, **body}
    )
    assert response.status_code == 201, response.json()
    return response.json()


def with_key(app, token: str) -> TestClient:
    """A client with nothing but the key: no session cookie."""
    return TestClient(app, headers={"Authorization": f"Bearer {token}"})


def code(response) -> str:
    return response.json()["error"]["code"]


def test_a_key_signs_its_person_in_to_v1(app, admin):
    made = make_key(admin, boards=None, days=30)
    assert re.fullmatch(r"tiko_[A-Za-z0-9]{40}", made["token"])
    assert made["key"]["prefix"] == made["token"][5:9]
    me = with_key(app, made["token"]).get("/api/v1/me")
    assert me.status_code == 200
    body = me.json()
    assert body["username"] == "admin"
    assert body["workspace"]["name"] == "Default"
    assert body["key"]["name"] == "laptop agent"
    assert body["key"]["scope"] == "read"
    assert body["key"]["boards"] is None
    listed = admin.get("/api/me/api-keys").json()
    assert listed["enabled"] is True
    assert [k["id"] for k in listed["keys"]] == [made["key"]["id"]]
    assert "token" not in json.dumps(listed)


def test_the_key_is_stored_only_as_a_hash(app, admin):
    token = make_key(admin)["token"]
    rows = app.state.boards._db
    with rows.transaction(None) as conn:
        stored = conn.execute("SELECT * FROM api_keys").fetchone()
    assert token not in json.dumps(stored, default=str)


def test_a_wrong_password_makes_no_key(admin):
    response = admin.post("/api/me/api-keys", json={"name": "agent", "password": "wrong"})
    assert response.status_code == 401
    assert code(response) == "invalid_credentials"
    assert admin.get("/api/me/api-keys").json()["keys"] == []


def test_v1_reads_no_cookie(admin):
    response = admin.get("/api/v1/me")
    assert response.status_code == 401
    assert code(response) == "auth_required"
    assert response.headers["www-authenticate"].startswith("Bearer")


def test_an_unknown_key_is_refused(app):
    response = with_key(app, "tiko_" + "x" * 40).get("/api/v1/me")
    assert response.status_code == 401
    assert code(response) == "auth_required"


def test_unknown_keys_from_one_address_are_slowed_down(app):
    client = with_key(app, "tiko_" + "y" * 40)
    answers = [client.get("/api/v1/me").status_code for _ in range(31)]
    assert answers[:30] == [401] * 30
    assert answers[30] == 429


def test_a_revoked_key_says_so(app, admin):
    made = make_key(admin)
    client = with_key(app, made["token"])
    assert client.get("/api/v1/me").status_code == 200
    assert admin.delete(f"/api/me/api-keys/{made['key']['id']}").status_code == 204
    response = client.get("/api/v1/me")
    assert response.status_code == 401
    assert code(response) == "token_revoked"
    assert admin.get("/api/me/api-keys").json()["keys"] == []


def test_an_expired_key_says_so(app, admin):
    made = make_key(admin)
    past = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
    run_sql(app, "UPDATE api_keys SET expires_at = ? WHERE id = ?", (past, made["key"]["id"]))
    response = with_key(app, made["token"]).get("/api/v1/me")
    assert response.status_code == 401
    assert code(response) == "token_expired"


def test_signing_out_everywhere_ends_keys(app, admin):
    client = with_key(app, make_key(admin)["token"])
    assert admin.post("/api/auth/logout-all").status_code == 204
    assert code(client.get("/api/v1/me")) == "token_revoked"


def test_a_new_password_keeps_keys(app, admin):
    client = with_key(app, make_key(admin)["token"])
    change = {"current": PASSWORD, "new": "another-long-password"}
    assert admin.put("/api/me/password", json=change).status_code == 204
    assert client.get("/api/v1/me").status_code == 200


def test_a_disabled_person_loses_their_keys(app, admin):
    member = join(app, invite(admin))
    client = with_key(app, make_key(member, password="long-enough-password")["token"])
    ann = member.get("/api/auth/status").json()["me"]["id"]
    app.state.accounts.set_disabled(ann, True)
    assert code(client.get("/api/v1/me")) == "token_revoked"


def test_a_member_removed_from_the_workspace_loses_their_keys(app, admin):
    member = join(app, invite(admin))
    client = with_key(app, make_key(member, password="long-enough-password")["token"])
    ann = member.get("/api/auth/status").json()["me"]["id"]
    assert admin.delete(f"/api/people/{ann}").status_code == 204
    assert code(client.get("/api/v1/me")) == "token_revoked"


def test_a_person_held_at_the_new_password_screen_cannot_use_a_key(app, admin):
    client = with_key(app, make_key(admin)["token"])
    run_sql(app, "UPDATE users SET must_change_password = true WHERE username = 'admin'")
    app.state.api_keys._cache.clear()
    response = client.get("/api/v1/me")
    assert response.status_code == 403
    assert code(response) == "password_change_required"


def test_a_new_install_offers_keys_and_the_admin_can_switch_them_off(app, admin):
    assert admin.get("/api/settings").json()["api_keys"] is True
    client = with_key(app, make_key(admin)["token"])
    switched = admin.put("/api/settings", json={"api_keys": False})
    assert switched.json()["api_keys"] is False
    response = client.get("/api/v1/me")
    assert response.status_code == 403
    assert code(response) == "api_disabled"
    refused = admin.post("/api/me/api-keys", json={"name": "agent", "password": PASSWORD})
    assert code(refused) == "api_disabled"
    assert admin.put("/api/settings", json={"api_keys": True}).status_code == 200
    assert client.get("/api/v1/me").status_code == 200


def test_an_existing_install_keeps_keys_off_after_the_update(app, admin):
    run_sql(app, "DELETE FROM settings WHERE key = 'api_keys'")
    again = signed_in(create_app(Settings(db_path=":memory:")))
    assert again.get("/api/settings").json()["api_keys"] is False


def test_only_an_admin_sees_how_many_keys_are_live(app, admin):
    make_key(admin)
    assert admin.get("/api/settings").json()["api_keys_live"] == 1
    member = join(app, invite(admin))
    assert member.get("/api/settings").json()["api_keys_live"] is None


def test_a_key_opens_no_route_outside_v1(app, admin):
    token = make_key(admin)["token"]
    client = with_key(app, token)
    open_paths = {"/api/auth/status", "/api/auth/login", "/api/auth/logout", "/api/auth/demo"}
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/"):
            continue
        if route.path in open_paths or route.path.startswith(("/api/public/", "/api/invites/")):
            continue
        path = re.sub(r"\{[^}]+\}", "x", route.path)
        for method in route.methods - {"HEAD"}:
            response = client.request(method, path)
            assert response.status_code == 401, (method, route.path, response.status_code)


def test_the_live_socket_takes_no_key(app, admin):
    from starlette.websockets import WebSocketDisconnect

    client = with_key(app, make_key(admin)["token"])
    board = admin.post("/api/boards", json={"name": "Plan"}).json()["id"]
    with pytest.raises(WebSocketDisconnect), client.websocket_connect(f"/api/boards/{board}/live"):
        pass


def test_the_v1_contract_matches_what_is_served(app):
    served = TestClient(app).get("/api/v1/openapi.json")
    assert served.status_code == 200
    document = served.json()
    assert "bearer" in json.dumps(document["components"]["securitySchemes"]).lower()
    assert not any(path.startswith("/api/") for path in document["paths"]), "internal routes leaked"
    if os.environ.get("TIKO_WRITE_CONTRACT"):
        CONTRACT.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    assert document == json.loads(CONTRACT.read_text()), (
        "The v1 contract changed. If the change only adds, run this test with "
        "TIKO_WRITE_CONTRACT=1 and commit the file; anything else needs v2 (spec 046)."
    )


def test_a_demo_instance_offers_no_keys(app, admin):
    keys: ApiKeys = app.state.api_keys
    demo = ApiKeys(keys._repo, keys._users, keys._password._attempts, lambda: True, offered=False)
    person = app.state.accounts.get(admin.get("/api/auth/status").json()["me"]["id"])
    with pytest.raises(Forbidden):
        demo.create(person, "w", KeyIn(name="agent", password=PASSWORD))
    assert demo.enabled() is False


def test_a_board_added_to_a_key_elsewhere_is_reached_at_once(app, admin):
    first = admin.post("/api/boards", json={"name": "First"}).json()["id"]
    second = admin.post("/api/boards", json={"name": "Second"}).json()["id"]
    made = make_key(admin, boards=[first])
    client = with_key(app, made["token"])
    assert client.get(f"/api/v1/boards/{first}").status_code == 200
    # Another process adds the board; this one still holds the key in its cache.
    app.state.api_keys._repo.add_board(made["key"]["id"], second)
    assert client.get(f"/api/v1/boards/{second}").status_code == 200
