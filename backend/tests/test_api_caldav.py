"""Spec 040: a person's own CalDAV account through the API."""

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.caldav_fake import HOME, HOST, PASSWORD, PRIVATE_IP, USER, FakeCalDav, resolver
from tests.conftest import signed_in

LONG = "long-enough-password"
PERSONAL = f"https://{HOST}{HOME}personal/"
WORK = f"https://{HOST}{HOME}work/"
ACCOUNT = {"address": HOST, "username": USER, "password": PASSWORD}


def app_with(fake: FakeCalDav, **settings):
    return create_app(
        Settings(db_path=":memory:", tiko_secret_key="test-secret-key", **settings),
        caldav_transport=httpx.MockTransport(fake),
        caldav_resolver=resolver({"nas.local": PRIVATE_IP}),
    )


@pytest.fixture
def fake() -> FakeCalDav:
    return FakeCalDav()


@pytest.fixture
def admin(fake) -> TestClient:
    return signed_in(app_with(fake))


def member(admin: TestClient, name: str) -> TestClient:
    url = admin.post("/api/invites", json={"role": "member"}).json()["url"]
    client = TestClient(admin.app)
    client.post(
        f"/api/invites/{url.split('=', 1)[1]}/accept",
        json={"username": name, "name": name.title(), "password": LONG},
    )
    return client


def card(key: str) -> dict:
    data = {"key": key, "source": "caldav", "collapsed": False}
    return {"id": key, "type": "task_card", "position": {"x": 0, "y": 0}, "data": data}


def test_connect_shows_the_account_and_its_lists(admin):
    assert admin.get("/api/me/caldav").json() == {
        "state": "none",
        "address": None,
        "username": None,
    }
    body = admin.put("/api/me/caldav", json=ACCOUNT).json()
    assert body["display_name"] == "Ann Example"
    assert body["address"] == f"https://{HOST}/"
    assert [i["name"] for i in body["lists"]] == ["Personal", "Work"]
    assert admin.get("/api/me/caldav").json()["state"] == "set"


def test_a_wrong_password_is_not_stored(admin):
    response = admin.put("/api/me/caldav", json=ACCOUNT | {"password": "wrong"})
    assert response.status_code == 422
    assert "did not accept" in response.text
    assert admin.get("/api/me/caldav").json()["state"] == "none"


def test_the_password_is_never_sent_back(admin):
    admin.put("/api/me/caldav", json=ACCOUNT)
    assert PASSWORD not in admin.get("/api/me/caldav").text


def test_a_blank_password_keeps_the_stored_one(admin):
    admin.put("/api/me/caldav", json=ACCOUNT)
    response = admin.put("/api/me/caldav", json={"address": HOST, "username": USER})
    assert response.is_success


def test_switched_off_lists_stay_off(admin):
    admin.put("/api/me/caldav", json=ACCOUNT)
    shown = admin.put("/api/me/caldav/lists", json={"hidden": [WORK]}).json()["lists"]
    assert {i["name"]: i["shown"] for i in shown} == {"Personal": True, "Work": False}
    again = admin.get("/api/me/caldav/lists").json()["lists"]
    assert {i["name"]: i["shown"] for i in again} == {"Personal": True, "Work": False}
    assert admin.post("/api/tasks/caldav", json={"list_id": WORK}).status_code == 404


def test_tasks_of_a_list_and_a_card_that_refreshes(admin, fake):
    admin.put("/api/me/caldav", json=ACCOUNT)
    found = admin.post("/api/tasks/caldav", json={"list_id": PERSONAL}).json()
    assert [t["summary"] for t in found["tasks"]] == ["Buy milk"]
    board = admin.post("/api/boards", json={"name": "Home"}).json()
    doc = {"nodes": [card("task-1")], "edges": []}
    assert admin.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": doc}).is_success
    tasks = admin.post(f"/api/boards/{board['id']}/refresh").json()["tasks"]
    assert tasks["caldav:task-1"]["summary"] == "Buy milk"


def test_a_teammate_without_an_account_sees_the_key_only(admin):
    admin.put("/api/me/caldav", json=ACCOUNT)
    board = admin.post("/api/boards", json={"name": "Home"}).json()
    doc = {"nodes": [card("task-1")], "edges": []}
    admin.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": doc})
    admin.put(f"/api/boards/{board['id']}/everyone", json={"role": "viewer"})
    bob = member(admin, "bob")
    tasks = bob.post(f"/api/boards/{board['id']}/refresh").json()["tasks"]
    assert tasks["caldav:task-1"]["state"] == "no_token"
    assert tasks["caldav:task-1"]["summary"] == ""


def test_removing_the_account_drops_what_it_read(admin):
    admin.put("/api/me/caldav", json=ACCOUNT)
    admin.post("/api/tasks/caldav", json={"list_id": PERSONAL})
    assert admin.delete("/api/me/caldav").status_code == 204
    assert admin.get("/api/me/caldav").json()["state"] == "none"
    response = admin.post("/api/tasks/caldav", json={"list_id": PERSONAL})
    assert response.status_code == 422


def test_a_board_refuses_a_key_with_spaces(admin):
    board = admin.post("/api/boards", json={"name": "Home"}).json()
    doc = {"nodes": [card("not a uid")], "edges": []}
    assert (
        admin.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": doc}).status_code == 422
    )


def test_a_private_network_is_allowed_by_default(admin):
    response = admin.put("/api/me/caldav", json=ACCOUNT | {"address": "http://nas.local"})
    assert response.is_success


def test_a_private_network_is_refused_when_denied(fake):
    client = signed_in(app_with(fake, tiko_caldav_private_network="deny"))
    response = client.put("/api/me/caldav", json=ACCOUNT | {"address": "http://nas.local"})
    assert response.status_code == 422
    assert "private network" in response.text
