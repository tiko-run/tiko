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
# A Postgres server to run the suite on, as a role that may create databases; unset: SQLite.
PG_SERVER = os.environ.get("TIKO_TEST_DATABASE_URL")


def pytest_configure(config):
    config.addinivalue_line("markers", "sqlite_only: reads or writes an SQLite file itself")


def pytest_collection_modifyitems(items):
    if PG_SERVER:
        skip = pytest.mark.skip(reason="SQLite file; the copy to Postgres has its own tests")
        for item in items:
            if "sqlite_only" in item.keywords:
                item.add_marker(skip)


@pytest.fixture(scope="session")
def pg_url():
    """A database of this test run on PG_SERVER, migrated once, dropped at the end."""
    if not PG_SERVER:
        yield None
        return
    name = f"tiko_test_{os.getpid()}"
    with psycopg.connect(PG_SERVER, autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {name}")
        conn.execute(f"CREATE DATABASE {name}")
    url = urlunsplit(urlsplit(PG_SERVER)._replace(path=f"/{name}"))
    from app.adapters.storage import postgres

    postgres.shared(url)
    yield url
    postgres.shared(url).close()
    postgres.shared.cache_clear()
    with psycopg.connect(PG_SERVER, autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


@pytest.fixture(autouse=True)
def pg_clean(pg_url, monkeypatch):
    """Every test starts on empty tables; apps built in it use Postgres."""
    if not pg_url:
        return
    monkeypatch.setenv("DATABASE_URL", pg_url)
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


@pytest.fixture(autouse=True)
def instance_password(monkeypatch):
    monkeypatch.setenv("TIKO_PASSWORD", PASSWORD)
    # No test reaches the real collector.
    monkeypatch.setenv("TIKO_STATS_URL", "http://127.0.0.1:9/")
    monkeypatch.setenv("TIKO_ERROR_REPORTS", "false")
    monkeypatch.setenv("TIKO_ERROR_REPORTS_DSN", "https://public@127.0.0.1:9/1")


def storage():
    """The storage adapter module the suite runs on."""
    from app.adapters.storage import postgres, sqlite

    return postgres if PG_SERVER else sqlite


def all_rows(app) -> str:
    """Everything the app's database holds, as text."""
    db = app.state.boards._db
    if not PG_SERVER:
        with db.transaction() as conn:
            tables = [
                r["name"]
                for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            ]
            found = [conn.execute(f"SELECT * FROM {t}").fetchall() for t in tables]
        return repr([tuple(row) for table in found for row in table])
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
    """The storage module and a fresh database of the engine the suite runs on."""
    mod = storage()
    return mod, (mod.shared(pg_url) if pg_url else mod.Database(":memory:"))


def add_person(store, user_id: str) -> str:
    """An account to own rows: Postgres checks the reference, SQLite does not."""
    from app.domain.accounts import Person

    mod, db = store
    mod.UserRepo(db).add(Person(id=user_id, username=user_id, name=user_id, role="member"), "x")
    return user_id


def run_sql(app, statement: str, params: tuple = ()) -> None:
    """Changes rows behind the app's back, in its workspace; `?` marks parameters."""
    run_sql_on(app.state.boards._db, statement, params)


def query_on(db, statement: str, params: tuple = ()) -> list[tuple]:
    """Rows of a query on a database of either engine, in the default workspace."""
    if not PG_SERVER:
        with db.transaction() as conn:
            return [tuple(row) for row in conn.execute(statement, params)]
    with db.transaction(db.default_workspace) as conn:
        return [tuple(row.values()) for row in conn.execute(statement.replace("?", "%s"), params)]


def run_sql_on(db, statement: str, params: tuple = ()) -> None:
    """Changes rows of a database of either engine, in the default workspace."""
    if not PG_SERVER:
        with db.transaction() as conn:
            conn.execute(statement, params)
        return
    with db.transaction(db.default_workspace) as conn:
        conn.execute(statement.replace("?", "%s"), params)


def signed_in(app, username: str = "admin", password: str = PASSWORD) -> TestClient:
    """A client with a session; by default the admin made from TIKO_PASSWORD."""
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
