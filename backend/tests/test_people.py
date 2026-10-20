import pytest
from fastapi.testclient import TestClient

from app import reset_password
from app.config import Settings, get_settings
from app.domain.accounts import Accounts
from app.domain.errors import InviteExpired
from app.domain.invites import INVITE_TTL_S, Invites
from app.domain.sessions import Sessions
from app.main import create_app
from tests.conftest import PASSWORD, all_rows, signed_in

NOW = 1_800_000_000.0
LONG = "long-enough-password"


@pytest.fixture
def app():
    return create_app(Settings(db_path=":memory:"))


@pytest.fixture
def admin(app) -> TestClient:
    return signed_in(app)


def token_of(url: str) -> str:
    return url.split("=", 1)[1]


def invite(admin: TestClient, role: str = "member") -> str:
    response = admin.post("/api/invites", json={"role": role})
    assert response.status_code == 201
    body = response.json()
    assert body["url"].startswith("/?invite=") and body["invite"]["role"] == role
    return token_of(body["url"])


def join(app, token: str, username: str = "ann", name: str = "Ann Lee") -> TestClient:
    client = TestClient(app)
    response = client.post(
        f"/api/invites/{token}/accept",
        json={"username": username, "name": name, "password": LONG},
    )
    assert response.status_code == 204, response.json()
    return client


def people(admin: TestClient) -> dict:
    return {person["username"]: person for person in admin.get("/api/people").json()["people"]}


def test_invite_link_makes_a_signed_in_member(app, admin):
    token = invite(admin)
    anonymous = TestClient(app)
    info = anonymous.get(f"/api/invites/{token}").json()
    assert info == {"kind": "invite", "role": "member", "username": None}
    member = join(app, token)
    me = member.get("/api/auth/status").json()["me"]
    assert (me["username"], me["name"], me["role"]) == ("ann", "Ann Lee", "member")
    assert people(admin)["ann"]["last_sign_in_at"] is None
    assert admin.get("/api/people").json()["invites"] == []


def test_an_invite_works_once(app, admin):
    token = invite(admin)
    join(app, token)
    again = TestClient(app).post(
        f"/api/invites/{token}/accept", json={"username": "bob", "name": "Bob", "password": LONG}
    )
    assert (again.status_code, again.json()["error"]["code"]) == (410, "invite_expired")
    assert TestClient(app).get(f"/api/invites/{token}").status_code == 410


def test_a_taken_username_keeps_the_invite(app, admin):
    token = invite(admin)
    response = TestClient(app).post(
        f"/api/invites/{token}/accept",
        json={"username": "ADMIN", "name": "Copy", "password": LONG},
    )
    assert (response.status_code, response.json()["error"]["code"]) == (409, "username_taken")
    join(app, token, "bob")


def test_weak_password_is_refused(app, admin):
    response = TestClient(app).post(
        f"/api/invites/{invite(admin)}/accept",
        json={"username": "ann", "name": "Ann", "password": "short"},
    )
    assert (response.status_code, response.json()["error"]["code"]) == (422, "weak_password")


def test_only_the_hash_is_stored(tmp_path):
    db_path = str(tmp_path / "app.db")
    admin = signed_in(create_app(Settings(db_path=db_path)))
    token = invite(admin)
    assert token not in all_rows(admin.app)


def test_revoked_invite_stops_working(app, admin):
    token = invite(admin)
    pending = admin.get("/api/people").json()["invites"]
    assert len(pending) == 1 and pending[0]["kind"] == "invite"
    assert admin.delete(f"/api/invites/{pending[0]['id']}").status_code == 204
    assert admin.delete(f"/api/invites/{pending[0]['id']}").status_code == 404
    assert TestClient(app).get(f"/api/invites/{token}").status_code == 410


def test_invites_expire_after_seven_days(store):
    mod, db = store
    users = mod.UserRepo(db)
    sessions = Sessions(mod.SessionRepo(db))
    accounts = Accounts(users, sessions)
    admin = accounts.create("admin", "Admin", LONG, "admin")
    invites = Invites(mod.InviteRepo(db), accounts, sessions)
    _, token = invites.invite(admin, "member", NOW)
    assert invites.open(token, NOW + INVITE_TTL_S - 1).kind == "invite"
    with pytest.raises(InviteExpired):
        invites.accept(token, LONG, NOW + INVITE_TTL_S, "ann", "Ann")


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/people"),
        ("PATCH", "/api/people/any"),
        ("POST", "/api/invites"),
        ("DELETE", "/api/invites/any"),
    ],
)
def test_people_routes_are_for_admins(app, admin, method, path):
    member = join(app, invite(admin))
    response = member.request(method, path, json={})
    assert (response.status_code, response.json()["error"]["code"]) == (403, "forbidden")
    assert TestClient(app).request(method, path, json={}).status_code == 401


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/accounts"),
        ("PATCH", "/api/accounts/any"),
        ("POST", "/api/accounts/any/reset"),
        ("GET", "/api/privacy"),
        ("PUT", "/api/privacy"),
        ("POST", "/api/update"),
    ],
)
def test_server_routes_are_for_the_server_admin(app, admin, method, path):
    workspace_admin = join(app, invite(admin, "admin"))
    response = workspace_admin.request(method, path, json={})
    assert (response.status_code, response.json()["error"]["code"]) == (403, "forbidden")
    assert TestClient(app).request(method, path, json={}).status_code == 401


def test_metrics_are_for_the_server_admin(app, admin):
    workspace_admin = join(app, invite(admin, "admin"))
    assert workspace_admin.get("/metrics").status_code == 404
    assert admin.get("/metrics").status_code == 200


def test_status_names_the_server_admin_and_the_workspace(app, admin):
    me = admin.get("/api/auth/status").json()["me"]
    assert me["server_admin"] is True and me["role"] == "admin"
    assert me["workspace"]["name"] == "Default"
    member = join(app, invite(admin)).get("/api/auth/status").json()["me"]
    assert member["server_admin"] is False and member["workspace"] == me["workspace"]


def test_accounts_lists_everyone_on_the_server(app, admin):
    join(app, invite(admin))
    found = {a["username"]: a for a in admin.get("/api/accounts").json()["accounts"]}
    assert set(found) == {"admin", "ann"}
    assert found["admin"]["server_admin"] and not found["ann"]["server_admin"]
    assert found["ann"]["in_workspace"] and not found["ann"]["disabled"]


def test_disabling_signs_the_person_out_at_once(app, admin):
    member = join(app, invite(admin))
    ann = people(admin)["ann"]
    body = admin.patch(f"/api/accounts/{ann['id']}", json={"disabled": True}).json()
    assert body["disabled"] is True
    assert people(admin)["ann"]["disabled"] is True
    assert member.get("/api/boards").status_code == 401
    response = TestClient(app).post("/api/auth/login", json={"username": "ann", "password": LONG})
    assert (response.status_code, response.json()["error"]["code"]) == (403, "account_disabled")
    admin.patch(f"/api/accounts/{ann['id']}", json={"disabled": False})
    assert signed_in(app, "ann", LONG).get("/api/boards").status_code == 200


def test_people_change_the_role_only(app, admin):
    join(app, invite(admin))
    ann = people(admin)["ann"]
    response = admin.patch(f"/api/people/{ann['id']}", json={"disabled": True})
    assert response.status_code == 422
    assert people(admin)["ann"]["disabled"] is False


def test_make_admin_and_back(app, admin):
    member = join(app, invite(admin))
    ann = people(admin)["ann"]
    assert admin.patch(f"/api/people/{ann['id']}", json={"role": "admin"}).json()["role"] == "admin"
    assert member.get("/api/people").status_code == 200
    admin.patch(f"/api/people/{ann['id']}", json={"role": "member"})
    assert member.get("/api/people").status_code == 403


def test_the_last_admin_stays(admin):
    me = people(admin)["admin"]
    response = admin.patch(f"/api/people/{me['id']}", json={"role": "member"})
    assert (response.status_code, response.json()["error"]["code"]) == (409, "last_admin")


def test_the_server_admin_cannot_be_disabled(app, admin):
    join(app, invite(admin, "admin"))
    me = people(admin)["admin"]
    response = admin.patch(f"/api/accounts/{me['id']}", json={"disabled": True})
    assert (response.status_code, response.json()["error"]["code"]) == (409, "last_admin")


def test_disabling_keeps_an_admin_in_the_workspace(app, admin):
    join(app, invite(admin, "admin"))
    found = people(admin)
    assert admin.patch(f"/api/people/{found['admin']['id']}", json={"role": "member"}).is_success
    response = admin.patch(f"/api/accounts/{found['ann']['id']}", json={"disabled": True})
    assert (response.status_code, response.json()["error"]["code"]) == (409, "last_admin")


def test_reset_link_sets_a_new_password(app, admin):
    member = join(app, invite(admin))
    ann = people(admin)["ann"]
    response = admin.post(f"/api/accounts/{ann['id']}/reset")
    assert response.status_code == 201
    token = token_of(response.json()["url"])
    assert response.json()["url"].startswith("/?reset=")
    info = TestClient(app).get(f"/api/invites/{token}").json()
    assert info == {"kind": "reset", "role": None, "username": "ann"}
    fresh = TestClient(app)
    accepted = fresh.post(f"/api/invites/{token}/accept", json={"password": "brand-new-password"})
    assert accepted.status_code == 204
    assert fresh.get("/api/auth/status").json()["me"]["username"] == "ann"
    assert member.get("/api/boards").status_code == 401
    old = TestClient(app).post("/api/auth/login", json={"username": "ann", "password": LONG})
    assert old.status_code == 401


def test_reset_password_command(tmp_path, monkeypatch, capsys):
    db_path = str(tmp_path / "app.db")
    app = create_app(Settings(db_path=db_path))
    monkeypatch.setenv("DB_PATH", db_path)
    get_settings.cache_clear()
    try:
        assert reset_password.main(["ADMIN"]) == 0
        assert reset_password.main(["nobody"]) == 1
    finally:
        get_settings.cache_clear()
    url = capsys.readouterr().out.strip().splitlines()[-1]
    client = TestClient(app)
    accepted = client.post(f"/api/invites/{token_of(url)}/accept", json={"password": LONG})
    assert accepted.status_code == 204
    assert signed_in(app, "admin", LONG)
    with pytest.raises(AssertionError):
        signed_in(app, "admin", PASSWORD)
