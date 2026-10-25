import os
import time
from urllib.parse import urlsplit, urlunsplit

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.jira_fake import FakeJira

PASSWORD = "test-password"
# A Postgres server to run the suite on, as a role that may create databases.
PG_SERVER = os.environ.get("TIKO_TEST_DATABASE_URL")


def pytest_configure(config):
    config.addinivalue_line("markers", "shared_rows: the module's tests share one app and its rows")
    if not PG_SERVER:
        raise pytest.UsageError(
            "the backend tests run on Postgres: `make test`, or set TIKO_TEST_DATABASE_URL"
        )


@pytest.fixture(scope="session")
def pg_url():
    """A database of this test run on PG_SERVER, migrated once, dropped at the end."""
    name = f"tiko_test_{os.getpid()}"
    with psycopg.connect(PG_SERVER, autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {name}")
        conn.execute(f"CREATE DATABASE {name}")
    url = urlunsplit(urlsplit(PG_SERVER)._replace(path=f"/{name}"))
    from app.adapters.storage import postgres

    postgres.shared(url)
    # For the whole run: apps of module fixtures and processes the tests start use it too.
    os.environ["DATABASE_URL"] = url
    yield url
    postgres.shared(url).close()
    postgres.shared.cache_clear()
    with psycopg.connect(PG_SERVER, autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


def empty_tables(pg_url: str) -> None:
    with psycopg.connect(pg_url, autocommit=True) as conn:
        workspace = conn.execute("SELECT id FROM workspaces WHERE kind = 'default'").fetchone()[0]
        tables = [
            row[0]
            for row in conn.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
                " AND tablename != 'schema_migrations'"
            )
        ]
        # A live room of the last test may still be saving; its app is never shut down.
        for attempt in range(5):
            try:
                conn.execute(f"TRUNCATE {', '.join(tables)} CASCADE")
                break
            except psycopg.errors.DeadlockDetected:
                if attempt == 4:
                    raise
                time.sleep(0.1)
        conn.execute(
            "INSERT INTO workspaces (id, name, kind, created_at)"
            " VALUES (%s, 'Default', 'default', now())",
            (workspace,),
        )
    from app.adapters.storage import postgres

    postgres.shared(pg_url).seed(workspace)


@pytest.fixture(scope="module", autouse=True)
def pg_clean_module(pg_url, request):
    """A module whose apps live across its tests starts on empty tables once."""
    if request.node.get_closest_marker("shared_rows"):
        empty_tables(pg_url)


@pytest.fixture(autouse=True)
def pg_clean(pg_url, request):
    """Every other test starts on empty tables."""
    if not request.node.get_closest_marker("shared_rows"):
        empty_tables(pg_url)


@pytest.fixture(autouse=True)
def instance_password(monkeypatch):
    monkeypatch.setenv("TIKO_PASSWORD", PASSWORD)
    # No test reaches the real collector.
    monkeypatch.setenv("TIKO_STATS_URL", "http://127.0.0.1:9/")
    monkeypatch.setenv("TIKO_ERROR_REPORTS", "false")
    monkeypatch.setenv("TIKO_ERROR_REPORTS_DSN", "https://public@127.0.0.1:9/1")


def all_rows(app) -> str:
    """Everything the app's database holds, as text."""
    db = app.state.boards._db
    with db.jobs() as conn:
        tables = [
            r["tablename"]
            for r in conn.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
                " AND tablename != 'schema_migrations'"
            )
        ]
        found = [conn.execute(f"SELECT * FROM {t}").fetchall() for t in tables]
    return repr([tuple(row.values()) for table in found for row in table])


@pytest.fixture
def store(pg_url):
    """The storage module and the database of this test run."""
    from app.adapters.storage import postgres

    return postgres, postgres.shared(pg_url)


def add_person(store, user_id: str) -> str:
    """An account to own rows: the reference is checked."""
    from app.domain.accounts import Person

    mod, db = store
    mod.UserRepo(db).add(Person(id=user_id, username=user_id, name=user_id, role="member"), "x")
    return user_id


def run_sql(app, statement: str, params: tuple = ()) -> None:
    """Changes rows behind the app's back, in its workspace; `?` marks parameters."""
    run_sql_on(app.state.boards._db, statement, params)


def query_on(db, statement: str, params: tuple = ()) -> list[tuple]:
    """Rows of a query in the default workspace."""
    with db.transaction(db.default_workspace) as conn:
        return [tuple(row.values()) for row in conn.execute(statement.replace("?", "%s"), params)]


def run_sql_on(db, statement: str, params: tuple = ()) -> None:
    """Changes rows in the default workspace."""
    with db.transaction(db.default_workspace) as conn:
        conn.execute(statement.replace("?", "%s"), params)


def signed_in(app, username: str = "admin", password: str = PASSWORD) -> TestClient:
    """A client with a session; by default the admin made from TIKO_PASSWORD, let past the
    new password screen. Tests of that screen sign in by hand."""
    run_sql(app, "UPDATE users SET must_change_password = false WHERE username = ?", (username,))
    client = TestClient(app)
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 204
    return client


@pytest.fixture
def client() -> TestClient:
    return signed_in(create_app(Settings(db_path=":memory:")))


@pytest.fixture
def fake_jira() -> FakeJira:
    return FakeJira()


@pytest.fixture
def jira_client(fake_jira) -> TestClient:
    """App with a secret key and a fake Jira DC behind the HTTP transport."""
    settings = Settings(db_path=":memory:", tiko_secret_key="test-secret-key")
    return signed_in(create_app(settings, jira_transport=httpx.MockTransport(fake_jira)))
