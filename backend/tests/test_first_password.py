import re

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.gate import BEFORE_NEW_PASSWORD, is_open
from app.config import Settings
from app.main import create_app
from tests.conftest import PASSWORD

NEW = "a-new-long-password"


def login(client: TestClient, password: str) -> int:
    body = {"username": "admin", "password": password}
    return client.post("/api/auth/login", json=body).status_code


@pytest.fixture
def fresh(tmp_path, monkeypatch):
    """A first start without TIKO_PASSWORD: the admin's password is generated into a file."""
    monkeypatch.delenv("TIKO_PASSWORD")
    path = tmp_path / "password"
    app = create_app(Settings(db_path=":memory:", password_file=str(path)))
    client = TestClient(app)
    password = path.read_text().strip()
    assert login(client, password) == 204
    return app, client, password, path


def _open(path: str, method: str) -> bool:
    return is_open({"path": path, "method": method}) or path in BEFORE_NEW_PASSWORD


def test_the_first_admin_reaches_nothing_but_the_new_password(fresh):
    app, client, _, _ = fresh
    assert client.get("/api/auth/status").json()["me"]["must_change_password"] is True
    # Every HTTP route is in the schema: none of them is hidden from it.
    checked = 0
    for route, operations in app.openapi()["paths"].items():
        path = re.sub(r"\{[^}]+\}", "x", route)
        for method in operations:
            if not path.startswith("/api/") or _open(path, method.upper()):
                continue
            answer = client.request(method, path, json={})
            assert answer.status_code == 403, (method, path)
            assert answer.json()["error"]["code"] == "password_change_required", (method, path)
            checked += 1
    assert checked > 50
    live = "/api/boards/x/live"
    with pytest.raises(WebSocketDisconnect) as closed, client.websocket_connect(live):
        pass
    assert closed.value.code == 1008


def test_the_same_password_is_refused(fresh):
    _, client, password, _ = fresh
    same = client.put("/api/me/password", json={"current": password, "new": password})
    assert (same.status_code, same.json()["error"]["code"]) == (422, "weak_password")
    assert client.get("/api/auth/status").json()["me"]["must_change_password"] is True


def test_a_new_password_opens_the_app_and_deletes_the_file(fresh):
    app, client, password, path = fresh
    other = TestClient(app)
    assert login(other, password) == 204
    changed = client.put("/api/me/password", json={"current": password, "new": NEW})
    assert changed.status_code == 204
    assert not path.exists()
    assert client.get("/api/auth/status").json()["me"]["must_change_password"] is False
    assert client.get("/api/boards").status_code == 200
    assert other.get("/api/boards").status_code == 401
    assert login(TestClient(app), password) == 401
    assert login(TestClient(app), NEW) == 204


def test_the_admin_from_tiko_password_is_asked_too():
    client = TestClient(create_app(Settings(db_path=":memory:")))
    assert login(client, PASSWORD) == 204
    assert client.get("/api/boards").status_code == 403


def test_a_restart_with_people_asks_nobody(fresh):
    app, client, password, _ = fresh
    assert client.put("/api/me/password", json={"current": password, "new": NEW}).status_code == 204
    again = TestClient(create_app(Settings(db_path=":memory:")))
    assert login(again, NEW) == 204
    assert again.get("/api/auth/status").json()["me"]["must_change_password"] is False
