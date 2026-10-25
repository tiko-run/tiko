import threading
import uuid

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.adapters.storage import postgres as pg
from app.config import Settings
from app.domain.accounts import Person, hash_password
from app.domain.tasks import Task, now_iso
from app.main import create_app
from tests.conftest import PASSWORD, run_sql, signed_in
from tests.test_live import Tab, closed_with
from tests.test_people import LONG, invite, join, people


@pytest.fixture
def app():
    return create_app(Settings(db_path=":memory:"))


@pytest.fixture
def admin(app) -> TestClient:
    return signed_in(app)


def sign_in(app, username: str = "ann") -> TestClient:
    client = TestClient(app)
    response = client.post("/api/auth/login", json={"username": username, "password": LONG})
    assert response.status_code == 204
    return client


def add_workspace(db) -> str:
    workspace = uuid.uuid4().hex
    with db.jobs() as conn:
        conn.execute(
            "INSERT INTO workspaces (id, name, kind, created_at)"
            " VALUES (%s, 'B', 'regular', now())",
            (workspace,),
        )
    return workspace


def remove(admin: TestClient, username: str) -> None:
    response = admin.delete(f"/api/people/{people(admin)[username]['id']}")
    assert response.status_code == 204, response.json()


def test_a_removed_person_keeps_the_account_and_sees_no_workspace(app, admin):
    member = join(app, invite(admin))
    remove(admin, "ann")

    assert "ann" not in people(admin)
    ann = sign_in(app)
    me = ann.get("/api/auth/status").json()["me"]
    assert (me["username"], me["workspace"], me["role"]) == ("ann", None, None)
    for client in (member, ann):
        response = client.get("/api/boards")
        assert (response.status_code, response.json()["error"]["code"]) == (403, "no_workspace")
    assert ann.patch("/api/me", json={"name": "Ann B"}).is_success
    assert ann.get("/api/update").is_success
    accounts = {a["username"]: a for a in admin.get("/api/accounts").json()["accounts"]}
    assert accounts["ann"]["in_workspace"] is False


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/boards"),
        ("GET", "/api/people/directory"),
        ("GET", "/api/planning"),
        ("GET", "/api/settings"),
        ("GET", "/api/me/tracker"),
        ("GET", "/api/me/onboarding"),
        ("POST", "/api/invites"),
    ],
)
def test_routes_outside_the_account_answer_no_workspace(app, admin, method, path):
    join(app, invite(admin))
    remove(admin, "ann")
    response = sign_in(app).request(method, path, json={})
    assert (response.status_code, response.json()["error"]["code"]) == (403, "no_workspace")


def test_a_removed_person_loses_the_live_board(app, admin):
    member = join(app, invite(admin))
    board_id = member.post("/api/boards", json={"name": "Ann's"}).json()["id"]
    headers = {"cookie": f"tiko_session={member.cookies.get('tiko_session')}"}
    sockets = TestClient(app)
    with sockets, sockets.websocket_connect(f"/api/boards/{board_id}/live", headers=headers) as ws:
        tab = Tab(ws)
        tab.sync()
        remove(admin, "ann")
        assert closed_with(tab) == 4403
        url = f"/api/boards/{board_id}/live"
        with (
            pytest.raises(WebSocketDisconnect) as closed,
            sockets.websocket_connect(url, headers=headers),
        ):
            pass
        assert closed.value.code == 1008


def test_boards_of_a_removed_person_go_to_the_admin(app, admin):
    member = join(app, invite(admin))
    join(app, invite(admin), "bob", "Bob Ray")
    bob_id = people(admin)["bob"]["id"]
    board_id = member.post("/api/boards", json={"name": "Ann's"}).json()["id"]
    shared = member.put(f"/api/boards/{board_id}/members/{bob_id}", json={"role": "editor"})
    assert shared.is_success
    remove(admin, "ann")

    found = admin.get(f"/api/boards/{board_id}/members").json()["members"]
    assert {(m["user"]["username"], m["role"]) for m in found} == {
        ("admin", "owner"),
        ("bob", "editor"),
    }


def test_a_removed_person_takes_their_tokens_and_caches(app, admin):
    join(app, invite(admin))
    ann_id = people(admin)["ann"]["id"]
    db = app.state.boards._db
    pg.PgCredentialRepo(db).set(ann_id, "jira", "enc", "https://jira.example.com")
    task = Task(source="demo", key="DEMO-1", url="https://example.com/1", fetched_at=now_iso())
    pg.PgSnapshotRepo(db).scoped(ann_id).put_many([task])
    remove(admin, "ann")

    assert pg.PgCredentialRepo(db).get(ann_id, "jira") is None
    assert pg.PgSnapshotRepo(db).scoped(ann_id).get_many([task.ref]) == {}


def test_an_admin_cannot_remove_themselves(admin):
    me = people(admin)["admin"]["id"]
    assert admin.delete(f"/api/people/{me}").status_code == 422


def test_removal_keeps_the_last_active_admin(app):
    db = app.state.boards._db
    users = pg.PgUserRepo(db)
    sole = next(p for p in users.list() if p.role == "admin")
    other = Person(id=uuid.uuid4().hex, username="bob", name="Bob", role="member")
    users.add(other, hash_password(PASSWORD))
    assert users.remove_member(sole.id, other.id) is None
    assert users.get(sole.id).role == "admin"


def test_a_person_of_another_workspace_is_not_removed(app, admin):
    db = app.state.boards._db
    other_ws = add_workspace(db)
    bob = Person(id=uuid.uuid4().hex, username="bob", name="Bob", role="member")
    pg.PgUserRepo(db, other_ws).add(bob, hash_password(PASSWORD))
    assert admin.delete(f"/api/people/{bob.id}").status_code == 404
    assert pg.PgUserRepo(db, other_ws).get(bob.id) is not None


def test_two_admins_stepping_down_at_once_leave_one(app, admin):
    join(app, invite(admin, "admin"))
    found = people(admin)
    users = pg.PgUserRepo(app.state.boards._db)
    start = threading.Barrier(2)
    results: list[bool] = []

    def step_down(user_id: str) -> None:
        start.wait()
        results.append(users.set_role(user_id, "member"))

    threads = [threading.Thread(target=step_down, args=(found[n]["id"],)) for n in ("admin", "ann")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(results) == [False, True]
    assert [p for p in users.list() if p.role == "admin"]


def test_a_removed_person_joins_back_by_invite(app, admin):
    join(app, invite(admin))
    remove(admin, "ann")
    ann = sign_in(app)
    token = invite(admin, "admin")
    ann_id = ann.get("/api/auth/status").json()["me"]["id"]
    run_sql(app, "UPDATE users SET last_sign_in_at = NULL WHERE id = ?", (ann_id,))

    assert ann.get(f"/api/invites/{token}").json()["kind"] == "invite"
    assert ann.post(f"/api/invites/{token}/join").status_code == 204
    assert people(admin)["ann"]["last_sign_in_at"] is not None
    me = ann.get("/api/auth/status").json()["me"]
    assert (me["role"], me["workspace"]["name"]) == ("admin", "Default")
    assert ann.get("/api/boards").is_success
    assert ann.post(f"/api/invites/{token}/join").status_code == 410


def test_someone_in_a_workspace_cannot_join_another(app, admin):
    member = join(app, invite(admin))
    token = invite(admin)
    response = member.post(f"/api/invites/{token}/join")
    assert (response.status_code, response.json()["error"]["code"]) == (409, "in_workspace")
    # The link stays for the person it was made for.
    assert TestClient(app).get(f"/api/invites/{token}").status_code == 200


def test_joining_needs_a_session(app, admin):
    token = invite(admin)
    assert TestClient(app).post(f"/api/invites/{token}/join").status_code == 401


def test_a_reset_link_does_not_join(app, admin):
    join(app, invite(admin))
    ann_id = people(admin)["ann"]["id"]
    remove(admin, "ann")
    url = admin.post(f"/api/accounts/{ann_id}/reset").json()["url"]
    response = sign_in(app).post(f"/api/invites/{url.split('=', 1)[1]}/join")
    assert response.status_code == 422


def test_an_invite_joins_the_workspace_it_was_made_in(app):
    db = app.state.boards._db
    other_ws = add_workspace(db)
    bob = Person(id=uuid.uuid4().hex, username="bob", name="Bob", role="admin")
    pg.PgUserRepo(db, other_ws).add(bob, hash_password(PASSWORD))
    token = invite(signed_in(app, "bob"))
    newcomer = join(app, token, "cat", "Cat Example")
    assert newcomer.get("/api/auth/status").json()["me"]["workspace"]["name"] == "B"
    directory = signed_in(app).get("/api/people/directory", params={"q": "cat"}).json()
    assert directory["people"] == []


def test_member_routes_of_the_workspace_admin(app, admin):
    member = join(app, invite(admin))
    for method, path in (("DELETE", "/api/people/any"), ("PUT", "/api/settings")):
        response = member.request(method, path, json={})
        assert (response.status_code, response.json()["error"]["code"]) == (403, "forbidden")


def test_reset_links_stay_out_of_the_workspace_people(app, admin):
    join(app, invite(admin))
    ann_id = people(admin)["ann"]["id"]
    workspace_admin = join(app, invite(admin, "admin"), "bob", "Bob Ray")
    reset = admin.post(f"/api/accounts/{ann_id}/reset").json()["invite"]
    assert workspace_admin.get("/api/people").json()["invites"] == []
    assert workspace_admin.delete(f"/api/invites/{reset['id']}").status_code == 404
