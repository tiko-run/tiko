import json
import logging
import sqlite3
import threading
import time
import uuid
from collections.abc import Callable
from contextlib import closing, contextmanager
from datetime import datetime
from pathlib import Path

from app.domain.accounts import Person, PersonRecord, Role
from app.domain.boards import CARD, LEGACY_CARD, BoardDoc, BoardRecord, BoardRow
from app.domain.errors import NotFound, UsernameTaken, VersionConflict
from app.domain.invites import Invite
from app.domain.live import LiveDoc
from app.domain.members import BoardRole, Member, MemberUser, ShareRole
from app.domain.tasks import Task, now_iso
from app.observability import DB_HELD, DB_WAIT

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


# File names start with the schema version they produce: 001_init.sql → user_version 1.
# A step SQL cannot express is a function; the database is copied aside before it runs.
Step = Path | Callable[[sqlite3.Connection], None]
MIGRATIONS: list[tuple[int, Step]] = sorted(
    [
        *(
            (int(path.name.split("_", 1)[0]), path)
            for path in (Path(__file__).parent / "migrations").glob("*.sql")
        ),
        (12, _rename_cards),
    ],
    key=lambda step: step[0],
)


class Database:
    """One shared connection guarded by a lock: enough for a single-user app."""

    def __init__(self, path: str) -> None:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._path = path
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._migrate()

    def _migrate(self) -> None:
        current = self._conn.execute("PRAGMA user_version").fetchone()[0]
        for number, step in MIGRATIONS:
            if number <= current:
                continue
            if isinstance(step, Path):
                # executescript commits any open transaction, so the script carries its own.
                with self._lock:
                    self._conn.executescript(
                        f"BEGIN;\n{step.read_text()}\nPRAGMA user_version = {number};\nCOMMIT;"
                    )
                continue
            # A database made just now has nothing to lose.
            if current:
                self._copy_aside(number)
            with self.transaction() as conn:
                step(conn)
                conn.execute(f"PRAGMA user_version = {number}")

    def _copy_aside(self, number: int) -> None:
        if self._path == ":memory:":
            return
        target = Path(self._path).parent / "backups"
        target.mkdir(parents=True, exist_ok=True)
        target /= f"before-v{number}-{datetime.now():%Y%m%d-%H%M%S}.db"
        with closing(sqlite3.connect(target)) as copy:
            self._conn.backup(copy)
        log.info("database copied to %s before migration %s", target, number)

    @contextmanager
    def transaction(self):
        asked = time.perf_counter()
        with self._lock:
            started = time.perf_counter()
            DB_WAIT.observe(started - asked)
            try:
                # The write lock up front: a transaction that reads and then writes would
                # fail at the write when another process wrote in between.
                self._conn.execute("BEGIN IMMEDIATE")
                try:
                    yield self._conn
                except BaseException:
                    self._conn.execute("ROLLBACK")
                    raise
                self._conn.execute("COMMIT")
            finally:
                DB_HELD.observe(time.perf_counter() - started)

    def ping(self) -> bool:
        try:
            with self._lock:
                return self._conn.execute("SELECT 1").fetchone()[0] == 1
        except sqlite3.Error:
            return False


class SqliteBoardRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    def listing(
        self, user_id: str, board_id: str | None = None, others: bool = False
    ) -> list[BoardRow]:
        if board_id:
            where, params = "WHERE b.id = ?", (user_id, board_id)
        elif others:
            # A demo visitor's boards are theirs alone and gone in days; they would bury the rest.
            where = "WHERE m.role IS NOT NULL OR u.demo_expires_at IS NULL"
            params = (user_id,)
        else:
            where = (
                "WHERE b.id IN (SELECT board_id FROM board_members WHERE user_id = ?)"
                " OR b.everyone_role IS NOT NULL"
            )
            params = (user_id, user_id)
        with self._db.transaction() as conn:
            rows = conn.execute(
                "SELECT b.id, b.name, b.updated_at, b.everyone_role, m.role AS member_role,"
                " o.user_id AS owner_id, u.name AS owner_name,"
                " b.public_token IS NOT NULL AS public FROM boards b"
                " LEFT JOIN board_members m ON m.board_id = b.id AND m.user_id = ?"
                " LEFT JOIN board_members o ON o.board_id = b.id AND o.role = 'owner'"
                f" LEFT JOIN users u ON u.id = o.user_id {where} ORDER BY b.updated_at DESC",
                params,
            ).fetchall()
        return [BoardRow(**dict(row)) for row in rows]

    def create(
        self, name: str, doc: BoardDoc, owner_id: str, limit: int | None = None
    ) -> str | None:
        with self._db.transaction() as conn:
            if limit is not None:
                owned = conn.execute(
                    "SELECT COUNT(*) FROM board_members WHERE user_id = ? AND role = 'owner'",
                    (owner_id,),
                ).fetchone()[0]
                if owned >= limit:
                    return None
            return self._insert(conn, name, doc, owner_id)

    def create_welcome(self, user_id: str, name: str, doc: BoardDoc) -> str | None:
        with self._db.transaction() as conn:
            claimed = conn.execute(
                "UPDATE users SET welcomed_at = ? WHERE id = ? AND welcomed_at IS NULL",
                (now_iso(), user_id),
            )
            if claimed.rowcount == 0:
                return None
            owns = conn.execute(
                "SELECT 1 FROM board_members WHERE user_id = ? AND role = 'owner'", (user_id,)
            ).fetchone()
            return None if owns else self._insert(conn, name, doc, user_id)

    @staticmethod
    def _insert(conn: sqlite3.Connection, name: str, doc: BoardDoc, owner_id: str) -> str:
        board_id, now = uuid.uuid4().hex, now_iso()
        conn.execute(
            "INSERT INTO boards (id, name, doc, version, created_at, updated_at)"
            " VALUES (?, ?, ?, 1, ?, ?)",
            (board_id, name, doc.model_dump_json(exclude_none=True), now, now),
        )
        conn.execute(
            "INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, 'owner')",
            (board_id, owner_id),
        )
        # Someone who made a board of their own needs no welcome board later.
        conn.execute(
            "UPDATE users SET welcomed_at = ? WHERE id = ? AND welcomed_at IS NULL",
            (now, owner_id),
        )
        return board_id

    def owned(self, user_id: str) -> int:
        with self._db.transaction() as conn:
            return conn.execute(
                "SELECT COUNT(*) FROM board_members WHERE user_id = ? AND role = 'owner'",
                (user_id,),
            ).fetchone()[0]

    def owner(self, board_id: str) -> str | None:
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT user_id FROM board_members WHERE board_id = ? AND role = 'owner'",
                (board_id,),
            ).fetchone()
        return row["user_id"] if row else None

    def get(self, board_id: str) -> BoardRecord | None:
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT id, name, doc, version, updated_at FROM boards WHERE id = ?", (board_id,)
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
        record = self.get(board_id)
        if record is None:
            return None
        with self._db.transaction() as conn:
            row = conn.execute("SELECT ydoc FROM boards WHERE id = ?", (board_id,)).fetchone()
        return record, row["ydoc"] if row else None

    def save_live(self, board_id: str, doc: BoardDoc, ydoc: bytes) -> int:
        with self._db.transaction() as conn:
            row = conn.execute(
                "UPDATE boards SET doc = ?, ydoc = ?, version = version + 1, updated_at = ?"
                " WHERE id = ? RETURNING version",
                (doc.model_dump_json(exclude_none=True), ydoc, now_iso(), board_id),
            ).fetchone()
        if row is None:
            raise NotFound("board not found")
        return row["version"]

    def save(self, board_id: str, version: int, doc: BoardDoc, ydoc: bytes | None = None) -> int:
        with self._db.transaction() as conn:
            cursor = conn.execute(
                "UPDATE boards SET doc = ?, ydoc = ?, version = version + 1, updated_at = ?"
                " WHERE id = ? AND version = ?",
                (doc.model_dump_json(exclude_none=True), ydoc, now_iso(), board_id, version),
            )
            if cursor.rowcount == 0:
                exists = conn.execute("SELECT 1 FROM boards WHERE id = ?", (board_id,)).fetchone()
                if exists is None:
                    raise NotFound("board not found")
                raise VersionConflict("board was changed elsewhere; reload it")
        return version + 1

    def rename(self, board_id: str, name: str) -> None:
        with self._db.transaction() as conn:
            cursor = conn.execute(
                "UPDATE boards SET name = ?, updated_at = ? WHERE id = ?",
                (name, now_iso(), board_id),
            )
        if cursor.rowcount == 0:
            raise NotFound("board not found")

    def delete(self, board_id: str) -> None:
        with self._db.transaction() as conn:
            # Foreign keys are off in this SQLite connection, so members go by hand.
            conn.execute("DELETE FROM board_members WHERE board_id = ?", (board_id,))
            cursor = conn.execute("DELETE FROM boards WHERE id = ?", (board_id,))
        if cursor.rowcount == 0:
            raise NotFound("board not found")

    def public_token(self, board_id: str) -> str | None:
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT public_token FROM boards WHERE id = ?", (board_id,)
            ).fetchone()
        return row["public_token"] if row else None

    def ensure_public_token(self, board_id: str, token: str) -> str | None:
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE boards SET public_token = ? WHERE id = ? AND public_token IS NULL",
                (token, board_id),
            )
            row = conn.execute(
                "SELECT public_token FROM boards WHERE id = ?", (board_id,)
            ).fetchone()
        return row["public_token"] if row else None

    def clear_public_token(self, board_id: str) -> str | None:
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT public_token FROM boards WHERE id = ?", (board_id,)
            ).fetchone()
            conn.execute("UPDATE boards SET public_token = NULL WHERE id = ?", (board_id,))
        return row["public_token"] if row else None

    def by_public_token(self, token: str) -> tuple[str, int, str] | None:
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT id, version, updated_at FROM boards WHERE public_token = ?", (token,)
            ).fetchone()
        return (row["id"], row["version"], row["updated_at"]) if row else None


class SqliteSnapshotRepo:
    """Task snapshots of one person."""

    def __init__(self, db: Database, owner: str = "") -> None:
        self._db = db
        self._owner = owner

    def scoped(self, owner: str) -> "SqliteSnapshotRepo":
        return SqliteSnapshotRepo(self._db, owner)

    def get_many(self, refs: list[str]) -> dict[str, Task]:
        if not refs:
            return {}
        marks = ",".join("?" * len(refs))
        with self._db.transaction() as conn:
            rows = conn.execute(
                "SELECT data FROM task_snapshots_v3"
                f" WHERE user_id = ? AND source || ':' || key IN ({marks})",
                [self._owner, *refs],
            ).fetchall()
        tasks = [Task.model_validate_json(row["data"]) for row in rows]
        return {task.ref: task for task in tasks}

    def put_many(self, tasks: list[Task]) -> None:
        with self._db.transaction() as conn:
            conn.executemany(
                "INSERT INTO task_snapshots_v3 (user_id, source, key, state, data, fetched_at)"
                " VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, source, key) DO UPDATE SET"
                " state = excluded.state, data = excluded.data, fetched_at = excluded.fetched_at",
                [
                    (self._owner, t.source, t.key, t.state, t.model_dump_json(), t.fetched_at)
                    for t in tasks
                ],
            )

    def forget(self, source: str) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "DELETE FROM task_snapshots_v3 WHERE user_id = ? AND source = ?",
                (self._owner, source),
            )


class SqliteCredentialRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    def get(self, user_id: str, provider: str) -> tuple[str, str] | None:
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT token_enc, base_url FROM user_credentials"
                " WHERE user_id = ? AND provider = ?",
                (user_id, provider),
            ).fetchone()
        return (row["token_enc"], row["base_url"]) if row else None

    def set(self, user_id: str, provider: str, token_enc: str, base_url: str) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO user_credentials (user_id, provider, token_enc, base_url)"
                " VALUES (?, ?, ?, ?) ON CONFLICT (user_id, provider) DO UPDATE SET"
                " token_enc = excluded.token_enc, base_url = excluded.base_url",
                (user_id, provider, token_enc, base_url),
            )

    def delete(self, user_id: str, provider: str) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "DELETE FROM user_credentials WHERE user_id = ? AND provider = ?",
                (user_id, provider),
            )

    def adopt_instance_token(self, user_id: str) -> None:
        """Moves the token and task cache from before accounts to this person, once."""
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO user_credentials (user_id, provider, token_enc, base_url)"
                " SELECT ?, 'jira', t.value, u.value FROM settings t"
                " JOIN settings u ON u.key = 'jira_base_url' WHERE t.key = 'jira_token_enc'",
                (user_id,),
            )
            conn.execute("DELETE FROM settings WHERE key = 'jira_token_enc'")
            legacy = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_snapshots'"
            ).fetchone()
            if legacy:
                # Its rows name no tracker; the cache fills again on the first refresh.
                conn.execute("DROP TABLE task_snapshots")


class SqliteSettingsRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    def get_all(self) -> dict[str, str]:
        with self._db.transaction() as conn:
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
        return {row["key"]: row["value"] for row in rows}

    def set_many(self, values: dict[str, str | None]) -> None:
        with self._db.transaction() as conn:
            for key, value in values.items():
                if value is None:
                    conn.execute("DELETE FROM settings WHERE key = ?", (key,))
                else:
                    conn.execute(
                        "INSERT INTO settings (key, value) VALUES (?, ?)"
                        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        (key, value),
                    )


_PERSON = "u.id, u.username, u.name, u.role, u.disabled_at, u.demo_expires_at"
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


def _person(row: sqlite3.Row) -> Person:
    return Person(
        id=row["id"],
        username=row["username"],
        name=row["name"],
        role=row["role"],
        disabled=row["disabled_at"] is not None,
        demo_expires_at=row["demo_expires_at"],
    )


# People and boards that were deleted. Named here: SqliteUserRepo has a method called `list`.
_Gone = tuple[list[str], list[str]]


def _delete_people(conn: sqlite3.Connection, user_ids: list[str]) -> list[str]:
    """Deletes people with everything of theirs; returns the ids of the boards that went."""
    board_ids: list[str] = []
    for user_id in user_ids:
        owned = conn.execute(
            "SELECT board_id FROM board_members WHERE user_id = ? AND role = 'owner'", (user_id,)
        ).fetchall()
        for row in owned:
            board_ids.append(row["board_id"])
            conn.execute("DELETE FROM board_members WHERE board_id = ?", (row["board_id"],))
            conn.execute("DELETE FROM boards WHERE id = ?", (row["board_id"],))
        for table in (
            "board_members",
            "sessions",
            "user_credentials",
            "task_snapshots_v3",
            "demo_statuses",
            "invites",
        ):
            conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return board_ids


class SqliteUserRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    def count(self) -> int:
        with self._db.transaction() as conn:
            return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    def add(self, person: Person, password_hash: str) -> None:
        try:
            with self._db.transaction() as conn:
                conn.execute(
                    "INSERT INTO users (id, username, name, password_hash, role, created_at,"
                    " demo_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        person.id,
                        person.username,
                        person.name,
                        password_hash,
                        person.role,
                        now_iso(),
                        person.demo_expires_at,
                    ),
                )
        except sqlite3.IntegrityError as error:
            raise UsernameTaken("This username is taken.") from error

    def find(self, username: str) -> tuple[Person, str] | None:
        with self._db.transaction() as conn:
            row = conn.execute(
                f"SELECT {_PERSON}, u.password_hash FROM users u"
                " WHERE lower(u.username) = lower(?)",
                (username,),
            ).fetchone()
        return (_person(row), row["password_hash"]) if row else None

    def update(self, person: Person) -> None:
        try:
            with self._db.transaction() as conn:
                conn.execute(
                    "UPDATE users SET name = ?, username = ? WHERE id = ?",
                    (person.name, person.username, person.id),
                )
        except sqlite3.IntegrityError as error:
            raise UsernameTaken("This username is taken.") from error

    def set_password(self, user_id: str, password_hash: str) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id)
            )

    def get(self, user_id: str) -> Person | None:
        with self._db.transaction() as conn:
            row = conn.execute(
                f"SELECT {_PERSON} FROM users u WHERE u.id = ?", (user_id,)
            ).fetchone()
        return _person(row) if row else None

    def list(self) -> list[PersonRecord]:
        with self._db.transaction() as conn:
            rows = conn.execute(
                f"SELECT {_PERSON}, u.last_sign_in_at, u.created_at FROM users u"
                " WHERE u.demo_expires_at IS NULL ORDER BY lower(u.name), lower(u.username)"
            ).fetchall()
        return [
            PersonRecord(
                **_person(row).model_dump(),
                last_sign_in_at=row["last_sign_in_at"],
                created_at=row["created_at"],
            )
            for row in rows
        ]

    def set_role(self, user_id: str, role: Role) -> None:
        with self._db.transaction() as conn:
            conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))

    def set_disabled(self, user_id: str, disabled: bool) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE users SET disabled_at = ? WHERE id = ?",
                (now_iso() if disabled else None, user_id),
            )

    def active_admins(self) -> int:
        with self._db.transaction() as conn:
            return conn.execute(
                "SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled_at IS NULL"
            ).fetchone()[0]

    def touch_sign_in(self, user_id: str) -> None:
        with self._db.transaction() as conn:
            conn.execute("UPDATE users SET last_sign_in_at = ? WHERE id = ?", (now_iso(), user_id))

    def touch_demo(self, user_id: str, until: str) -> bool:
        with self._db.transaction() as conn:
            cursor = conn.execute(
                "UPDATE users SET demo_expires_at = ? WHERE id = ? AND demo_expires_at IS NOT NULL",
                (until, user_id),
            )
        return cursor.rowcount == 1

    def sign_up_demo(self, user_id: str, username: str, name: str, password_hash: str) -> bool:
        try:
            with self._db.transaction() as conn:
                # Only a row that still has an expiry: the cleanup or a second sign-up got there
                # first otherwise.
                cursor = conn.execute(
                    "UPDATE users SET username = ?, name = ?, password_hash = ?,"
                    " demo_expires_at = NULL, last_sign_in_at = ?"
                    " WHERE id = ? AND demo_expires_at IS NOT NULL",
                    (username, name, password_hash, now_iso(), user_id),
                )
        except sqlite3.IntegrityError as error:
            raise UsernameTaken("This username is taken.") from error
        return cursor.rowcount == 1

    def delete_unused_members(self, before: str) -> _Gone:
        with self._db.transaction() as conn:
            rows = conn.execute(
                "SELECT id FROM users WHERE demo_expires_at IS NULL AND role != 'admin'"
                " AND COALESCE(last_sign_in_at, created_at) <= ?",
                (before,),
            ).fetchall()
            return [row["id"] for row in rows], _delete_people(conn, [row["id"] for row in rows])

    def demo_alive(self, now: str) -> int:
        with self._db.transaction() as conn:
            return conn.execute(
                "SELECT COUNT(*) FROM users WHERE demo_expires_at > ?", (now,)
            ).fetchone()[0]

    def delete_expired_demo(self, now: str, untouched: str) -> _Gone:
        with self._db.transaction() as conn:
            rows = conn.execute(
                "SELECT id FROM users WHERE demo_expires_at <= ?"
                f" OR (demo_expires_at <= ? AND {_UNTOUCHED})",
                (now, untouched),
            ).fetchall()
            user_ids = [row["id"] for row in rows]
            return user_ids, _delete_people(conn, user_ids)

    def evict_untouched_demo(self) -> _Gone:
        with self._db.transaction() as conn:
            row = conn.execute(
                f"SELECT id FROM users WHERE demo_expires_at IS NOT NULL AND {_UNTOUCHED}"
                " ORDER BY demo_expires_at LIMIT 1"
            ).fetchone()
            user_ids = [row["id"]] if row else []
            return user_ids, _delete_people(conn, user_ids)


class SqliteDemoStatusRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    def get(self, user_id: str) -> dict[str, tuple[str, str]]:
        with self._db.transaction() as conn:
            rows = conn.execute(
                "SELECT key, status, updated_at FROM demo_statuses WHERE user_id = ?", (user_id,)
            ).fetchall()
        return {row["key"]: (row["status"], row["updated_at"]) for row in rows}

    def set(self, user_id: str, key: str, status: str, updated_at: str) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO demo_statuses (user_id, key, status, updated_at) VALUES (?, ?, ?, ?)"
                " ON CONFLICT (user_id, key) DO UPDATE SET"
                " status = excluded.status, updated_at = excluded.updated_at",
                (user_id, key, status, updated_at),
            )


class SqliteAttempts:
    def __init__(self, db: Database) -> None:
        self._db = db

    def recent(self, scope: str, key: str, since: float) -> tuple[int, float]:
        with self._db.transaction() as conn:
            count, oldest = conn.execute(
                "SELECT COUNT(*), MIN(at) FROM attempts WHERE scope = ? AND key = ? AND at > ?",
                (scope, key, since),
            ).fetchone()
        return count, oldest or 0.0

    def add(self, scope: str, key: str, at: float, since: float) -> None:
        with self._db.transaction() as conn:
            conn.execute("DELETE FROM attempts WHERE scope = ? AND at <= ?", (scope, since))
            conn.execute("INSERT INTO attempts (scope, key, at) VALUES (?, ?, ?)", (scope, key, at))

    def add_under(self, scope: str, key: str, limit: int, at: float, since: float) -> float | None:
        with self._db.transaction() as conn:
            conn.execute("DELETE FROM attempts WHERE scope = ? AND at <= ?", (scope, since))
            count, oldest = conn.execute(
                "SELECT COUNT(*), MIN(at) FROM attempts WHERE scope = ? AND key = ?", (scope, key)
            ).fetchone()
            if count >= limit:
                return oldest
            conn.execute("INSERT INTO attempts (scope, key, at) VALUES (?, ?, ?)", (scope, key, at))
        return None

    def spend(self, scope: str, key: str, limit: int, window_s: float, at: float) -> float | None:
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT opened, used FROM attempt_windows WHERE scope = ? AND key = ?", (scope, key)
            ).fetchone()
            opened, used = (row["opened"], row["used"]) if row else (at, 0)
            if not row or at - opened >= window_s:
                # A window opens: the moment to drop the scope's spent ones, or keys that
                # went quiet would stay here for good.
                conn.execute(
                    "DELETE FROM attempt_windows WHERE scope = ? AND opened <= ?",
                    (scope, at - window_s),
                )
                opened, used = at, 0
            if used >= limit:
                return opened
            conn.execute(
                "INSERT INTO attempt_windows (scope, key, opened, used) VALUES (?, ?, ?, ?)"
                " ON CONFLICT (scope, key) DO UPDATE SET used = excluded.used",
                (scope, key, opened, used + 1),
            )
        return None

    def drop(self, scope: str, key: str) -> None:
        with self._db.transaction() as conn:
            conn.execute("DELETE FROM attempt_windows WHERE scope = ? AND key = ?", (scope, key))


class SqliteSessionRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    def add(self, token_hash: str, user_id: str, expires_at: str, created_at: str) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, expires_at, created_at)"
                " VALUES (?, ?, ?, ?)",
                (token_hash, user_id, expires_at, created_at),
            )

    def get(self, token_hash: str) -> tuple[Person, str] | None:
        with self._db.transaction() as conn:
            row = conn.execute(
                f"SELECT {_PERSON}, s.expires_at FROM sessions s"
                " JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
                (token_hash,),
            ).fetchone()
        return (_person(row), row["expires_at"]) if row else None

    def delete(self, token_hash: str) -> None:
        with self._db.transaction() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))

    def delete_for_user(self, user_id: str, keep: str | None) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?", (user_id, keep)
            )

    def delete_expired(self, now: str) -> None:
        with self._db.transaction() as conn:
            conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))


_INVITE = (
    "SELECT i.id, i.kind, i.role, i.user_id, u.username, i.expires_at, i.created_at"
    " FROM invites i LEFT JOIN users u ON u.id = i.user_id"
)
_OPEN = "i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?"


class SqliteInviteRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    def add(self, invite: Invite, token_hash: str, created_by: str) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO invites (id, token_hash, kind, role, user_id, created_by,"
                " expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    invite.id,
                    token_hash,
                    invite.kind,
                    invite.role,
                    invite.user_id,
                    created_by,
                    invite.expires_at,
                    invite.created_at,
                ),
            )

    def find_open(self, token_hash: str, now: str) -> Invite | None:
        with self._db.transaction() as conn:
            row = conn.execute(
                f"{_INVITE} WHERE i.token_hash = ? AND {_OPEN}", (token_hash, now)
            ).fetchone()
        return Invite(**dict(row)) if row else None

    def consume(self, invite_id: str, now: str) -> bool:
        with self._db.transaction() as conn:
            cursor = conn.execute(
                f"UPDATE invites AS i SET used_at = ? WHERE i.id = ? AND {_OPEN}",
                (now, invite_id, now),
            )
        return cursor.rowcount == 1

    def unconsume(self, invite_id: str) -> None:
        with self._db.transaction() as conn:
            conn.execute("UPDATE invites SET used_at = NULL WHERE id = ?", (invite_id,))

    def pending(self, now: str) -> list[Invite]:
        with self._db.transaction() as conn:
            rows = conn.execute(f"{_INVITE} WHERE {_OPEN} ORDER BY i.created_at", (now,)).fetchall()
        return [Invite(**dict(row)) for row in rows]

    def revoke(self, invite_id: str, now: str) -> bool:
        with self._db.transaction() as conn:
            cursor = conn.execute(
                f"UPDATE invites AS i SET revoked_at = ? WHERE i.id = ? AND {_OPEN}",
                (now, invite_id, now),
            )
        return cursor.rowcount == 1


class SqliteMemberRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    def roles(
        self, board_id: str, user_id: str
    ) -> tuple[BoardRole | None, ShareRole | None] | None:
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT m.role, b.everyone_role FROM boards b"
                " LEFT JOIN board_members m ON m.board_id = b.id AND m.user_id = ?"
                " WHERE b.id = ?",
                (user_id, board_id),
            ).fetchone()
        return (row["role"], row["everyone_role"]) if row else None

    def role(self, board_id: str, user_id: str) -> BoardRole | None:
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT role FROM board_members WHERE board_id = ? AND user_id = ?",
                (board_id, user_id),
            ).fetchone()
        return row["role"] if row else None

    def members(self, board_id: str) -> list[Member]:
        with self._db.transaction() as conn:
            rows = conn.execute(
                "SELECT u.id, u.username, u.name, m.role FROM board_members m"
                " JOIN users u ON u.id = m.user_id WHERE m.board_id = ?"
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
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT everyone_role FROM boards WHERE id = ?", (board_id,)
            ).fetchone()
        return row["everyone_role"] if row else None

    def set_role(self, board_id: str, user_id: str, role: BoardRole) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, ?)"
                " ON CONFLICT (board_id, user_id) DO UPDATE SET role = excluded.role",
                (board_id, user_id, role),
            )

    def remove(self, board_id: str, user_id: str) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "DELETE FROM board_members WHERE board_id = ? AND user_id = ?", (board_id, user_id)
            )

    def set_everyone(self, board_id: str, role: ShareRole | None) -> None:
        with self._db.transaction() as conn:
            conn.execute("UPDATE boards SET everyone_role = ? WHERE id = ?", (role, board_id))

    def transfer(self, board_id: str, user_id: str) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE board_members SET role = 'editor' WHERE board_id = ? AND role = 'owner'",
                (board_id,),
            )
            conn.execute(
                "INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, 'owner')"
                " ON CONFLICT (board_id, user_id) DO UPDATE SET role = 'owner'",
                (board_id, user_id),
            )

    def adopt_orphans(self, owner_id: str) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO board_members (board_id, user_id, role)"
                " SELECT b.id, ?, 'owner' FROM boards b WHERE NOT EXISTS"
                " (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.role = 'owner')",
                (owner_id,),
            )
            # An install that already had its welcome board does not get a second one.
            conn.execute(
                "UPDATE users SET welcomed_at = created_at WHERE id = ? AND welcomed_at IS NULL"
                " AND EXISTS (SELECT 1 FROM settings WHERE key = 'welcome_seeded')",
                (owner_id,),
            )
