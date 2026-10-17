import os
import sqlite3
import stat

import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters import password_file
from app.adapters.secrets.fernet import FernetSecretBox
from app.adapters.storage.sqlite import MIGRATIONS, Database, SqliteSessionRepo, SqliteUserRepo
from app.config import Settings
from app.domain.accounts import (
    PER_USERNAME_FAILURES,
    PER_USERNAME_WINDOW_S,
    Accounts,
    hash_password,
    verify_password,
)
from app.domain.errors import (
    AccountDisabled,
    InvalidCredentials,
    TooManyAttempts,
    UsernameTaken,
    ValidationFailed,
    WeakPassword,
)
from app.domain.sessions import CACHE_S, SESSION_TTL_S, Sessions
from app.main import create_app
from tests.conftest import PASSWORD, signed_in

NOW = 1_800_000_000.0
LONG = "long-enough-password"


@pytest.fixture
def db() -> Database:
    return Database(":memory:")


@pytest.fixture
def sessions(db) -> Sessions:
    return Sessions(SqliteSessionRepo(db))


@pytest.fixture
def accounts(db, sessions) -> Accounts:
    accounts = Accounts(SqliteUserRepo(db), sessions)
    accounts.create("alice", "Alice", LONG, "member")
    return accounts


def test_password_hash_is_salted_scrypt():
    first, second = hash_password("pw"), hash_password("pw")
    assert first.startswith("scrypt$16384$8$1$") and first != second
    assert verify_password("pw", first) and not verify_password("nope", first)
    assert not verify_password("pw", "garbage")


def test_session_lives_until_it_expires(accounts, sessions):
    token, _ = accounts.sign_in("Alice", LONG, NOW)
    assert sessions.resolve(token, NOW).username == "alice"
    assert sessions.resolve(token, NOW + SESSION_TTL_S) is None


@pytest.mark.parametrize("token", ["", "garbage", "x" * 43])
def test_unknown_tokens_are_rejected(sessions, token):
    assert sessions.resolve(token, NOW) is None


def test_ending_a_session_takes_effect_at_once(accounts, sessions):
    token, _ = accounts.sign_in("alice", LONG, NOW)
    assert sessions.resolve(token, NOW)
    sessions.end(token)
    assert sessions.resolve(token, NOW + 1) is None


def test_disabled_person_drops_out_after_the_cache(db, accounts, sessions):
    token, _ = accounts.sign_in("alice", LONG, NOW)
    assert sessions.resolve(token, NOW)
    with db.transaction() as conn:
        conn.execute("UPDATE users SET disabled_at = 'now'")
    assert sessions.resolve(token, NOW + CACHE_S) is None
    with pytest.raises(AccountDisabled):
        accounts.sign_in("alice", LONG, NOW)


@pytest.mark.parametrize("username,password", [("alice", "nope"), ("nobody", LONG)])
def test_wrong_username_or_password_reads_the_same(accounts, username, password):
    with pytest.raises(InvalidCredentials) as error:
        accounts.sign_in(username, password, NOW)
    assert error.value.message == "Wrong username or password."


def test_too_many_failures_lock_that_username_only(accounts):
    accounts.create("bob", "Bob", LONG, "member")
    for i in range(PER_USERNAME_FAILURES):
        with pytest.raises(InvalidCredentials):
            accounts.sign_in("alice", "nope", NOW + i)
    with pytest.raises(TooManyAttempts) as error:
        accounts.sign_in("ALICE", LONG, NOW + PER_USERNAME_FAILURES)
    assert error.value.retry_after == PER_USERNAME_WINDOW_S - PER_USERNAME_FAILURES
    assert accounts.sign_in("bob", LONG, NOW + PER_USERNAME_FAILURES)
    assert accounts.sign_in("alice", LONG, NOW + PER_USERNAME_WINDOW_S + PER_USERNAME_FAILURES)


def test_usernames_are_unique_without_regard_to_case(accounts):
    with pytest.raises(UsernameTaken):
        accounts.create("ALICE", "Other", LONG, "member")


@pytest.mark.parametrize("username", ["ab", "a" * 33, "with space", "émile", ""])
def test_username_rules(accounts, username):
    with pytest.raises(ValidationFailed):
        accounts.create(username, "Name", LONG, "member")


def test_changing_password_ends_the_other_sessions(accounts, sessions):
    person = sessions.resolve(keep := accounts.sign_in("alice", LONG, NOW)[0], NOW)
    other, _ = accounts.sign_in("alice", LONG, NOW)
    with pytest.raises(InvalidCredentials):
        accounts.change_password(person, "nope", "new-password-1", keep)
    with pytest.raises(WeakPassword):
        accounts.change_password(person, LONG, "short", keep)
    accounts.change_password(person, LONG, "new-password-1", keep)
    assert sessions.resolve(keep, NOW) and sessions.resolve(other, NOW) is None
    with pytest.raises(InvalidCredentials):
        accounts.sign_in("alice", LONG, NOW)
    assert accounts.sign_in("alice", "new-password-1", NOW)


def test_password_file_is_created_once_and_private(tmp_path):
    path = str(tmp_path / "data" / "password")
    password, created = password_file.load_or_create(path)
    assert created and len(password) == 20
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert password_file.load_or_create(path) == (password, False)


@pytest.fixture
def gated() -> TestClient:
    return TestClient(create_app(Settings(db_path=":memory:")))


def login(client: TestClient, password: str = PASSWORD, username: str = "admin", **kwargs):
    return client.post(
        "/api/auth/login", json={"username": username, "password": password}, **kwargs
    )


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/boards"),
        ("POST", "/api/boards"),
        ("GET", "/api/boards/any"),
        ("GET", "/api/settings"),
        ("PUT", "/api/settings"),
        ("POST", "/api/tasks/resolve"),
        ("GET", "/api/version"),
        ("PATCH", "/api/me"),
        ("PUT", "/api/me/password"),
        ("POST", "/api/auth/logout-all"),
        ("GET", "/metrics"),
        ("GET", "/docs"),
        ("GET", "/openapi.json"),
        ("GET", "/api/unknown"),
    ],
)
def test_routes_are_closed_without_a_session(gated, method, path):
    response = gated.request(method, path)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth_required"


@pytest.mark.parametrize("path", ["/health", "/ready", "/api/auth/status"])
def test_health_and_status_stay_open(gated, path):
    assert gated.get(path).status_code == 200


def test_sign_in_sets_a_session_cookie(gated):
    assert gated.get("/api/auth/status").json() == {"signed_in": False, "me": None}
    response = login(gated)
    assert response.status_code == 204
    cookie = response.headers["set-cookie"]
    assert "tiko_session=" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert "Secure" not in cookie
    status = gated.get("/api/auth/status").json()
    assert status["signed_in"] and status["me"]["username"] == "admin"
    assert status["me"]["role"] == "admin"
    assert set(status["me"]) == {"id", "username", "name", "role"}
    assert gated.get("/api/boards").status_code == 200


def test_cookie_is_secure_behind_https(gated):
    response = login(gated, headers={"x-forwarded-proto": "https"})
    assert "Secure" in response.headers["set-cookie"]


def test_wrong_password_then_rate_limit(gated):
    for _ in range(PER_USERNAME_FAILURES):
        response = login(gated, "nope")
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "invalid_credentials"
    response = login(gated)
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0


def test_sign_out_ends_the_session(gated):
    client = signed_in(gated.app)
    stolen = client.cookies["tiko_session"]
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/boards").status_code == 401
    replay = TestClient(gated.app, cookies={"tiko_session": stolen})
    assert replay.get("/api/boards").status_code == 401


def test_sign_out_everywhere(gated):
    first, second = signed_in(gated.app), signed_in(gated.app)
    assert second.post("/api/auth/logout-all").status_code == 204
    assert first.get("/api/boards").status_code == 401
    assert second.get("/api/boards").status_code == 401


def test_edit_my_name_and_username(gated):
    client = signed_in(gated.app)
    body = client.patch("/api/me", json={"name": "  Ann  ", "username": "ann"}).json()
    assert (body["name"], body["username"]) == ("Ann", "ann")
    assert client.get("/api/auth/status").json()["me"]["username"] == "ann"
    assert login(TestClient(gated.app), username="ANN").status_code == 204
    bad = client.patch("/api/me", json={"username": "a b"})
    assert bad.status_code == 422


def test_change_password_over_the_api(gated):
    client, other = signed_in(gated.app), signed_in(gated.app)
    wrong = client.put("/api/me/password", json={"current": "nope", "new": LONG})
    assert (wrong.status_code, wrong.json()["error"]["code"]) == (401, "invalid_credentials")
    weak = client.put("/api/me/password", json={"current": PASSWORD, "new": "short"})
    assert (weak.status_code, weak.json()["error"]["code"]) == (422, "weak_password")
    changed = client.put("/api/me/password", json={"current": PASSWORD, "new": LONG})
    assert changed.status_code == 204
    assert client.get("/api/boards").status_code == 200
    assert other.get("/api/boards").status_code == 401
    assert login(TestClient(gated.app), LONG).status_code == 204


def test_without_env_the_password_is_generated_and_logged_once(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("TIKO_PASSWORD")
    path = tmp_path / "password"
    settings = Settings(db_path=str(tmp_path / "app.db"), password_file=str(path))
    first = TestClient(create_app(settings))
    password = path.read_text().strip()
    assert capsys.readouterr().err.count(password) == 1
    assert login(first, password).status_code == 204
    second = TestClient(create_app(settings))
    assert password not in capsys.readouterr().err
    assert login(second, password).status_code == 204


def _v2026_10_9_database(path: str, secret_key: str) -> None:
    """A database as v2026.10.9 left it: schema 3, two boards, a stored Jira token."""
    conn = sqlite3.connect(path)
    for number, script in MIGRATIONS:
        if number <= 3:
            conn.executescript(script.read_text())
    doc = '{"elements":[]}'
    conn.executemany(
        "INSERT INTO boards (id, name, doc, version, created_at, updated_at)"
        " VALUES (?, ?, ?, 1, '2026-10-08T10:00:00+00:00', '2026-10-08T10:00:00+00:00')",
        [("a" * 32, "Sprint", doc), ("b" * 32, "Roadmap", doc)],
    )
    token = FernetSecretBox(secret_key).encrypt("old-token")
    conn.executemany(
        "INSERT INTO settings (key, value) VALUES (?, ?)",
        [
            ("provider", "jira"),
            ("jira_base_url", "https://jira.example.com"),
            ("jira_token_enc", token),
            ("welcome_seeded", "1"),
        ],
    )
    conn.execute("PRAGMA user_version = 3")
    conn.commit()
    conn.close()


def test_upgrade_from_v2026_10_9_opens_as_admin(tmp_path, monkeypatch, capsys):
    db = str(tmp_path / "app.db")
    _v2026_10_9_database(db, "test-secret-key")
    settings = Settings(db_path=db, tiko_secret_key="test-secret-key")
    client = signed_in(create_app(settings, jira_transport=httpx.MockTransport(lambda _: None)))
    names = sorted(board["name"] for board in client.get("/api/boards").json()["boards"])
    assert names == ["Roadmap", "Sprint"]
    body = client.get("/api/settings").json()
    assert body["provider"] == "jira"
    assert body["jira"] == {"base_url": "https://jira.example.com", "token_state": "set"}

    # Once the admin exists, the variable no longer opens anything and the log says why.
    capsys.readouterr()
    monkeypatch.setenv("TIKO_PASSWORD", "another-password")
    again = TestClient(create_app(settings))
    assert "TIKO_PASSWORD is not used" in capsys.readouterr().err
    assert login(again, "another-password").status_code == 401
    assert login(again).status_code == 204
