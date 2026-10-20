"""The one-time copy of an SQLite `data/app.db` into the default workspace on Postgres."""

import json
import logging
import sqlite3
from collections.abc import Callable
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import psycopg

from app.adapters.storage.postgres import Database
from app.domain.boards import CARD, LEGACY_CARD
from app.domain.live import LiveDoc
from app.domain.tasks import now_iso

log = logging.getLogger(__name__)


def _rename_cards(conn: sqlite3.Connection) -> None:
    """The node type `jira_card` becomes `task_card` in every stored board and its CRDT state."""
    rows = conn.execute(
        "SELECT id, doc, ydoc FROM boards WHERE doc LIKE ? OR ydoc IS NOT NULL",
        (f'%"{LEGACY_CARD}"%',),
    ).fetchall()
    for row in rows:
        doc = json.loads(row["doc"])
        for node in doc.get("nodes", []):
            if node.get("type") == LEGACY_CARD:
                node["type"] = CARD
        state = row["ydoc"]
        if state is not None:
            try:
                live = LiveDoc(state)
                if live.rename_type(LEGACY_CARD, CARD):
                    state = live.state()
            except Exception:
                # A room without a state builds it from the JSON, which is the saved board.
                log.exception("board %s: live state unreadable, rebuilt on next open", row["id"])
                state = None
        conn.execute(
            "UPDATE boards SET doc = ?, ydoc = ? WHERE id = ?",
            (json.dumps(doc, separators=(",", ":"), ensure_ascii=False), state, row["id"]),
        )


# The schema steps of the SQLite releases, kept to bring a file of any of them up to the last
# before it is copied. 001_init.sql gives user_version 1; a step SQL cannot express is a function.
Step = Path | Callable[[sqlite3.Connection], None]
MIGRATIONS: list[tuple[int, Step]] = sorted(
    [
        *(
            (int(path.name.split("_", 1)[0]), path)
            for path in (Path(__file__).parent / "sqlite_migrations").glob("*.sql")
        ),
        (12, _rename_cards),
    ],
    key=lambda step: step[0],
)

MARK = "copied_from_sqlite"
# Not the migration lock: processes waiting here have migrated already.
_LOCK = 0x7469_6B6F_0001
BATCH = 500


@dataclass(frozen=True)
class _Table:
    target: str
    columns: tuple[str, ...]
    # Reads the rows in the order of `columns`; :ws is the default workspace.
    select: str
    # The SQLite table the rows come from; rows the select leaves out are logged as skipped.
    source: str
    json: frozenset[str] = frozenset()
    flags: frozenset[str] = frozenset()

    @property
    def scoped(self) -> bool:
        return "workspace_id" in self.columns


def _has(column: str = "user_id", parent: str = "users") -> str:
    # SQLite never enforced foreign keys here, so a row may point at something long deleted.
    return f"{column} IN (SELECT id FROM {parent})"


_FIRST_ADMIN = (
    # The oldest admin who can sign in, as adopt_orphans picks the owner of old boards.
    "(SELECT id FROM users WHERE role = 'admin' AND demo_expires_at IS NULL"
    " AND disabled_at IS NULL ORDER BY created_at, id LIMIT 1)"
)
_STAMPS = ("expires_at", "used_at", "revoked_at", "created_at")

# Parents before children, so every reference finds its row.
TABLES = (
    _Table(
        "users",
        (
            "id",
            "username",
            "name",
            "password_hash",
            "server_admin",
            "disabled_at",
            "last_sign_in_at",
            "welcomed_at",
            "demo_expires_at",
            "created_at",
        ),
        f"SELECT id, username, name, password_hash, id = {_FIRST_ADMIN}, disabled_at,"
        " last_sign_in_at, welcomed_at, demo_expires_at, created_at FROM users",
        "users",
        flags=frozenset({"server_admin"}),
    ),
    _Table(
        "memberships",
        ("workspace_id", "user_id", "role"),
        "SELECT :ws, id, CASE role WHEN 'admin' THEN 'admin' ELSE 'member' END FROM users",
        "users",
    ),
    _Table(
        "sessions",
        ("token_hash", "user_id", "expires_at", "created_at"),
        f"SELECT token_hash, user_id, expires_at, created_at FROM sessions WHERE {_has()}",
        "sessions",
    ),
    _Table(
        "invites",
        ("id", "workspace_id", "token_hash", "role", "created_by", *_STAMPS),
        "SELECT id, :ws, token_hash, CASE role WHEN 'admin' THEN 'admin' ELSE 'member' END,"
        f" CASE WHEN {_has('created_by')} THEN created_by END,"
        f" {', '.join(_STAMPS)} FROM invites WHERE kind = 'invite'",
        "invites WHERE kind = 'invite'",
    ),
    _Table(
        "password_resets",
        ("id", "token_hash", "user_id", "created_by", *_STAMPS),
        "SELECT id, token_hash, user_id,"
        f" CASE WHEN {_has('created_by')} THEN created_by END,"
        f" {', '.join(_STAMPS)} FROM invites WHERE kind = 'reset' AND {_has()}",
        "invites WHERE kind = 'reset'",
    ),
    _Table("attempts", ("scope", "key", "at"), "SELECT scope, key, at FROM attempts", "attempts"),
    _Table(
        "attempt_windows",
        ("scope", "key", "opened", "used"),
        "SELECT scope, key, opened, used FROM attempt_windows",
        "attempt_windows",
    ),
    _Table(
        "known_browsers",
        ("token_hash", "user_id", "created_at"),
        f"SELECT token_hash, user_id, created_at FROM known_browsers WHERE {_has()}",
        "known_browsers",
    ),
    _Table(
        "boards",
        (
            "workspace_id",
            "id",
            "name",
            "doc",
            "ydoc",
            "version",
            "everyone_role",
            "created_at",
            "updated_at",
        ),
        "SELECT :ws, id, name, doc, ydoc, version, everyone_role, created_at, updated_at"
        " FROM boards",
        "boards",
        json=frozenset({"doc"}),
    ),
    _Table(
        "board_index",
        ("board_id", "workspace_id", "public_token"),
        "SELECT id, :ws, public_token FROM boards",
        "boards",
    ),
    _Table(
        "board_members",
        ("workspace_id", "board_id", "user_id", "role"),
        "SELECT :ws, board_id, user_id, role FROM board_members"
        f" WHERE {_has()} AND {_has('board_id', 'boards')}",
        "board_members",
    ),
    _Table(
        "settings",
        ("workspace_id", "key", "value"),
        "SELECT :ws, key, value FROM settings",
        "settings",
    ),
    _Table(
        "user_credentials",
        ("workspace_id", "user_id", "provider", "token_enc", "base_url"),
        f"SELECT :ws, user_id, provider, token_enc, base_url FROM user_credentials WHERE {_has()}",
        "user_credentials",
    ),
    _Table(
        "task_snapshots",
        ("workspace_id", "user_id", "source", "key", "state", "data", "fetched_at"),
        "SELECT :ws, user_id, source, key, state, data, fetched_at FROM task_snapshots_v3"
        f" WHERE {_has()}",
        "task_snapshots_v3",
        json=frozenset({"data"}),
    ),
    _Table(
        "demo_statuses",
        ("workspace_id", "user_id", "key", "status", "updated_at"),
        f"SELECT :ws, user_id, key, status, updated_at FROM demo_statuses WHERE {_has()}",
        "demo_statuses",
    ),
    _Table(
        "onboarding",
        ("workspace_id", "user_id", "state"),
        f"SELECT :ws, user_id, state FROM onboarding WHERE {_has()}",
        "onboarding",
        json=frozenset({"state"}),
    ),
    _Table(
        "planning_types",
        ("workspace_id", "id", "name", "hue", "archived", "position"),
        "SELECT :ws, id, name, hue, archived, position FROM planning_types",
        "planning_types",
        flags=frozenset({"archived"}),
    ),
    _Table(
        "planning_fields",
        ("workspace_id", "id", "name", "standard", "archived", "position"),
        "SELECT :ws, id, name, standard, archived, position FROM planning_fields",
        "planning_fields",
        flags=frozenset({"standard", "archived"}),
    ),
    _Table(
        "planning_views",
        ("workspace_id", "id", "name", "filters", "position"),
        "SELECT :ws, id, name, filters, position FROM planning_views",
        "planning_views",
        json=frozenset({"filters"}),
    ),
    _Table(
        "planning_people",
        ("workspace_id", "id", "name", "teams", "source", "archived", "position"),
        "SELECT :ws, id, name, teams, source, archived, position FROM planning_people",
        "planning_people",
        json=frozenset({"teams"}),
        flags=frozenset({"archived"}),
    ),
    _Table(
        "planning_off",
        ("workspace_id", "id", "person_id", "start_day", "end_day"),
        "SELECT :ws, id, person_id, start_day, end_day FROM planning_off"
        f" WHERE {_has('person_id', 'planning_people')}",
        "planning_off",
    ),
    _Table(
        "planning_stages",
        ("workspace_id", "board_id", "person_id", "row_title", "type", "start", '"end"'),
        'SELECT :ws, board_id, person_id, row_title, type, start, "end" FROM planning_stages'
        f" WHERE {_has('board_id', 'boards')}",
        "planning_stages",
    ),
)
# What a new workspace is seeded with; the copy brings the instance's own.
_SEEDED = ("settings", "planning_fields")


class CopyFailed(RuntimeError):
    pass


def copy_once(db: Database, db_path: str) -> bool:
    """Copies `db_path` into the default workspace if Postgres has not taken it yet.

    Every process of the API may call it: one copies, the others wait and find it done.
    """
    source = Path(db_path)
    if not source.is_file():
        return False
    with db.jobs() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK,))
        mark = conn.execute("SELECT value FROM server_settings WHERE key = %s", (MARK,)).fetchone()
        if mark:
            # Renamed back by hand to run an SQLite release again; its later changes stay there.
            log.warning("%s is not read: Postgres took a copy of it on %s", source, mark["value"])
            return False
        if conn.execute("SELECT EXISTS (SELECT 1 FROM users) AS taken").fetchone()["taken"]:
            log.warning("%s is not copied: Postgres already has accounts", source)
            return False
        log.info("copying %s into Postgres", source)
        work = _readable_copy(source)
        try:
            with closing(sqlite3.connect(work)) as lite:
                counts = _copy(lite, conn, db.default_workspace)
        finally:
            work.unlink(missing_ok=True)
        conn.execute("INSERT INTO server_settings (key, value) VALUES (%s, %s)", (MARK, now_iso()))
    kept = _rename(source)
    db.seed(db.default_workspace)
    log.info(
        "copied %s into Postgres: %d people, %d boards; the file is kept as %s",
        source,
        counts["users"],
        counts["boards"],
        kept.name,
    )
    return True


def _readable_copy(source: Path) -> Path:
    """A copy next to the file, brought to the last SQLite schema; the file stays as it was."""
    with closing(sqlite3.connect(source, isolation_level=None)) as conn:
        # Folds the WAL in, so the renamed file holds everything on its own.
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        work = source.with_name(f"{source.name}.copying")
        work.unlink(missing_ok=True)
        with closing(sqlite3.connect(work)) as copy:
            conn.backup(copy)
    with closing(sqlite3.connect(work, isolation_level=None)) as conn:
        conn.row_factory = sqlite3.Row
        migrate(conn)
    return work


def migrate(conn: sqlite3.Connection, upto: int | None = None) -> None:
    """The SQLite migrations, for a file of any earlier release; `upto` is for tests."""
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for number, step in MIGRATIONS:
        if number <= current or (upto is not None and number > upto):
            continue
        if isinstance(step, Path):
            conn.executescript(
                f"BEGIN;\n{step.read_text()}\nPRAGMA user_version = {number};\nCOMMIT;"
            )
            continue
        conn.execute("BEGIN")
        step(conn)
        conn.execute(f"PRAGMA user_version = {number}")
        conn.execute("COMMIT")


def _copy(lite: sqlite3.Connection, conn: psycopg.Connection, ws: str) -> dict[str, int]:
    for table in _SEEDED:
        conn.execute(f"DELETE FROM {table} WHERE workspace_id = %s", (ws,))
    counts: dict[str, int] = {}
    for table in TABLES:
        wanted = _write(lite, conn, table, ws)
        total = lite.execute(f"SELECT COUNT(*) FROM {table.source}").fetchone()[0]
        if total > wanted:
            log.warning(
                "%s: %d rows point at rows that no longer exist; not copied",
                table.target,
                total - wanted,
            )
        where, params = ("WHERE workspace_id = %s", (ws,)) if table.scoped else ("", ())
        found = conn.execute(f"SELECT COUNT(*) AS n FROM {table.target} {where}", params)
        written = found.fetchone()["n"]
        if written != wanted:
            # The transaction rolls back: Postgres stays empty and the file as it was.
            raise CopyFailed(f"{table.target}: {wanted} rows to copy, {written} in Postgres")
        counts[table.target] = written
    return counts


def _write(lite: sqlite3.Connection, conn: psycopg.Connection, table: _Table, ws: str) -> int:
    marks = ", ".join("%s::jsonb" if column in table.json else "%s" for column in table.columns)
    insert = f"INSERT INTO {table.target} ({', '.join(table.columns)}) VALUES ({marks})"
    flags = [i for i, column in enumerate(table.columns) if column in table.flags]
    # Board documents can be large: they go one at a time.
    size = 1 if table.target == "boards" else BATCH
    rows = lite.execute(table.select, {"ws": ws})
    wanted = 0
    with conn.cursor() as cursor:
        while batch := rows.fetchmany(size):
            if flags:
                batch = [
                    tuple(bool(v) if i in flags else v for i, v in enumerate(row)) for row in batch
                ]
            cursor.executemany(insert, batch)
            wanted += len(batch)
    return wanted


def _rename(source: Path) -> Path:
    day = datetime.now(UTC).date().isoformat()
    kept = source.with_name(f"{source.name}.copied-{day}")
    n = 1
    while kept.exists():
        n += 1
        kept = source.with_name(f"{source.name}.copied-{day}-{n}")
    source.rename(kept)
    # SQLite's own names, so the kept file opens with whatever is left beside it.
    for suffix in ("-wal", "-shm"):
        side = source.with_name(source.name + suffix)
        if side.exists():
            side.rename(kept.with_name(kept.name + suffix))
    return kept
