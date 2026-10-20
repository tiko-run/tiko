import json
import logging
import sys
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC
from functools import cache
from pathlib import Path
from typing import Literal

import psycopg
from psycopg import sql
from psycopg.errors import UniqueViolation
from psycopg.rows import dict_row
from psycopg.types.datetime import TimestamptzBinaryLoader, TimestamptzLoader
from psycopg.types.string import TextBinaryLoader, TextLoader
from psycopg_pool import ConnectionPool

from app.domain.accounts import Account, Person, PersonRecord, Role
from app.domain.attempts import BROWSERS_PER_PERSON
from app.domain.boards import BoardDoc, BoardRecord, BoardRow, planned_stages
from app.domain.errors import NotFound, UsernameTaken, VersionConflict
from app.domain.invites import Invite
from app.domain.members import BoardRole, Member, MemberUser, ShareRole
from app.domain.onboarding import Onboarding
from app.domain.planning import (
    IndexedStage,
    PlanningField,
    PlanningPerson,
    SavedView,
    StageType,
    TimeOff,
)
from app.domain.tasks import Task, now_iso
from app.domain.workspaces import current_workspace
from app.observability import DB_HELD, DB_HELD_BY_KIND, DB_WAIT

log = logging.getLogger(__name__)

MIGRATIONS = sorted(
    (int(path.name.split("_", 1)[0]), path)
    for path in (Path(__file__).parent / "pg_migrations").glob("*.sql")
)
APP_ROLE, JOBS_ROLE = "tiko_app", "tiko_jobs"
# Any constant works; it only has to be the same in every process of this app.
_MIGRATION_LOCK = 0x7469_6B6F


class _IsoLoader(TimestamptzLoader):
    # The domain keeps times as ISO strings, as SQLite stored them.
    def load(self, data):
        return super().load(data).astimezone(UTC).isoformat(timespec="seconds")


class _IsoBinaryLoader(TimestamptzBinaryLoader):
    def load(self, data):
        return super().load(data).astimezone(UTC).isoformat(timespec="seconds")


def _setup(conn: psycopg.Connection, role: str | None) -> None:
    conn.adapters.register_loader("timestamptz", _IsoLoader)
    conn.adapters.register_loader("timestamptz", _IsoBinaryLoader)
    # JSON comes back as its text: the domain validates it with pydantic.
    conn.adapters.register_loader("jsonb", TextLoader)
    conn.adapters.register_loader("jsonb", TextBinaryLoader)
    conn.execute("SET TIME ZONE 'UTC'")
    if role:
        conn.execute(sql.SQL("SET ROLE {}").format(sql.Identifier(role)))


def _connect(url: str) -> psycopg.Connection:
    conn = psycopg.connect(url, autocommit=True, row_factory=dict_row)
    _setup(conn, None)
    return conn


class Database:
    """Two pools over one login: requests run as tiko_app inside one workspace, jobs that cross
    workspaces as tiko_jobs. The owner the URL names only migrates."""

    def __init__(self, url: str, *, pool_size: int = 4) -> None:
        self._url = url
        with _connect(url) as conn:
            self._migrate(conn)
            _refuse_bypass(conn)
            self.default_workspace = _default_workspace(conn)
        self._app = self._pool(APP_ROLE, pool_size)
        self._jobs = self._pool(JOBS_ROLE, 2)
        self.seed(self.default_workspace)

    def seed(self, workspace: str) -> None:
        """What a new workspace starts with; safe to run again."""
        with self.jobs() as conn:
            conn.execute(
                "INSERT INTO planning_fields (workspace_id, id, name, standard, position)"
                " VALUES (%s, 'priority', 'Priority', true, 1), (%s, 'size', 'Size', true, 2),"
                " (%s, 'team', 'Team', true, 3) ON CONFLICT DO NOTHING",
                (workspace, workspace, workspace),
            )
            # The random id of the usage stats, made here so processes that start together
            # share it.
            conn.execute(
                "INSERT INTO server_settings (key, value)"
                " VALUES ('instance_id', gen_random_uuid()::text) ON CONFLICT DO NOTHING"
            )

    def _pool(self, role: str, size: int) -> ConnectionPool:
        return ConnectionPool(
            self._url,
            min_size=1,
            max_size=size,
            kwargs={"autocommit": True, "row_factory": dict_row},
            configure=lambda conn: _setup(conn, role),
            name=role,
            open=True,
        )

    @staticmethod
    def _migrate(conn: psycopg.Connection) -> None:
        # Several processes start together; one applies, the others find it done. The table too:
        # IF NOT EXISTS does not make two creations at once safe.
        conn.execute("SELECT pg_advisory_lock(%s)", (_MIGRATION_LOCK,))
        try:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations"
                " (number integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
            )
            done = {r["number"] for r in conn.execute("SELECT number FROM schema_migrations")}
            for number, path in MIGRATIONS:
                if number in done:
                    continue
                with conn.transaction():
                    conn.execute(path.read_text())
                    conn.execute("INSERT INTO schema_migrations (number) VALUES (%s)", (number,))
                log.info("database migrated to %s", number)
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (_MIGRATION_LOCK,))

    def close(self) -> None:
        self._app.close()
        self._jobs.close()

    def transaction(self, workspace: str | None, kind: str | None = None):
        """One transaction as tiko_app, seeing only `workspace`; None sees global tables only."""
        return self._tx(self._app, workspace, kind or sys._getframe(1).f_code.co_qualname)

    def jobs(self):
        """One transaction as tiko_jobs, for work that crosses workspaces."""
        return self._tx(self._jobs, None, sys._getframe(1).f_code.co_qualname)

    @contextmanager
    def _tx(self, pool: ConnectionPool, workspace: str | None, kind: str) -> Iterator:
        asked = time.perf_counter()
        with pool.connection() as conn:
            started = time.perf_counter()
            DB_WAIT.observe(started - asked)
            try:
                with conn.transaction():
                    if workspace:
                        # Local to the transaction, so the pooled connection forgets it after.
                        conn.execute(
                            "SELECT set_config('app.workspace_id', %s, true)", (workspace,)
                        )
                    yield conn
            finally:
                held = time.perf_counter() - started
                DB_HELD.observe(held)
                DB_HELD_BY_KIND.labels(kind).observe(held)

    def size(self) -> int:
        """Bytes the database takes on disk."""
        with self.jobs() as conn:
            return conn.execute("SELECT pg_database_size(current_database()) AS n").fetchone()["n"]

    def ping(self) -> bool:
        try:
            with self._app.connection() as conn:
                return conn.execute("SELECT 1 AS one").fetchone()["one"] == 1
        except psycopg.Error:
            return False


@cache
def shared(url: str) -> Database:
    """One database per process: apps built again, as tests do, reuse its pools."""
    return Database(url)


def _refuse_bypass(conn: psycopg.Connection) -> None:
    for role in (APP_ROLE, JOBS_ROLE):
        row = conn.execute(
            "SELECT r.rolsuper, r.rolbypassrls,"
            " EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner = r.oid"
            " AND c.relnamespace = 'public'::regnamespace) AS owns"
            " FROM pg_roles r WHERE r.rolname = %s",
            (role,),
        ).fetchone()
        if row is None or row["rolsuper"] or row["rolbypassrls"] or row["owns"]:
            raise RuntimeError(
                f"database role {role} must exist, not be a superuser, not have BYPASSRLS"
                " and own no table; see the guide's database page"
            )


def _default_workspace(conn: psycopg.Connection) -> str:
    conn.execute(
        "INSERT INTO workspaces (id, name, kind, created_at) VALUES (%s, 'Default', 'default', %s)"
        " ON CONFLICT DO NOTHING",
        (uuid.uuid4().hex, now_iso()),
    )
    return conn.execute("SELECT id FROM workspaces WHERE kind = 'default'").fetchone()["id"]


class _Repo:
    def __init__(self, db: Database, workspace: str | None = None) -> None:
        self._db = db
        self._fixed = workspace

    @property
    def _ws(self) -> str:
        # Given at construction, else the request's or job's, else the default one.
        return self._fixed or current_workspace.get() or self._db.default_workspace

    def _tx(self):
        # Named after the repository method, so a slow kind of work can be told from the rest.
        return self._db.transaction(self._ws, sys._getframe(1).f_code.co_qualname)


class PgWorkspaces:
    """Reads only global tables, so it works before the workspace is known."""

    def __init__(self, db: Database) -> None:
        self._db = db

    def of_board(self, board_id: str) -> str | None:
        with self._db.transaction(None) as conn:
            row = conn.execute(
                "SELECT workspace_id FROM board_index WHERE board_id = %s", (board_id,)
            ).fetchone()
        return row["workspace_id"] if row else None

    def of_public_token(self, token: str) -> str | None:
        with self._db.transaction(None) as conn:
            row = conn.execute(
                "SELECT workspace_id FROM board_index WHERE public_token = %s", (token,)
            ).fetchone()
        return row["workspace_id"] if row else None

    def of_person(self, user_id: str) -> str | None:
        # One workspace per account in spec 032; the oldest wins once there may be more.
        with self._db.transaction(None) as conn:
            row = conn.execute(
                "SELECT m.workspace_id FROM memberships m"
                " JOIN workspaces w ON w.id = m.workspace_id"
                " WHERE m.user_id = %s ORDER BY w.created_at LIMIT 1",
                (user_id,),
            ).fetchone()
        return row["workspace_id"] if row else None

    def role_in(self, user_id: str, workspace: str) -> Role | None:
        with self._db.transaction(None) as conn:
            row = conn.execute(
                "SELECT role FROM memberships WHERE user_id = %s AND workspace_id = %s",
                (user_id, workspace),
            ).fetchone()
        return row["role"] if row else None

    def name(self, workspace: str) -> str | None:
        with self._db.transaction(None) as conn:
            row = conn.execute("SELECT name FROM workspaces WHERE id = %s", (workspace,)).fetchone()
        return row["name"] if row else None


def _lock_workspace(conn: psycopg.Connection, workspace: str) -> None:
    # Count-then-insert checks run one at a time per workspace, as SQLite's write lock did.
    conn.execute("SELECT 1 FROM workspaces WHERE id = %s FOR UPDATE", (workspace,))


def _sole_admin(conn: psycopg.Connection, workspace: str, user_id: str) -> bool:
    """Whether the person is the last active admin of the workspace; lock it first."""
    return conn.execute(
        "SELECT EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id"
        " WHERE m.workspace_id = %s AND m.user_id = %s AND m.role = 'admin'"
        " AND u.disabled_at IS NULL) AND (SELECT COUNT(*) FROM memberships m"
        " JOIN users u ON u.id = m.user_id WHERE m.workspace_id = %s AND m.role = 'admin'"
        " AND u.disabled_at IS NULL) <= 1 AS sole",
        (workspace, user_id, workspace),
    ).fetchone()["sole"]


def _lock_key(conn: psycopg.Connection, *parts: str) -> None:
    conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", ("\x1f".join(parts),))


def _index_stages(conn: psycopg.Connection, ws: str, board_id: str, doc: BoardDoc) -> None:
    # In the transaction that saves the board, so the workload never sees a half-saved plan.
    conn.execute("DELETE FROM planning_stages WHERE board_id = %s", (board_id,))
    stages = planned_stages(doc)
    if stages:
        conn.cursor().executemany(
            "INSERT INTO planning_stages"
            ' (workspace_id, board_id, person_id, row_title, type, start, "end")'
            " VALUES (%s, %s, %s, %s, %s, %s, %s)",
            [(ws, board_id, *stage) for stage in stages],
        )


def _doc(doc: BoardDoc) -> str:
    return doc.model_dump_json(exclude_none=True)


class PgBoardRepo(_Repo):
    def listing(
        self, user_id: str, board_id: str | None = None, others: bool = False
    ) -> list[BoardRow]:
        if board_id:
            where, params = "WHERE b.id = %s", (user_id, board_id)
        elif others:
            # A demo visitor's boards are theirs alone and gone in days; they would bury the rest.
            where, params = "WHERE m.role IS NOT NULL OR u.demo_expires_at IS NULL", (user_id,)
        else:
            where = (
                "WHERE b.id IN (SELECT board_id FROM board_members WHERE user_id = %s"
                " UNION SELECT id FROM boards WHERE everyone_role IS NOT NULL)"
            )
            params = (user_id, user_id)
        with self._tx() as conn:
            rows = conn.execute(
                "SELECT b.id, b.name, b.updated_at, b.everyone_role, m.role AS member_role,"
                " o.user_id AS owner_id, u.name AS owner_name,"
                " i.public_token IS NOT NULL AS public FROM boards b"
                " JOIN board_index i ON i.board_id = b.id"
                " LEFT JOIN board_members m ON m.board_id = b.id AND m.user_id = %s"
                " LEFT JOIN board_members o ON o.board_id = b.id AND o.role = 'owner'"
                f" LEFT JOIN users u ON u.id = o.user_id {where} ORDER BY b.updated_at DESC",
                params,
            ).fetchall()
        return [BoardRow(**row) for row in rows]

    def create(
        self, name: str, doc: BoardDoc, owner_id: str, limit: int | None = None
    ) -> str | None:
        with self._tx() as conn:
            if limit is not None:
                _lock_key(conn, "owned", owner_id)
                if self._owned(conn, owner_id) >= limit:
                    return None
            return self._insert(conn, name, doc, owner_id)

    def create_welcome(self, user_id: str, name: str, doc: BoardDoc) -> str | None:
        with self._tx() as conn:
            claimed = conn.execute(
                "UPDATE users SET welcomed_at = %s WHERE id = %s AND welcomed_at IS NULL",
                (now_iso(), user_id),
            )
            if claimed.rowcount == 0:
                return None
            return None if self._owned(conn, user_id) else self._insert(conn, name, doc, user_id)

    @staticmethod
    def _owned(conn: psycopg.Connection, user_id: str) -> int:
        return conn.execute(
            "SELECT COUNT(*) AS n FROM board_members WHERE user_id = %s AND role = 'owner'",
            (user_id,),
        ).fetchone()["n"]

    def _insert(self, conn: psycopg.Connection, name: str, doc: BoardDoc, owner_id: str) -> str:
        board_id, now = uuid.uuid4().hex, now_iso()
        conn.execute(
            "INSERT INTO boards (workspace_id, id, name, doc, version, created_at, updated_at)"
            " VALUES (%s, %s, %s, %s::jsonb, 1, %s, %s)",
            (self._ws, board_id, name, _doc(doc), now, now),
        )
        conn.execute(
            "INSERT INTO board_index (board_id, workspace_id) VALUES (%s, %s)",
            (board_id, self._ws),
        )
        conn.execute(
            "INSERT INTO board_members (workspace_id, board_id, user_id, role)"
            " VALUES (%s, %s, %s, 'owner')",
            (self._ws, board_id, owner_id),
        )
        _index_stages(conn, self._ws, board_id, doc)
        # Someone who made a board of their own needs no welcome board later.
        conn.execute(
            "UPDATE users SET welcomed_at = %s WHERE id = %s AND welcomed_at IS NULL",
            (now, owner_id),
        )
        return board_id

    def owned(self, user_id: str) -> int:
        with self._tx() as conn:
            return self._owned(conn, user_id)

    def owner(self, board_id: str) -> str | None:
        with self._tx() as conn:
            row = conn.execute(
                "SELECT user_id FROM board_members WHERE board_id = %s AND role = 'owner'",
                (board_id,),
            ).fetchone()
        return row["user_id"] if row else None

    def get(self, board_id: str) -> BoardRecord | None:
        with self._tx() as conn:
            row = conn.execute(
                "SELECT id, name, doc, version, updated_at FROM boards WHERE id = %s",
                (board_id,),
            ).fetchone()
        if row is None:
            return None
        return BoardRecord(
            id=row["id"],
            name=row["name"],
            version=row["version"],
            updated_at=row["updated_at"],
            doc=BoardDoc.model_validate_json(row["doc"]),
        )

    def load(self, board_id: str) -> tuple[BoardRecord, bytes | None] | None:
        with self._tx() as conn:
            row = conn.execute(
                "SELECT id, name, doc, version, updated_at, ydoc FROM boards WHERE id = %s",
                (board_id,),
            ).fetchone()
        if row is None:
            return None
        record = BoardRecord(
            id=row["id"],
            name=row["name"],
            version=row["version"],
            updated_at=row["updated_at"],
            doc=BoardDoc.model_validate_json(row["doc"]),
        )
        return record, row["ydoc"]

    def save_live(self, board_id: str, doc: BoardDoc, ydoc: bytes) -> int:
        with self._tx() as conn:
            row = conn.execute(
                "UPDATE boards SET doc = %s::jsonb, ydoc = %s, version = version + 1,"
                " updated_at = %s WHERE id = %s RETURNING version",
                (_doc(doc), ydoc, now_iso(), board_id),
            ).fetchone()
            if row is not None:
                _index_stages(conn, self._ws, board_id, doc)
        if row is None:
            raise NotFound("board not found")
        return row["version"]

    def keep_live_state(self, board_id: str, ydoc: bytes) -> None:
        with self._tx() as conn:
            conn.execute(
                "UPDATE boards SET ydoc = %s WHERE id = %s AND ydoc IS NULL", (ydoc, board_id)
            )
            exists = conn.execute("SELECT 1 FROM boards WHERE id = %s", (board_id,)).fetchone()
        if exists is None:
            raise NotFound("board not found")

    def save(self, board_id: str, version: int, doc: BoardDoc, ydoc: bytes | None = None) -> int:
        with self._tx() as conn:
            cursor = conn.execute(
                "UPDATE boards SET doc = %s::jsonb, ydoc = %s, version = version + 1,"
                " updated_at = %s WHERE id = %s AND version = %s",
                (_doc(doc), ydoc, now_iso(), board_id, version),
            )
            if cursor.rowcount == 0:
                exists = conn.execute("SELECT 1 FROM boards WHERE id = %s", (board_id,)).fetchone()
                if exists is None:
                    raise NotFound("board not found")
                raise VersionConflict("board was changed elsewhere; reload it")
            _index_stages(conn, self._ws, board_id, doc)
        return version + 1

    def rename(self, board_id: str, name: str) -> None:
        with self._tx() as conn:
            cursor = conn.execute(
                "UPDATE boards SET name = %s, updated_at = %s WHERE id = %s",
                (name, now_iso(), board_id),
            )
        if cursor.rowcount == 0:
            raise NotFound("board not found")

    def delete(self, board_id: str) -> None:
        # Members, stages and the index row go by cascade.
        with self._tx() as conn:
            cursor = conn.execute("DELETE FROM boards WHERE id = %s", (board_id,))
        if cursor.rowcount == 0:
            raise NotFound("board not found")

    def public_token(self, board_id: str) -> str | None:
        with self._tx() as conn:
            row = conn.execute(
                "SELECT i.public_token FROM boards b JOIN board_index i ON i.board_id = b.id"
                " WHERE b.id = %s",
                (board_id,),
            ).fetchone()
        return row["public_token"] if row else None

    def ensure_public_token(self, board_id: str, token: str) -> str | None:
        with self._tx() as conn:
            # Through boards, so only a board this workspace sees gets a link.
            conn.execute(
                "UPDATE board_index i SET public_token = %s FROM boards b"
                " WHERE b.id = i.board_id AND i.board_id = %s AND i.public_token IS NULL",
                (token, board_id),
            )
        return self.public_token(board_id)

    def clear_public_token(self, board_id: str) -> str | None:
        with self._tx() as conn:
            row = conn.execute(
                "SELECT i.public_token FROM boards b JOIN board_index i ON i.board_id = b.id"
                " WHERE b.id = %s FOR UPDATE OF i",
                (board_id,),
            ).fetchone()
            # board_index is global: only a board this workspace sees loses its link.
            if row is None:
                return None
            conn.execute(
                "UPDATE board_index SET public_token = NULL WHERE board_id = %s", (board_id,)
            )
        return row["public_token"]

    def by_public_token(self, token: str) -> tuple[str, int, str] | None:
        with self._tx() as conn:
            row = conn.execute(
                "SELECT b.id, b.version, b.updated_at FROM board_index i"
                " JOIN boards b ON b.id = i.board_id WHERE i.public_token = %s",
                (token,),
            ).fetchone()
        return (row["id"], row["version"], row["updated_at"]) if row else None


class PgSnapshotRepo(_Repo):
    """Task snapshots of one person."""

    def __init__(self, db: Database, workspace: str | None = None, owner: str = "") -> None:
        super().__init__(db, workspace)
        self._owner = owner

    def scoped(self, owner: str) -> "PgSnapshotRepo":
        return PgSnapshotRepo(self._db, self._fixed, owner)

    def get_many(self, refs: list[str]) -> dict[str, Task]:
        if not refs:
            return {}
        with self._tx() as conn:
            rows = conn.execute(
                "SELECT data FROM task_snapshots"
                " WHERE user_id = %s AND source || ':' || key = ANY(%s)",
                (self._owner, refs),
            ).fetchall()
        tasks = [Task.model_validate_json(row["data"]) for row in rows]
        return {task.ref: task for task in tasks}

    def put_many(self, tasks: list[Task]) -> None:
        if not tasks:
            return
        with self._tx() as conn:
            conn.cursor().executemany(
                "INSERT INTO task_snapshots"
                " (workspace_id, user_id, source, key, state, data, fetched_at)"
                " VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s)"
                " ON CONFLICT (workspace_id, user_id, source, key) DO UPDATE SET"
                " state = excluded.state, data = excluded.data, fetched_at = excluded.fetched_at",
                [
                    (
                        self._ws,
                        self._owner,
                        t.source,
                        t.key,
                        t.state,
                        t.model_dump_json(),
                        t.fetched_at,
                    )
                    for t in tasks
                ],
            )

    def forget(self, source: str) -> None:
        with self._tx() as conn:
            conn.execute(
                "DELETE FROM task_snapshots WHERE user_id = %s AND source = %s",
                (self._owner, source),
            )


class PgCredentialRepo(_Repo):
    def get(self, user_id: str, provider: str) -> tuple[str, str] | None:
        with self._tx() as conn:
            row = conn.execute(
                "SELECT token_enc, base_url FROM user_credentials"
                " WHERE user_id = %s AND provider = %s",
                (user_id, provider),
            ).fetchone()
        return (row["token_enc"], row["base_url"]) if row else None

    def set(self, user_id: str, provider: str, token_enc: str, base_url: str) -> None:
        with self._tx() as conn:
            conn.execute(
                "INSERT INTO user_credentials"
                " (workspace_id, user_id, provider, token_enc, base_url)"
                " VALUES (%s, %s, %s, %s, %s) ON CONFLICT (workspace_id, user_id, provider)"
                " DO UPDATE SET token_enc = excluded.token_enc, base_url = excluded.base_url",
                (self._ws, user_id, provider, token_enc, base_url),
            )

    def delete(self, user_id: str, provider: str) -> None:
        with self._tx() as conn:
            conn.execute(
                "DELETE FROM user_credentials WHERE user_id = %s AND provider = %s",
                (user_id, provider),
            )

    def adopt_instance_token(self, user_id: str) -> None:
        """Moves the token from before accounts to this person, once."""
        with self._tx() as conn:
            conn.execute(
                "INSERT INTO user_credentials"
                " (workspace_id, user_id, provider, token_enc, base_url)"
                " SELECT %s, %s, 'jira', t.value, u.value FROM settings t"
                " JOIN settings u ON u.key = 'jira_base_url' WHERE t.key = 'jira_token_enc'"
                " ON CONFLICT DO NOTHING",
                (self._ws, user_id),
            )
            conn.execute("DELETE FROM settings WHERE key = 'jira_token_enc'")


class PgSettingsRepo(_Repo):
    def get_all(self) -> dict[str, str]:
        with self._tx() as conn:
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
        return {row["key"]: row["value"] for row in rows}

    def set_many(self, values: dict[str, str | None]) -> None:
        with self._tx() as conn:
            for key, value in values.items():
                if value is None:
                    conn.execute("DELETE FROM settings WHERE key = %s", (key,))
                else:
                    conn.execute(
                        "INSERT INTO settings (workspace_id, key, value) VALUES (%s, %s, %s)"
                        " ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value",
                        (self._ws, key, value),
                    )


class PgServerSettingsRepo:
    """Settings of the server itself, outside every workspace."""

    def __init__(self, db: Database) -> None:
        self._db = db

    def get_all(self) -> dict[str, str]:
        with self._db.transaction(None) as conn:
            rows = conn.execute("SELECT key, value FROM server_settings").fetchall()
        return {row["key"]: row["value"] for row in rows}

    def set_many(self, values: dict[str, str | None]) -> None:
        with self._db.transaction(None) as conn:
            for key, value in values.items():
                if value is None:
                    conn.execute("DELETE FROM server_settings WHERE key = %s", (key,))
                else:
                    conn.execute(
                        "INSERT INTO server_settings (key, value) VALUES (%s, %s)"
                        " ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                        (key, value),
                    )


# Kept by the server, not a workspace: the usage stats id, the privacy switches, the last ping.
SERVER_KEYS = ("instance_id", "usage_stats", "error_reports", "last_ping_at")


def move_server_settings(conn: psycopg.Connection, workspace: str) -> None:
    """Moves the server's keys out of a workspace's settings, replacing what the server had."""
    conn.execute(
        "INSERT INTO server_settings (key, value) SELECT key, value FROM settings"
        " WHERE workspace_id = %s AND key = ANY(%s)"
        " ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (workspace, list(SERVER_KEYS)),
    )
    conn.execute(
        "DELETE FROM settings WHERE workspace_id = %s AND key = ANY(%s)",
        (workspace, list(SERVER_KEYS)),
    )


class PgPlanningTypeRepo(_Repo):
    def all(self) -> list[StageType]:
        with self._tx() as conn:
            rows = conn.execute(
                "SELECT id, name, hue, archived FROM planning_types ORDER BY position"
            ).fetchall()
        return [StageType(**r) for r in rows]

    def add(self, stage_type: StageType) -> None:
        with self._tx() as conn:
            conn.execute(
                "INSERT INTO planning_types (workspace_id, id, name, hue, archived, position)"
                " VALUES (%s, %s, %s, %s, %s,"
                " (SELECT COALESCE(MAX(position), 0) + 1 FROM planning_types))",
                (self._ws, stage_type.id, stage_type.name, stage_type.hue, stage_type.archived),
            )

    def update(self, stage_type: StageType) -> None:
        with self._tx() as conn:
            conn.execute(
                "UPDATE planning_types SET name = %s, hue = %s, archived = %s WHERE id = %s",
                (stage_type.name, stage_type.hue, stage_type.archived, stage_type.id),
            )


class PgPlanningFieldRepo(_Repo):
    def all(self) -> list[PlanningField]:
        with self._tx() as conn:
            rows = conn.execute(
                "SELECT id, name, standard, archived FROM planning_fields ORDER BY position"
            ).fetchall()
        return [PlanningField(**r) for r in rows]

    def add(self, field: PlanningField, limit: int) -> bool:
        with self._tx() as conn:
            _lock_workspace(conn, self._ws)
            cursor = conn.execute(
                "INSERT INTO planning_fields (workspace_id, id, name, standard, archived, position)"
                " SELECT %s, %s, %s, %s, %s,"
                " (SELECT COALESCE(MAX(position), 0) + 1 FROM planning_fields)"
                " WHERE (SELECT COUNT(*) FROM planning_fields WHERE NOT standard) < %s",
                (self._ws, field.id, field.name, field.standard, field.archived, limit),
            )
            return cursor.rowcount == 1

    def update(self, field: PlanningField) -> None:
        with self._tx() as conn:
            conn.execute(
                "UPDATE planning_fields SET name = %s, archived = %s WHERE id = %s",
                (field.name, field.archived, field.id),
            )


class PgPlanningStageRepo(_Repo):
    def for_person(self, person_id: str) -> list[IndexedStage]:
        with self._tx() as conn:
            rows = conn.execute(
                'SELECT s.board_id, b.name AS board_name, s.row_title, s.type, s.start, s."end"'
                " FROM planning_stages s JOIN boards b ON b.id = s.board_id"
                " WHERE s.person_id = %s ORDER BY s.start",
                (person_id,),
            ).fetchall()
        return [
            IndexedStage(
                board=r["board_id"],
                board_name=r["board_name"],
                row=r["row_title"],
                type=r["type"],
                start=r["start"],
                end=r["end"],
            )
            for r in rows
        ]


class PgPlanningViewRepo(_Repo):
    def all(self) -> list[SavedView]:
        with self._tx() as conn:
            rows = conn.execute(
                "SELECT id, name, filters FROM planning_views ORDER BY position"
            ).fetchall()
        return [
            SavedView(id=r["id"], name=r["name"], filters=json.loads(r["filters"])) for r in rows
        ]

    def add(self, view: SavedView, limit: int) -> bool:
        # Names compare in Python, where casefold covers every script.
        with self._tx() as conn:
            _lock_workspace(conn, self._ws)
            names = [r["name"] for r in conn.execute("SELECT name FROM planning_views")]
            if len(names) >= limit or view.name.casefold() in {n.casefold() for n in names}:
                return False
            conn.execute(
                "INSERT INTO planning_views (workspace_id, id, name, filters, position)"
                " SELECT %s, %s, %s, %s::jsonb, COALESCE(MAX(position), 0) + 1 FROM planning_views",
                (self._ws, view.id, view.name, json.dumps(view.filters)),
            )
            return True

    def remove(self, view_id: str) -> bool:
        with self._tx() as conn:
            cursor = conn.execute("DELETE FROM planning_views WHERE id = %s", (view_id,))
            return cursor.rowcount == 1


class PgPlanningPeopleRepo(_Repo):
    def all(self) -> list[PlanningPerson]:
        with self._tx() as conn:
            rows = conn.execute(
                "SELECT id, name, teams, source, archived FROM planning_people ORDER BY position"
            ).fetchall()
            offs = conn.execute(
                "SELECT id, person_id, start_day, end_day FROM planning_off"
                " ORDER BY start_day, end_day, id"
            ).fetchall()
        off: dict[str, list[TimeOff]] = {}
        for o in offs:
            off.setdefault(o["person_id"], []).append(
                TimeOff(id=o["id"], start=o["start_day"], end=o["end_day"])
            )
        return [
            PlanningPerson(
                id=r["id"],
                name=r["name"],
                teams=json.loads(r["teams"]),
                source=r["source"],
                archived=r["archived"],
                off=off.get(r["id"], []),
            )
            for r in rows
        ]

    def add(self, person: PlanningPerson) -> None:
        with self._tx() as conn:
            conn.execute(
                "INSERT INTO planning_people"
                " (workspace_id, id, name, teams, source, archived, position)"
                " VALUES (%s, %s, %s, %s::jsonb, %s, %s,"
                " (SELECT COALESCE(MAX(position), 0) + 1 FROM planning_people))",
                (
                    self._ws,
                    person.id,
                    person.name,
                    json.dumps(person.teams, ensure_ascii=False),
                    person.source,
                    person.archived,
                ),
            )

    def update(self, person: PlanningPerson) -> None:
        with self._tx() as conn:
            conn.execute(
                "UPDATE planning_people SET name = %s, teams = %s::jsonb, archived = %s"
                " WHERE id = %s",
                (
                    person.name,
                    json.dumps(person.teams, ensure_ascii=False),
                    person.archived,
                    person.id,
                ),
            )

    def add_off(self, person_id: str, off: TimeOff, limit: int) -> bool:
        with self._tx() as conn:
            _lock_key(conn, "off", person_id)
            cursor = conn.execute(
                "INSERT INTO planning_off (workspace_id, id, person_id, start_day, end_day)"
                " SELECT %s, %s, %s, %s, %s"
                " WHERE (SELECT COUNT(*) FROM planning_off WHERE person_id = %s) < %s",
                (self._ws, off.id, person_id, off.start, off.end, person_id, limit),
            )
            return cursor.rowcount == 1

    def remove_off(self, person_id: str, off_id: str) -> None:
        with self._tx() as conn:
            conn.execute(
                "DELETE FROM planning_off WHERE id = %s AND person_id = %s", (off_id, person_id)
            )


class PgUsageCounts:
    """Counts of the whole server, for usage stats and metrics."""

    def __init__(self, db: Database, workspace: str | None = None) -> None:
        self._db = db

    def people(self) -> int:
        with self._db.jobs() as conn:
            return conn.execute(
                "SELECT COUNT(*) AS n FROM users"
                " WHERE demo_expires_at IS NULL AND disabled_at IS NULL"
            ).fetchone()["n"]

    def boards(self) -> int:
        with self._db.jobs() as conn:
            return conn.execute("SELECT COUNT(*) AS n FROM boards").fetchone()["n"]

    def boards_active(self, since: str) -> int:
        with self._db.jobs() as conn:
            return conn.execute(
                "SELECT COUNT(*) AS n FROM boards WHERE updated_at >= %s"
                " AND (version > 1 OR updated_at > created_at)",
                (since,),
            ).fetchone()["n"]

    def sources(self) -> set[str]:
        with self._db.jobs() as conn:
            rows = conn.execute("SELECT DISTINCT source FROM task_snapshots").fetchall()
        return {row["source"] for row in rows}


# The role is the person's in the request's workspace; %s there is the workspace id.
_PERSON = "u.id, u.username, u.name, m.role, u.disabled_at, u.server_admin, u.demo_expires_at"
_PERSON_FROM = "users u LEFT JOIN memberships m ON m.user_id = u.id AND m.workspace_id = %s"
# Only the workspace's members: an account elsewhere is not found here, so no admin reaches it.
_MEMBER_FROM = "users u JOIN memberships m ON m.user_id = u.id AND m.workspace_id = %s"
# A demo visitor who changed nothing: at most the welcome board, as it was made, and no task
# status of their own. A rename leaves the version alone, so the time of the last change counts.
_UNTOUCHED = (
    "NOT EXISTS (SELECT 1 FROM board_members m JOIN boards b ON b.id = m.board_id"
    " WHERE m.user_id = users.id AND m.role = 'owner'"
    " AND (b.version > 1 OR b.updated_at > b.created_at))"
    " AND (SELECT COUNT(*) FROM board_members m"
    " WHERE m.user_id = users.id AND m.role = 'owner') <= 1"
    " AND NOT EXISTS (SELECT 1 FROM demo_statuses s WHERE s.user_id = users.id)"
)


def _person(row: dict) -> Person:
    return Person(
        id=row["id"],
        username=row["username"],
        name=row["name"],
        role=row["role"] or "member",
        disabled=row["disabled_at"] is not None,
        server_admin=row["server_admin"],
        demo_expires_at=row["demo_expires_at"],
    )


def _account(row: dict) -> Account:
    return Account(
        id=row["id"],
        username=row["username"],
        name=row["name"],
        server_admin=row["server_admin"],
        disabled=row["disabled_at"] is not None,
        in_workspace=row["in_workspace"],
        last_sign_in_at=row["last_sign_in_at"],
        created_at=row["created_at"],
    )


_ACCOUNT = (
    "id, username, name, server_admin, disabled_at, last_sign_in_at, created_at,"
    " EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id) AS in_workspace"
)


_Gone = tuple[list[str], list[str]]


def _delete_people(conn: psycopg.Connection, user_ids: list[str]) -> list[str]:
    """Deletes people with everything of theirs; returns the ids of the boards that went."""
    if not user_ids:
        return []
    rows = conn.execute(
        "DELETE FROM boards WHERE id IN (SELECT board_id FROM board_members"
        " WHERE user_id = ANY(%s) AND role = 'owner') RETURNING id",
        (user_ids,),
    ).fetchall()
    # The rest of theirs goes by cascade from users.
    conn.execute("DELETE FROM users WHERE id = ANY(%s)", (user_ids,))
    return [row["id"] for row in rows]


class PgUserRepo(_Repo):
    def __init__(self, db: Database, workspace: str | None = None) -> None:
        super().__init__(db, workspace)
        # Where the last search for an idle demo visitor ended; see evict_untouched_demo.
        self._changed_until: str | None = None

    def count(self) -> int:
        with self._tx() as conn:
            return conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]

    def add(self, person: Person, password_hash: str) -> None:
        try:
            with self._tx() as conn:
                conn.execute(
                    "INSERT INTO users (id, username, name, password_hash, created_at,"
                    " demo_expires_at, server_admin) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (
                        person.id,
                        person.username,
                        person.name,
                        password_hash,
                        now_iso(),
                        person.demo_expires_at,
                        person.server_admin,
                    ),
                )
                conn.execute(
                    "INSERT INTO memberships (workspace_id, user_id, role) VALUES (%s, %s, %s)",
                    (self._ws, person.id, person.role),
                )
        except UniqueViolation as error:
            raise UsernameTaken("This username is taken.") from error

    def find(self, username: str) -> tuple[Person, str] | None:
        with self._tx() as conn:
            row = conn.execute(
                f"SELECT {_PERSON}, u.password_hash FROM {_PERSON_FROM}"
                " WHERE lower(u.username) = lower(%s)",
                (self._ws, username),
            ).fetchone()
        return (_person(row), row["password_hash"]) if row else None

    def update(self, person: Person) -> None:
        try:
            with self._tx() as conn:
                conn.execute(
                    "UPDATE users SET name = %s, username = %s WHERE id = %s",
                    (person.name, person.username, person.id),
                )
        except UniqueViolation as error:
            raise UsernameTaken("This username is taken.") from error

    def set_password(self, user_id: str, password_hash: str) -> None:
        with self._tx() as conn:
            conn.execute(
                "UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user_id)
            )

    def onboarding(self, user_id: str) -> Onboarding:
        with self._tx() as conn:
            row = conn.execute(
                "SELECT state FROM onboarding WHERE user_id = %s", (user_id,)
            ).fetchone()
        return Onboarding.model_validate_json(row["state"]) if row else Onboarding()

    def set_onboarding(self, user_id: str, state: Onboarding) -> None:
        with self._tx() as conn:
            conn.execute(
                "INSERT INTO onboarding (workspace_id, user_id, state) VALUES (%s, %s, %s::jsonb)"
                " ON CONFLICT (workspace_id, user_id) DO UPDATE SET state = excluded.state",
                (self._ws, user_id, state.model_dump_json()),
            )

    def get(self, user_id: str) -> Person | None:
        with self._tx() as conn:
            row = conn.execute(
                f"SELECT {_PERSON} FROM {_MEMBER_FROM} WHERE u.id = %s", (self._ws, user_id)
            ).fetchone()
        return _person(row) if row else None

    def list(self) -> list[PersonRecord]:
        with self._tx() as conn:
            rows = conn.execute(
                f"SELECT {_PERSON}, u.last_sign_in_at, u.created_at FROM {_MEMBER_FROM}"
                " WHERE u.demo_expires_at IS NULL ORDER BY lower(u.name), lower(u.username)",
                (self._ws,),
            ).fetchall()
        return [
            PersonRecord(
                **_person(row).model_dump(),
                last_sign_in_at=row["last_sign_in_at"],
                created_at=row["created_at"],
            )
            for row in rows
        ]

    def set_role(self, user_id: str, role: Role) -> bool:
        with self._tx() as conn:
            _lock_workspace(conn, self._ws)
            if role == "member" and _sole_admin(conn, self._ws, user_id):
                return False
            conn.execute(
                # A role changes inside the workspace; joining one is an invite's job.
                "UPDATE memberships SET role = %s WHERE workspace_id = %s AND user_id = %s",
                (role, self._ws, user_id),
            )
        return True

    def set_disabled(self, user_id: str, disabled: bool) -> Literal["server", "workspace"] | None:
        with self._tx() as conn:
            if disabled:
                # Two admins disabled at once must not both see the other still active.
                _lock_key(conn, "server admins")
                rows = conn.execute(
                    "SELECT workspace_id FROM memberships WHERE user_id = %s ORDER BY 1",
                    (user_id,),
                ).fetchall()
                for row in rows:
                    _lock_workspace(conn, row["workspace_id"])
                if conn.execute(
                    "SELECT u.server_admin AND u.disabled_at IS NULL AND (SELECT COUNT(*)"
                    " FROM users o WHERE o.server_admin AND o.disabled_at IS NULL) <= 1 AS last"
                    " FROM users u WHERE u.id = %s",
                    (user_id,),
                ).fetchone()["last"]:
                    return "server"
                if any(_sole_admin(conn, row["workspace_id"], user_id) for row in rows):
                    return "workspace"
            conn.execute(
                "UPDATE users SET disabled_at = %s WHERE id = %s",
                (now_iso() if disabled else None, user_id),
            )
        return None

    def join(self, user_id: str, workspace: str, role: Role) -> bool:
        with self._db.transaction(workspace) as conn:
            _lock_key(conn, "join", user_id)
            if conn.execute("SELECT 1 FROM memberships WHERE user_id = %s", (user_id,)).fetchone():
                return False
            conn.execute(
                "INSERT INTO memberships (workspace_id, user_id, role) VALUES (%s, %s, %s)",
                (workspace, user_id, role),
            )
        return True

    def remove_member(self, user_id: str, by_id: str) -> "list[str] | None":
        ws = self._ws
        with self._tx() as conn:
            _lock_workspace(conn, ws)
            if not conn.execute(
                "SELECT 1 FROM memberships WHERE workspace_id = %s AND user_id = %s",
                (ws, user_id),
            ).fetchone():
                raise NotFound("person not found")
            if _sole_admin(conn, ws, user_id):
                return None
            boards = conn.execute(
                "SELECT board_id, role FROM board_members WHERE user_id = %s", (user_id,)
            ).fetchall()
            # The other members of a board stay; the admin who removed its owner takes it.
            conn.cursor().executemany(
                "INSERT INTO board_members (workspace_id, board_id, user_id, role)"
                " VALUES (%s, %s, %s, 'owner')"
                " ON CONFLICT (board_id, user_id) DO UPDATE SET role = 'owner'",
                [(ws, row["board_id"], by_id) for row in boards if row["role"] == "owner"],
            )
            for table in ("board_members", "user_credentials", "task_snapshots"):
                conn.execute(f"DELETE FROM {table} WHERE user_id = %s", (user_id,))
            conn.execute(
                "DELETE FROM memberships WHERE workspace_id = %s AND user_id = %s", (ws, user_id)
            )
        return [row["board_id"] for row in boards]

    def accounts(self) -> "list[Account]":
        with self._tx() as conn:
            rows = conn.execute(
                f"SELECT {_ACCOUNT} FROM users WHERE demo_expires_at IS NULL"
                " ORDER BY lower(name), lower(username)"
            ).fetchall()
        return [_account(row) for row in rows]

    def account(self, user_id: str) -> Account | None:
        with self._tx() as conn:
            row = conn.execute(
                f"SELECT {_ACCOUNT} FROM users WHERE id = %s AND demo_expires_at IS NULL",
                (user_id,),
            ).fetchone()
        return _account(row) if row else None

    def touch_sign_in(self, user_id: str) -> None:
        with self._tx() as conn:
            conn.execute(
                "UPDATE users SET last_sign_in_at = %s WHERE id = %s", (now_iso(), user_id)
            )

    def touch_demo(self, user_id: str, until: str) -> bool:
        with self._tx() as conn:
            cursor = conn.execute(
                "UPDATE users SET demo_expires_at = %s"
                " WHERE id = %s AND demo_expires_at IS NOT NULL",
                (until, user_id),
            )
        return cursor.rowcount == 1

    def sign_up_demo(self, user_id: str, username: str, name: str, password_hash: str) -> bool:
        try:
            with self._tx() as conn:
                # Only a row that still has an expiry: the cleanup or a second sign-up got there
                # first otherwise.
                cursor = conn.execute(
                    "UPDATE users SET username = %s, name = %s, password_hash = %s,"
                    " demo_expires_at = NULL, last_sign_in_at = %s"
                    " WHERE id = %s AND demo_expires_at IS NOT NULL",
                    (username, name, password_hash, now_iso(), user_id),
                )
        except UniqueViolation as error:
            raise UsernameTaken("This username is taken.") from error
        return cursor.rowcount == 1

    def delete_unused_members(self, before: str) -> _Gone:
        with self._tx() as conn:
            rows = conn.execute(
                # Members of this workspace only, and only those in no other one.
                "SELECT u.id FROM users u JOIN memberships m"
                " ON m.user_id = u.id AND m.workspace_id = %s"
                " WHERE u.demo_expires_at IS NULL AND m.role <> 'admin'"
                " AND NOT EXISTS (SELECT 1 FROM memberships o"
                " WHERE o.user_id = u.id AND o.workspace_id <> m.workspace_id)"
                " AND COALESCE(u.last_sign_in_at, u.created_at) <= %s",
                (self._ws, before),
            ).fetchall()
            user_ids = [row["id"] for row in rows]
            return user_ids, _delete_people(conn, user_ids)

    def demo_alive(self, now: str) -> int:
        with self._tx() as conn:
            return conn.execute(
                "SELECT COUNT(*) AS n FROM users WHERE demo_expires_at > %s", (now,)
            ).fetchone()["n"]

    def delete_expired_demo(self, now: str, untouched: str) -> _Gone:
        with self._tx() as conn:
            rows = conn.execute(
                "SELECT id FROM users WHERE demo_expires_at <= %s"
                f" OR (demo_expires_at <= %s AND {_UNTOUCHED})",
                (now, untouched),
            ).fetchall()
            user_ids = [row["id"] for row in rows]
            return user_ids, _delete_people(conn, user_ids)

    def evict_untouched_demo(self) -> _Gone:
        with self._tx() as conn:
            # The search starts where the last one ended: everyone before that had changed
            # something then, and walking past all of them every time grows with the demo.
            # Only a hint: before the demo is called full, the search is made from the start.
            row = None
            for since in dict.fromkeys((self._changed_until, None)):
                row = conn.execute(
                    "SELECT id, demo_expires_at FROM users WHERE demo_expires_at IS NOT NULL"
                    f" AND (%s::timestamptz IS NULL OR demo_expires_at >= %s) AND {_UNTOUCHED}"
                    " ORDER BY demo_expires_at LIMIT 1",
                    (since, since),
                ).fetchone()
                if row:
                    break
            self._changed_until = row["demo_expires_at"] if row else None
            user_ids = [row["id"]] if row else []
            return user_ids, _delete_people(conn, user_ids)


class PgDemoStatusRepo(_Repo):
    def get(self, user_id: str) -> dict[str, tuple[str, str]]:
        with self._tx() as conn:
            rows = conn.execute(
                "SELECT key, status, updated_at FROM demo_statuses WHERE user_id = %s", (user_id,)
            ).fetchall()
        return {row["key"]: (row["status"], row["updated_at"]) for row in rows}

    def set(self, user_id: str, key: str, status: str, updated_at: str) -> None:
        with self._tx() as conn:
            conn.execute(
                "INSERT INTO demo_statuses (workspace_id, user_id, key, status, updated_at)"
                " VALUES (%s, %s, %s, %s, %s) ON CONFLICT (workspace_id, user_id, key)"
                " DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at",
                (self._ws, user_id, key, status, updated_at),
            )


class PgAttempts(_Repo):
    def recent(self, scope: str, key: str, since: float) -> tuple[int, float]:
        with self._tx() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n, MIN(at) AS oldest FROM attempts"
                " WHERE scope = %s AND key = %s AND at > %s",
                (scope, key, since),
            ).fetchone()
        return row["n"], row["oldest"] or 0.0

    def add(self, scope: str, key: str, at: float, since: float) -> None:
        with self._tx() as conn:
            conn.execute("DELETE FROM attempts WHERE scope = %s AND at <= %s", (scope, since))
            conn.execute(
                "INSERT INTO attempts (scope, key, at) VALUES (%s, %s, %s)", (scope, key, at)
            )

    def add_under(self, scope: str, key: str, limit: int, at: float, since: float) -> float | None:
        with self._tx() as conn:
            _lock_key(conn, "attempts", scope, key)
            conn.execute("DELETE FROM attempts WHERE scope = %s AND at <= %s", (scope, since))
            row = conn.execute(
                "SELECT COUNT(*) AS n, MIN(at) AS oldest FROM attempts"
                " WHERE scope = %s AND key = %s",
                (scope, key),
            ).fetchone()
            if row["n"] >= limit:
                return row["oldest"]
            conn.execute(
                "INSERT INTO attempts (scope, key, at) VALUES (%s, %s, %s)", (scope, key, at)
            )
        return None

    def spend(self, scope: str, key: str, limit: int, window_s: float, at: float) -> float | None:
        with self._tx() as conn:
            _lock_key(conn, "windows", scope, key)
            row = conn.execute(
                "SELECT opened, used FROM attempt_windows WHERE scope = %s AND key = %s",
                (scope, key),
            ).fetchone()
            opened, used = (row["opened"], row["used"]) if row else (at, 0)
            if not row or at - opened >= window_s:
                # A window opens: the moment to drop the scope's spent ones, or keys that
                # went quiet would stay here for good.
                conn.execute(
                    "DELETE FROM attempt_windows WHERE scope = %s AND opened <= %s",
                    (scope, at - window_s),
                )
                opened, used = at, 0
            if used >= limit:
                return opened
            conn.execute(
                "INSERT INTO attempt_windows (scope, key, opened, used) VALUES (%s, %s, %s, %s)"
                " ON CONFLICT (scope, key) DO UPDATE SET opened = excluded.opened,"
                " used = excluded.used",
                (scope, key, opened, used + 1),
            )
        return None

    def drop(self, scope: str, key: str) -> None:
        with self._tx() as conn:
            conn.execute("DELETE FROM attempt_windows WHERE scope = %s AND key = %s", (scope, key))


class PgKnownBrowsers(_Repo):
    def add(self, token_hash: str, user_id: str, at: float, since: float) -> None:
        with self._tx() as conn:
            conn.execute("DELETE FROM known_browsers WHERE created_at <= %s", (since,))
            conn.execute(
                "INSERT INTO known_browsers (token_hash, user_id, created_at)"
                " VALUES (%s, %s, %s) ON CONFLICT (token_hash) DO UPDATE"
                " SET user_id = excluded.user_id, created_at = excluded.created_at",
                (token_hash, user_id, at),
            )
            conn.execute(
                "DELETE FROM known_browsers WHERE user_id = %s AND token_hash NOT IN"
                " (SELECT token_hash FROM known_browsers WHERE user_id = %s"
                " ORDER BY created_at DESC LIMIT %s)",
                (user_id, user_id, BROWSERS_PER_PERSON),
            )

    def owner(self, token_hash: str, since: float) -> str | None:
        with self._tx() as conn:
            row = conn.execute(
                "SELECT user_id FROM known_browsers WHERE token_hash = %s AND created_at > %s",
                (token_hash, since),
            ).fetchone()
        return row["user_id"] if row else None

    def forget(self, user_id: str) -> None:
        with self._tx() as conn:
            conn.execute("DELETE FROM known_browsers WHERE user_id = %s", (user_id,))


class PgSessionRepo(_Repo):
    def add(self, token_hash: str, user_id: str, expires_at: str, created_at: str) -> None:
        with self._tx() as conn:
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, expires_at, created_at)"
                " VALUES (%s, %s, %s, %s)",
                (token_hash, user_id, expires_at, created_at),
            )

    def get(self, token_hash: str) -> tuple[Person, str] | None:
        with self._tx() as conn:
            row = conn.execute(
                f"SELECT {_PERSON}, s.expires_at FROM sessions s"
                f" JOIN {_PERSON_FROM} ON u.id = s.user_id WHERE s.token_hash = %s",
                (self._ws, token_hash),
            ).fetchone()
        return (_person(row), row["expires_at"]) if row else None

    def delete(self, token_hash: str) -> None:
        with self._tx() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = %s", (token_hash,))

    def delete_for_user(self, user_id: str, keep: str | None) -> None:
        with self._tx() as conn:
            conn.execute(
                "DELETE FROM sessions WHERE user_id = %s AND token_hash IS DISTINCT FROM %s",
                (user_id, keep),
            )

    def delete_expired(self, now: str) -> None:
        with self._tx() as conn:
            conn.execute("DELETE FROM sessions WHERE expires_at <= %s", (now,))


# Invites join a workspace, password resets belong to the server; the domain sees one list.
_LINKS = (
    "(SELECT id, 'invite' AS kind, role, NULL::text AS user_id, workspace_id, token_hash,"
    " expires_at, used_at, revoked_at, created_at FROM invites"
    " UNION ALL SELECT id, 'reset', NULL, user_id, NULL, token_hash, expires_at, used_at,"
    " revoked_at, created_at FROM password_resets) i"
)
_INVITE = (
    "SELECT i.id, i.kind, i.role, i.user_id, u.username, i.workspace_id AS workspace,"
    f" i.expires_at, i.created_at FROM {_LINKS} LEFT JOIN users u ON u.id = i.user_id"
)
_OPEN = "used_at IS NULL AND revoked_at IS NULL AND expires_at > %s"


class PgInviteRepo(_Repo):
    def add(self, invite: Invite, token_hash: str, created_by: str) -> None:
        with self._tx() as conn:
            if invite.kind == "reset":
                conn.execute(
                    "INSERT INTO password_resets (id, token_hash, user_id, created_by,"
                    " expires_at, created_at) VALUES (%s, %s, %s, %s, %s, %s)",
                    (
                        invite.id,
                        token_hash,
                        invite.user_id,
                        created_by,
                        invite.expires_at,
                        invite.created_at,
                    ),
                )
                return
            conn.execute(
                "INSERT INTO invites (id, workspace_id, token_hash, role, created_by,"
                " expires_at, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (
                    invite.id,
                    self._ws,
                    token_hash,
                    invite.role,
                    created_by,
                    invite.expires_at,
                    invite.created_at,
                ),
            )

    def find_open(self, token_hash: str, now: str) -> Invite | None:
        with self._tx() as conn:
            row = conn.execute(
                f"{_INVITE} WHERE i.token_hash = %s AND i.{_OPEN}", (token_hash, now)
            ).fetchone()
        return Invite(**row) if row else None

    def _mark(
        self, column: str, value: str | None, invite_id: str, now: str | None, own: bool = False
    ) -> bool:
        """`own`: only an invite of this workspace; a link is used from outside it."""
        where = f" AND {_OPEN}" if now else ""
        count = 0
        with self._tx() as conn:
            for table, scope in (("invites", " AND workspace_id = %s"), ("password_resets", "")):
                scope = scope if own else ""
                ws = (self._ws,) if scope else ()
                params = (value, invite_id, *ws, *((now,) if now else ()))
                count += conn.execute(
                    f"UPDATE {table} SET {column} = %s WHERE id = %s{scope}{where}", params
                ).rowcount
        return count == 1

    def consume(self, invite_id: str, now: str) -> bool:
        return self._mark("used_at", now, invite_id, now)

    def unconsume(self, invite_id: str) -> None:
        self._mark("used_at", None, invite_id, None)

    def pending(self, now: str) -> list[Invite]:
        with self._tx() as conn:
            rows = conn.execute(
                f"{_INVITE} WHERE (i.workspace_id = %s OR i.workspace_id IS NULL) AND i.{_OPEN}"
                " ORDER BY i.created_at",
                (self._ws, now),
            ).fetchall()
        return [Invite(**row) for row in rows]

    def revoke(self, invite_id: str, now: str) -> bool:
        return self._mark("revoked_at", now, invite_id, now, own=True)


class PgMemberRepo(_Repo):
    def roles(
        self, board_id: str, user_id: str
    ) -> tuple[BoardRole | None, ShareRole | None] | None:
        with self._tx() as conn:
            row = conn.execute(
                "SELECT m.role, b.everyone_role FROM boards b"
                " LEFT JOIN board_members m ON m.board_id = b.id AND m.user_id = %s"
                " WHERE b.id = %s",
                (user_id, board_id),
            ).fetchone()
        return (row["role"], row["everyone_role"]) if row else None

    def role(self, board_id: str, user_id: str) -> BoardRole | None:
        with self._tx() as conn:
            row = conn.execute(
                "SELECT role FROM board_members WHERE board_id = %s AND user_id = %s",
                (board_id, user_id),
            ).fetchone()
        return row["role"] if row else None

    def members(self, board_id: str) -> list[Member]:
        with self._tx() as conn:
            rows = conn.execute(
                "SELECT u.id, u.username, u.name, m.role FROM board_members m"
                " JOIN users u ON u.id = m.user_id WHERE m.board_id = %s"
                " ORDER BY m.role = 'owner' DESC, lower(u.name)",
                (board_id,),
            ).fetchall()
        return [
            Member(
                user=MemberUser(id=row["id"], username=row["username"], name=row["name"]),
                role=row["role"],
            )
            for row in rows
        ]

    def everyone(self, board_id: str) -> ShareRole | None:
        with self._tx() as conn:
            row = conn.execute(
                "SELECT everyone_role FROM boards WHERE id = %s", (board_id,)
            ).fetchone()
        return row["everyone_role"] if row else None

    def set_role(self, board_id: str, user_id: str, role: BoardRole) -> None:
        with self._tx() as conn:
            conn.execute(
                "INSERT INTO board_members (workspace_id, board_id, user_id, role)"
                " VALUES (%s, %s, %s, %s)"
                " ON CONFLICT (board_id, user_id) DO UPDATE SET role = excluded.role",
                (self._ws, board_id, user_id, role),
            )

    def remove(self, board_id: str, user_id: str) -> None:
        with self._tx() as conn:
            conn.execute(
                "DELETE FROM board_members WHERE board_id = %s AND user_id = %s",
                (board_id, user_id),
            )

    def set_everyone(self, board_id: str, role: ShareRole | None) -> None:
        with self._tx() as conn:
            conn.execute("UPDATE boards SET everyone_role = %s WHERE id = %s", (role, board_id))

    def transfer(self, board_id: str, user_id: str) -> None:
        with self._tx() as conn:
            conn.execute(
                "UPDATE board_members SET role = 'editor' WHERE board_id = %s AND role = 'owner'",
                (board_id,),
            )
            conn.execute(
                "INSERT INTO board_members (workspace_id, board_id, user_id, role)"
                " VALUES (%s, %s, %s, 'owner')"
                " ON CONFLICT (board_id, user_id) DO UPDATE SET role = 'owner'",
                (self._ws, board_id, user_id),
            )

    def adopt_orphans(self, owner_id: str) -> None:
        with self._tx() as conn:
            conn.execute(
                "INSERT INTO board_members (workspace_id, board_id, user_id, role)"
                " SELECT b.workspace_id, b.id, %s, 'owner' FROM boards b WHERE NOT EXISTS"
                " (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.role = 'owner')",
                (owner_id,),
            )
            # An install that already had its welcome board does not get a second one.
            conn.execute(
                "UPDATE users SET welcomed_at = created_at WHERE id = %s AND welcomed_at IS NULL"
                " AND EXISTS (SELECT 1 FROM settings WHERE key = 'welcome_seeded')",
                (owner_id,),
            )


# The names main.py builds the app from, the same in both adapters until SQLite goes.
BoardRepo = PgBoardRepo
SnapshotRepo = PgSnapshotRepo
CredentialRepo = PgCredentialRepo
SettingsRepo = PgSettingsRepo
ServerSettingsRepo = PgServerSettingsRepo
PlanningTypeRepo = PgPlanningTypeRepo
PlanningFieldRepo = PgPlanningFieldRepo
PlanningStageRepo = PgPlanningStageRepo
PlanningViewRepo = PgPlanningViewRepo
PlanningPeopleRepo = PgPlanningPeopleRepo
UsageCounts = PgUsageCounts
UserRepo = PgUserRepo
DemoStatusRepo = PgDemoStatusRepo
Attempts = PgAttempts
KnownBrowsers = PgKnownBrowsers
SessionRepo = PgSessionRepo
InviteRepo = PgInviteRepo
MemberRepo = PgMemberRepo
Workspaces = PgWorkspaces
