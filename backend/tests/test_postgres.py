import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.adapters.storage import postgres as pg
from app.config import Settings
from app.domain.accounts import Person, hash_password
from app.domain.boards import BoardDoc
from app.domain.errors import NotFound
from app.domain.invites import Invite
from app.domain.onboarding import Onboarding
from app.domain.planning import PlanningField, PlanningPerson, SavedView, StageType, TimeOff
from app.domain.tasks import Task, now_iso
from app.main import create_app
from tests.conftest import PASSWORD, PG_SERVER, signed_in
from tests.test_live import Tab, closed_with, sticky
from tests.test_public import publish

# Global lookups that carry workspace_id without holding workspace content.
GLOBAL_WITH_WORKSPACE = {"board_index", "invites", "memberships"}


@pytest.fixture
def db(pg_url):
    return pg.shared(pg_url)


@pytest.fixture
def other(db, pg_url) -> str:
    """A second workspace next to the default one."""
    workspace = uuid.uuid4().hex
    with psycopg.connect(pg_url, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO workspaces (id, name, kind, created_at)"
            " VALUES (%s, 'B', 'regular', now())",
            (workspace,),
        )
    db.seed(workspace)
    return workspace


def test_every_workspace_table_forces_its_policy(pg_url):
    with psycopg.connect(pg_url) as conn:
        tables = conn.execute(
            "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c"
            " JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'workspace_id'"
            " WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace"
        ).fetchall()
        policies = {
            row[0]
            for row in conn.execute(
                "SELECT tablename FROM pg_policies WHERE 'tiko_app' = ANY(roles)"
            )
        }
    checked = [t for t in tables if t[0] not in GLOBAL_WITH_WORKSPACE]
    # Lookups run before the workspace is known, so a policy there would hide every row.
    assert {t[0] for t in tables if t[1]} & GLOBAL_WITH_WORKSPACE == set()
    assert len(checked) == 14
    for name, enabled, forced in checked:
        assert enabled and forced, name
        assert name in policies, name


def test_the_start_refuses_a_request_role_that_bypasses_policies(db, pg_url):
    with psycopg.connect(PG_SERVER, autocommit=True) as conn:
        conn.execute("ALTER ROLE tiko_app BYPASSRLS")
        try:
            with pytest.raises(RuntimeError, match="BYPASSRLS"):
                pg.Database(pg_url)
        finally:
            conn.execute("ALTER ROLE tiko_app NOBYPASSRLS")


def test_a_query_without_a_filter_sees_its_workspace_only(db, other):
    pg.PgBoardRepo(db).create("A", BoardDoc(), _person(db))
    with db.transaction(other) as conn:
        assert conn.execute("SELECT COUNT(*) AS n FROM boards").fetchone()["n"] == 0
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "INSERT INTO settings (workspace_id, key, value) VALUES (%s, 'x', 'y')",
                (db.default_workspace,),
            )
    with db.transaction(None) as conn:
        assert conn.execute("SELECT COUNT(*) AS n FROM boards").fetchone()["n"] == 0


def test_two_workspaces_through_one_pooled_connection(pg_url, other):
    db = pg.Database(pg_url, pool_size=1)
    try:
        pg.PgSettingsRepo(db).set_many({"k": "a"})
        pg.PgSettingsRepo(db, other).set_many({"k": "b"})
        assert pg.PgSettingsRepo(db).get_all()["k"] == "a"
        assert pg.PgSettingsRepo(db, other).get_all()["k"] == "b"
        # The setting is local to its transaction; the next one on the connection has none.
        with db.transaction(None) as conn:
            assert conn.execute("SELECT COUNT(*) AS n FROM settings").fetchone()["n"] == 0
    finally:
        db.close()


def _person(db, username: str = "ann") -> str:
    person = Person(id=uuid.uuid4().hex, username=username, name=username, role="admin")
    pg.PgUserRepo(db).add(person, "hash")
    return person.id


def test_no_repository_reads_another_workspace(db, other):
    user = _person(db)
    board = pg.PgBoardRepo(db).create("A", BoardDoc(), user)
    assert board
    pg.PgBoardRepo(db).ensure_public_token(board, "token-a")
    pg.PgMemberRepo(db).set_everyone(board, "viewer")
    pg.PgSettingsRepo(db).set_many({"provider": "jira"})
    pg.PgCredentialRepo(db).set(user, "jira", "enc", "https://jira.example.com")
    task = Task(source="demo", key="DEMO-1", url="https://example.com/DEMO-1", fetched_at=now_iso())
    pg.PgSnapshotRepo(db).scoped(user).put_many([task])
    pg.PgDemoStatusRepo(db).set(user, "DEMO-1", "Done", now_iso())
    pg.PgUserRepo(db).set_onboarding(user, Onboarding())
    pg.PgPlanningTypeRepo(db).add(StageType(id="t1", name="Build", hue=25))
    assert pg.PgPlanningFieldRepo(db).add(PlanningField(id="f1", name="Risk"), 10)
    assert pg.PgPlanningViewRepo(db).add(SavedView(id="v1", name="Mine", filters={}), 10)
    pg.PgPlanningPeopleRepo(db).add(PlanningPerson(id="p1", name="Ann", source="manual"))
    off = TimeOff(id="o1", start="2026-10-20", end="2026-10-21")
    assert pg.PgPlanningPeopleRepo(db).add_off("p1", off, 10)
    invite = Invite(
        id="i1",
        kind="invite",
        role="member",
        expires_at="2999-01-01T00:00:00+00:00",
        created_at=now_iso(),
    )
    pg.PgInviteRepo(db).add(invite, "invite-hash", user)

    assert pg.PgBoardRepo(db, other).listing(user) == []
    assert pg.PgBoardRepo(db, other).get(board) is None
    assert pg.PgBoardRepo(db, other).load(board) is None
    assert pg.PgBoardRepo(db, other).by_public_token("token-a") is None
    assert pg.PgBoardRepo(db, other).public_token(board) is None
    assert pg.PgBoardRepo(db, other).clear_public_token(board) is None
    assert pg.PgBoardRepo(db).public_token(board) == "token-a"
    assert pg.PgMemberRepo(db, other).roles(board, user) is None
    assert pg.PgMemberRepo(db, other).members(board) == []
    assert "provider" not in pg.PgSettingsRepo(db, other).get_all()
    assert pg.PgCredentialRepo(db, other).get(user, "jira") is None
    assert pg.PgSnapshotRepo(db, other).scoped(user).get_many([task.ref]) == {}
    assert pg.PgDemoStatusRepo(db, other).get(user) == {}
    assert pg.PgPlanningTypeRepo(db, other).all() == []
    assert [f.id for f in pg.PgPlanningFieldRepo(db, other).all()] == ["priority", "size", "team"]
    assert pg.PgPlanningViewRepo(db, other).all() == []
    assert pg.PgPlanningPeopleRepo(db, other).all() == []
    assert pg.PgPlanningStageRepo(db, other).for_person("p1") == []
    assert pg.PgInviteRepo(db, other).pending(now_iso()) == []
    # A link is opened by someone outside the workspace; it names its own.
    found = pg.PgInviteRepo(db, other).find_open("invite-hash", now_iso())
    assert found.workspace == db.default_workspace
    # Writes by id from another workspace change nothing.
    pg.PgPlanningTypeRepo(db, other).update(StageType(id="t1", name="Taken", hue=60))
    assert pg.PgPlanningTypeRepo(db).all()[0].name == "Build"
    with pytest.raises(NotFound):
        pg.PgBoardRepo(db, other).rename(board, "Taken")
    assert pg.PgBoardRepo(db).get(board).name == "A"
    assert not pg.PgInviteRepo(db, other).revoke("i1", now_iso())


def test_deleting_a_workspace_leaves_no_rows(db, other, pg_url):
    user = _person(db)
    board = pg.PgBoardRepo(db, other).create("B", BoardDoc(), user)
    pg.PgBoardRepo(db, other).ensure_public_token(board, "token-b")
    pg.PgSettingsRepo(db, other).set_many({"provider": "jira"})
    pg.PgPlanningPeopleRepo(db, other).add(PlanningPerson(id="p1", name="Ann", source="manual"))
    with psycopg.connect(pg_url, autocommit=True) as conn:
        conn.execute("DELETE FROM workspaces WHERE id = %s", (other,))
    with db.jobs() as conn:
        tables = [
            r["relname"]
            for r in conn.execute(
                "SELECT c.relname FROM pg_class c"
                " JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'workspace_id'"
                " WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace"
            )
        ]
        for table in tables:
            left = conn.execute(
                f"SELECT COUNT(*) AS n FROM {table} WHERE workspace_id = %s", (other,)
            ).fetchone()["n"]
            assert left == 0, table


def test_a_deleted_person_takes_their_rows_with_them(db):
    user = _person(db)
    board = pg.PgBoardRepo(db).create("A", BoardDoc(), user)
    pg.PgCredentialRepo(db).set(user, "jira", "enc", "https://jira.example.com")
    pg.PgUserRepo(db).set_onboarding(user, Onboarding())
    with db.transaction(db.default_workspace) as conn:
        assert pg._delete_people(conn, [user]) == [board]
    assert pg.PgUserRepo(db).get(user) is None
    assert pg.PgBoardRepo(db).get(board) is None
    assert pg.PgCredentialRepo(db).get(user, "jira") is None


def test_a_request_works_in_the_workspace_of_its_board_or_person(other):
    app = create_app(Settings(db_path=":memory:"))
    admin = signed_in(app)
    db = app.state.boards._db
    bob = Person(id=uuid.uuid4().hex, username="bob", name="Bob", role="admin")
    pg.PgUserRepo(db, other).add(bob, hash_password(PASSWORD))
    client = signed_in(app, "bob")
    board_id = client.post("/api/boards", json={"name": "Plan B"}).json()["id"]

    assert pg.PgWorkspaces(db).of_board(board_id) == other
    assert "Plan B" in {b["name"] for b in client.get("/api/boards").json()["boards"]}
    assert "Plan B" not in {b["name"] for b in admin.get("/api/boards").json()["boards"]}
    assert client.get(f"/api/boards/{board_id}").status_code == 200
    assert admin.get(f"/api/boards/{board_id}").status_code in (403, 404)
    token = publish(client, board_id)
    assert TestClient(app).get(f"/api/public/{token}").json()["name"] == "Plan B"

    # A save with no request around it, on shutdown, still goes to the board's workspace.
    app.state.live.save_idle_s = 60
    headers = {"cookie": f"tiko_session={client.cookies.get('tiko_session')}"}
    sockets = TestClient(app)
    sockets.__enter__()
    with sockets.websocket_connect(f"/api/boards/{board_id}/live", headers=headers) as socket:
        tab = Tab(socket)
        tab.add(sticky("unsaved"))
        tab.sync()
        sockets.portal.call(app.state.live.shutdown)
        assert closed_with(tab) == 1012
    sockets.__exit__(None, None, None)
    saved = pg.PgBoardRepo(db, other).get(board_id)
    assert [n.id for n in saved.doc.nodes] == ["unsaved"]
    assert pg.PgBoardRepo(db).get(board_id) is None


def test_the_cleanup_of_unused_accounts_stays_in_its_workspace(db, other, pg_url):
    old = "2000-01-01T00:00:00+00:00"
    bob = Person(id=uuid.uuid4().hex, username="bob", name="Bob", role="member")
    pg.PgUserRepo(db, other).add(bob, "hash")
    ann = _person(db, "ann")
    with db.jobs() as conn:
        conn.execute("UPDATE memberships SET role = 'member' WHERE user_id = %s", (ann,))
    with psycopg.connect(pg_url, autocommit=True) as conn:
        conn.execute("UPDATE users SET created_at = %s", (old,))
    gone, _ = pg.PgUserRepo(db).delete_unused_members("2001-01-01T00:00:00+00:00")
    assert gone == [ann]
    assert pg.PgUserRepo(db, other).get(bob.id) is not None


def test_an_admin_reaches_no_account_of_another_workspace(db, other):
    app = create_app(Settings(db_path=":memory:"))
    admin = signed_in(app)
    bob = Person(id=uuid.uuid4().hex, username="bob", name="Bob", role="member")
    pg.PgUserRepo(db, other).add(bob, hash_password(PASSWORD))
    assert "bob" not in {p["username"] for p in admin.get("/api/people").json()["people"]}
    assert admin.patch(f"/api/people/{bob.id}", json={"role": "admin"}).status_code == 404
    # The server admin runs every account; that is the accounts list, not the workspace's people.
    assert "bob" in {a["username"] for a in admin.get("/api/accounts").json()["accounts"]}
    with db.jobs() as conn:
        rows = conn.execute("SELECT workspace_id FROM memberships WHERE user_id = %s", (bob.id,))
        assert [r["workspace_id"] for r in rows] == [other]
    assert pg.PgUserRepo(db, other).get(bob.id).disabled is False


def test_migration_2_moves_the_server_settings_and_names_the_server_admin(db, pg_url):
    gone = Person(id=uuid.uuid4().hex, username="gone", name="Gone", role="admin")
    first = Person(id=uuid.uuid4().hex, username="first", name="First", role="admin")
    later = Person(id=uuid.uuid4().hex, username="later", name="Later", role="admin")
    for person in (gone, first, later):
        pg.PgUserRepo(db).add(person, hash_password(PASSWORD))
    with db.jobs() as conn:
        conn.execute("UPDATE users SET server_admin = false")
        conn.execute("UPDATE users SET created_at = '2001-01-01' WHERE id = %s", (first.id,))
        # Older still, but disabled: not the one who runs the server.
        conn.execute(
            "UPDATE users SET created_at = '2000-01-01', disabled_at = now() WHERE id = %s",
            (gone.id,),
        )
        conn.execute("DELETE FROM server_settings WHERE key = 'usage_stats'")
        conn.execute(
            "INSERT INTO settings (workspace_id, key, value) VALUES (%s, 'usage_stats', '0')",
            (db.default_workspace,),
        )
    step = dict(pg.MIGRATIONS)[2]
    with psycopg.connect(pg_url, autocommit=True) as conn, conn.transaction():
        conn.execute(step.read_text())
    with db.jobs() as conn:
        admins = conn.execute("SELECT id FROM users WHERE server_admin").fetchall()
        moved = conn.execute("SELECT value FROM server_settings WHERE key = 'usage_stats'")
        left = conn.execute("SELECT key FROM settings WHERE key = 'usage_stats'").fetchall()
        assert [row["id"] for row in admins] == [first.id]
        assert [row["value"] for row in moved] == ["0"]
        assert left == []


def test_the_sole_admin_of_another_workspace_is_not_disabled(db, other):
    app = create_app(Settings(db_path=":memory:"))
    admin = signed_in(app)
    bob = Person(id=uuid.uuid4().hex, username="bob", name="Bob", role="admin")
    pg.PgUserRepo(db, other).add(bob, hash_password(PASSWORD))
    response = admin.patch(f"/api/accounts/{bob.id}", json={"disabled": True})
    assert (response.status_code, response.json()["error"]["code"]) == (409, "last_admin")
    assert pg.PgUserRepo(db, other).get(bob.id).disabled is False
