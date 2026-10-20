import hashlib
import json
import sqlite3
import threading
from contextlib import closing
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.adapters.storage import copy_sqlite
from app.adapters.storage import postgres as pg
from app.adapters.tasks.demo import DemoTaskProvider
from app.config import Settings
from app.domain.accounts import hash_password
from app.domain.live import LiveDoc, stored_node
from app.main import create_app
from tests.conftest import signed_in
from tests.test_live import sticky

DOC = {"nodes": [sticky("n1", "Plan")]}
T = "2026-03-01T09:00:00+00:00"


@pytest.fixture
def db(pg_url):
    return pg.shared(pg_url)


def made(path: Path, upto: int | None = None) -> Path:
    """An app.db of the release that stopped at migration `upto`, without rows."""
    with closing(sqlite3.connect(path, isolation_level=None)) as conn:
        conn.row_factory = sqlite3.Row
        copy_sqlite.migrate(conn, upto)
    return path


def fill(path: Path) -> None:
    """Made-up rows in every table of the last SQLite schema, some pointing at deleted rows."""
    pw = hash_password("secret-pw")
    with closing(sqlite3.connect(path)) as conn, conn:
        conn.executemany(
            "INSERT INTO users (id, username, name, password_hash, role, created_at,"
            " demo_expires_at, welcomed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("a1", "ada", "Ada Example", pw, "admin", "2026-01-01T00:00:00+00:00", None, T),
                ("a2", "bob", "Bob Example", pw, "admin", "2026-02-01T00:00:00+00:00", None, T),
                ("m1", "cy", "Cy Example", pw, "member", T, None, None),
                ("d1", "visitor-1", "Visitor", pw, "member", T, "2026-03-08T09:00:00+00:00", None),
            ],
        )
        conn.executemany(
            "INSERT INTO sessions VALUES (?, ?, ?, ?)",
            [("s1", "m1", "2026-04-01T00:00:00+00:00", T), ("s2", "gone", T, T)],
        )
        conn.executemany(
            "INSERT INTO invites (id, token_hash, kind, role, user_id, created_by, expires_at,"
            " created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("i1", "h-i1", "invite", "member", None, "a1", T, T),
                ("i2", "h-i2", "invite", "admin", None, "gone", T, T),
                ("r1", "h-r1", "reset", None, "m1", "a1", T, T),
                ("r2", "h-r2", "reset", None, "gone", "a1", T, T),
            ],
        )
        conn.execute("INSERT INTO attempts VALUES ('login', 'ada', 1.5)")
        conn.execute("INSERT INTO attempt_windows VALUES ('demo', '10.0.0.1', 2.5, 3)")
        conn.executemany(
            "INSERT INTO known_browsers VALUES (?, ?, ?)", [("k1", "a1", 3.5), ("k2", "gone", 4.5)]
        )
        conn.executemany(
            "INSERT INTO boards (id, name, doc, version, created_at, updated_at, everyone_role,"
            " ydoc, public_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("b1", "Roadmap", json.dumps(DOC), 7, T, T, "viewer", b"\x01\x02", "pub-1"),
                ("b2", "Notes", '{"nodes": []}', 1, T, T, None, None, None),
            ],
        )
        conn.executemany(
            "INSERT INTO board_members VALUES (?, ?, ?)",
            [("b1", "a1", "owner"), ("b1", "m1", "editor"), ("b2", "m1", "owner")]
            + [("b-gone", "m1", "owner"), ("b2", "gone", "viewer")],
        )
        conn.executemany(
            "INSERT OR REPLACE INTO settings VALUES (?, ?)",
            [("instance_id", "inst-made-up"), ("welcome_seeded", "1"), ("provider", "demo")],
        )
        conn.execute(
            "INSERT INTO user_credentials VALUES ('m1', 'jira', 'enc', 'https://jira.example.com')"
        )
        conn.executemany(
            "INSERT INTO task_snapshots_v3 VALUES (?, ?, ?, ?, ?, ?)",
            [
                ("m1", "jira", "APP-1", "ok", '{"key": "APP-1"}', T),
                ("gone", "jira", "APP-2", "ok", "{}", T),
            ],
        )
        conn.execute("INSERT INTO demo_statuses VALUES ('d1', 'DEMO-1', 'Done', ?)", (T,))
        conn.execute("INSERT INTO onboarding VALUES ('m1', '{\"tour\": true}')")
        conn.execute("INSERT INTO planning_types VALUES ('t1', 'Design', 210, 1, 1)")
        conn.execute("INSERT INTO planning_fields VALUES ('f1', 'Budget', 0, 0, 4)")
        conn.execute("UPDATE planning_fields SET name = 'Weight' WHERE id = 'size'")
        conn.execute("INSERT INTO planning_views VALUES ('v1', 'Mine', '{\"people\": []}', 1)")
        conn.execute(
            "INSERT INTO planning_people VALUES ('p1', 'Dee', '[\"Core\"]', 'manual', 0, 1)"
        )
        conn.executemany(
            "INSERT INTO planning_off VALUES (?, ?, ?, ?)",
            [
                ("o1", "p1", "2026-11-02", "2026-11-06"),
                ("o2", "p-gone", "2026-11-02", "2026-11-03"),
            ],
        )
        conn.executemany(
            'INSERT INTO planning_stages (board_id, person_id, row_title, type, start, "end")'
            " VALUES (?, ?, ?, ?, ?, ?)",
            [
                ("b1", "p1", "APP-1", "t1", "2026-11-02", "2026-11"),
                ("b-gone", "p1", "x", "t1", "", ""),
            ],
        )


def rows(db: pg.Database, query: str, *params) -> list[dict]:
    with db.jobs() as conn:
        return conn.execute(query, params).fetchall()


def test_every_table_lands_in_the_default_workspace(db, tmp_path):
    path = made(tmp_path / "app.db")
    fill(path)

    assert copy_sqlite.copy_once(db, str(path)) is True

    ws = db.default_workspace
    count = {
        r["t"]: r["n"]
        for r in rows(
            db,
            "SELECT 'users' t, COUNT(*) n FROM users"
            " UNION ALL SELECT 'sessions', COUNT(*) FROM sessions"
            " UNION ALL SELECT 'invites', COUNT(*) FROM invites"
            " UNION ALL SELECT 'resets', COUNT(*) FROM password_resets"
            " UNION ALL SELECT 'browsers', COUNT(*) FROM known_browsers"
            " UNION ALL SELECT 'members', COUNT(*) FROM board_members"
            " UNION ALL SELECT 'snapshots', COUNT(*) FROM task_snapshots"
            " UNION ALL SELECT 'off', COUNT(*) FROM planning_off"
            " UNION ALL SELECT 'stages', COUNT(*) FROM planning_stages",
        )
    }
    # Rows that pointed at deleted ones are left out; everything else is there.
    assert count == {
        "users": 4,
        "sessions": 1,
        "invites": 2,
        "resets": 1,
        "browsers": 1,
        "members": 3,
        "snapshots": 1,
        "off": 1,
        "stages": 1,
    }
    admins = rows(db, "SELECT id, server_admin FROM users ORDER BY id")
    assert [(r["id"], r["server_admin"]) for r in admins] == [
        ("a1", True),
        ("a2", False),
        ("d1", False),
        ("m1", False),
    ]
    roles = rows(db, "SELECT user_id, role FROM memberships WHERE workspace_id = %s", ws)
    assert {r["user_id"]: r["role"] for r in roles} == {
        "a1": "admin",
        "a2": "admin",
        "m1": "member",
        "d1": "member",
    }
    invites = rows(db, "SELECT id, created_by FROM invites ORDER BY id")
    assert [(r["id"], r["created_by"]) for r in invites] == [("i1", "a1"), ("i2", None)]
    board = rows(db, "SELECT * FROM boards WHERE id = 'b1'")[0]
    assert json.loads(board["doc"]) == DOC
    assert (board["ydoc"], board["version"], board["everyone_role"]) == (b"\x01\x02", 7, "viewer")
    assert rows(db, "SELECT public_token FROM board_index WHERE board_id = 'b1'") == [
        {"public_token": "pub-1"}
    ]
    settings = rows(db, "SELECT key, value FROM settings WHERE workspace_id = %s", ws)
    assert {r["key"]: r["value"] for r in settings}["instance_id"] == "inst-made-up"
    fields = rows(db, "SELECT id, name FROM planning_fields ORDER BY position")
    assert [(r["id"], r["name"]) for r in fields] == [
        ("priority", "Priority"),
        ("size", "Weight"),
        ("team", "Team"),
        ("f1", "Budget"),
    ]
    assert rows(db, "SELECT archived FROM planning_types") == [{"archived": True}]
    assert rows(db, "SELECT key FROM server_settings") == [{"key": copy_sqlite.MARK}]
    assert not path.exists()
    kept = list(tmp_path.glob("app.db.copied-*"))
    assert len(kept) == 1 and not list(tmp_path.glob("*.copying"))


def test_people_sign_in_and_see_their_boards_after_the_copy(tmp_path):
    path = made(tmp_path / "app.db")
    fill(path)

    app = create_app(Settings(db_path=str(path)))
    member = signed_in(app, "cy", "secret-pw")

    assert {b["name"] for b in member.get("/api/boards").json()["boards"]} == {"Roadmap", "Notes"}
    assert TestClient(app).get("/api/public/pub-1").json()["name"] == "Roadmap"
    # The copied admins are there, so no first admin is made from TIKO_PASSWORD.
    assert (
        TestClient(app)
        .post("/api/auth/login", json={"username": "admin", "password": "test-password"})
        .status_code
        == 401
    )


@pytest.mark.parametrize("upto", sorted({number for number, _ in copy_sqlite.MIGRATIONS}))
def test_a_file_of_any_earlier_release_is_copied(db, tmp_path, upto):
    path = made(tmp_path / "app.db", upto)

    assert copy_sqlite.copy_once(db, str(path)) is True
    assert rows(db, "SELECT key FROM server_settings") == [{"key": copy_sqlite.MARK}]
    # The standard fields come back from the seed when the file was older than them.
    assert len(rows(db, "SELECT id FROM planning_fields WHERE standard")) == 3


def test_an_old_card_type_is_renamed_on_the_way(db, tmp_path):
    path = made(tmp_path / "app.db", 11)
    doc = {"nodes": [{"id": "c1", "type": "jira_card", "x": 0, "y": 0, "data": {"key": "APP-1"}}]}
    with closing(sqlite3.connect(path)) as conn, conn:
        conn.execute(
            "INSERT INTO boards (id, name, doc, version, created_at, updated_at)"
            " VALUES ('b1', 'Old', ?, 1, ?, ?)",
            (json.dumps(doc), T, T),
        )

    copy_sqlite.copy_once(db, str(path))

    stored = json.loads(rows(db, "SELECT doc FROM boards")[0]["doc"])
    assert stored["nodes"][0]["type"] == "task_card"


def test_a_failed_copy_leaves_postgres_empty_and_the_file_as_it_was(db, tmp_path):
    path = made(tmp_path / "app.db")
    fill(path)
    with closing(sqlite3.connect(path)) as conn, conn:
        conn.execute("UPDATE boards SET doc = 'not json' WHERE id = 'b2'")
    before = hashlib.sha256(path.read_bytes()).hexdigest()

    with pytest.raises(psycopg.Error):
        copy_sqlite.copy_once(db, str(path))

    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
    assert rows(db, "SELECT COUNT(*) AS n FROM users") == [{"n": 0}]
    assert rows(db, "SELECT COUNT(*) AS n FROM server_settings") == [{"n": 0}]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["app.db"]


def test_two_processes_starting_together_copy_once(db, tmp_path):
    path = made(tmp_path / "app.db")
    fill(path)
    results: list[bool] = []
    threads = [
        threading.Thread(target=lambda: results.append(copy_sqlite.copy_once(db, str(path))))
        for _ in range(2)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(results) == [False, True]
    assert rows(db, "SELECT COUNT(*) AS n FROM users") == [{"n": 4}]


def test_a_file_put_back_after_the_copy_is_not_read_again(db, tmp_path, caplog):
    path = made(tmp_path / "app.db")
    fill(path)
    copy_sqlite.copy_once(db, str(path))
    next(tmp_path.glob("app.db.copied-*")).rename(path)

    assert copy_sqlite.copy_once(db, str(path)) is False
    assert path.exists()
    assert "is not read" in caplog.text


def test_no_file_no_copy(db, tmp_path):
    assert copy_sqlite.copy_once(db, str(tmp_path / "app.db")) is False
    assert copy_sqlite.copy_once(db, ":memory:") is False


def old_user(conn: sqlite3.Connection, user_id: str) -> None:
    conn.execute(
        "INSERT INTO users (id, username, name, password_hash, role, created_at)"
        " VALUES (?, ?, ?, 'x', 'member', ?)",
        (user_id, user_id, user_id, T),
    )


def legacy_card(node_id: str) -> dict:
    return {
        "id": node_id,
        "type": "jira_card",
        "position": {"x": 0, "y": 0},
        "data": {"key": "DEMO-1"},
    }


def test_a_task_cache_from_before_trackers_keeps_each_persons_rows(db, tmp_path):
    path = made(tmp_path / "app.db", 10)
    old = DemoTaskProvider().resolve("DEMO-1").model_dump_json(exclude={"source"})
    with closing(sqlite3.connect(path)) as conn, conn:
        old_user(conn, "ann")
        conn.execute("INSERT INTO settings VALUES ('provider', 'jira')")
        conn.executemany(
            "INSERT INTO task_snapshots_v2 VALUES (?, 'DEMO-1', 'ok', ?, ?)",
            [("ann", old, T), ("", old, T)],
        )

    copy_sqlite.copy_once(db, str(path))

    ann = pg.PgSnapshotRepo(db).scoped("ann")
    assert ann.get_many(["jira:DEMO-1"])["jira:DEMO-1"].source == "jira"
    assert len(rows(db, "SELECT key FROM task_snapshots")) == 1


def test_old_cards_are_renamed_in_live_states_and_an_unreadable_one_is_dropped(db, tmp_path):
    path = made(tmp_path / "app.db", 11)
    note = {
        "id": "s",
        "type": "sticky",
        "position": {"x": 0, "y": 0},
        "data": {"text": "jira_card"},
    }
    doc = json.dumps({"nodes": [legacy_card("a"), note], "edges": []})
    state = LiveDoc()
    state.write({"a": stored_node(legacy_card("a"), 0), "s": stored_node(note, 1)}, {})
    with closing(sqlite3.connect(path)) as conn, conn:
        conn.executemany(
            "INSERT INTO boards (id, name, doc, version, created_at, updated_at, ydoc)"
            " VALUES (?, ?, ?, 1, ?, ?, ?)",
            [("live", "Live", doc, T, T, state.state()), ("bad", "Bad", doc, T, T, b"not a state")],
        )

    copy_sqlite.copy_once(db, str(path))

    record, ydoc = pg.PgBoardRepo(db).load("live")
    card, kept = record.doc.nodes
    assert (card.type, kept.data.text) == ("task_card", "jira_card")
    nodes, _ = LiveDoc(ydoc).read()
    assert (nodes["a"]["type"], nodes["s"]["data"]["text"]) == ("task_card", "jira_card")
    record, ydoc = pg.PgBoardRepo(db).load("bad")
    assert (record.doc.nodes[0].type, ydoc) == ("task_card", None)


def test_stages_of_boards_saved_before_the_workload_are_indexed(db, tmp_path):
    path = made(tmp_path / "app.db", 21)
    stage = {"id": "s1", "type": "t1", "start": "2026-10-12", "end": "2026-10-16", "people": ["p1"]}
    content = {
        "start": "2026-10-01",
        "end": "2026-12-31",
        "rows": [{"id": "c", "title": "", "key": "WEB-7", "stages": [stage]}],
    }
    node = {"id": "g", "type": "module", "position": {"x": 0, "y": 0}}
    doc = {"nodes": [node | {"data": {"kind": "gantt", "content": content}}], "edges": []}
    with closing(sqlite3.connect(path)) as conn, conn:
        conn.execute(
            "INSERT INTO boards (id, name, doc, version, created_at, updated_at)"
            " VALUES ('b1', 'Plan', ?, 1, ?, ?)",
            (json.dumps(doc), T, T),
        )

    copy_sqlite.copy_once(db, str(path))

    stages = pg.PgPlanningStageRepo(db).for_person("p1")
    assert [(s.board_name, s.row, str(s.start)) for s in stages] == [
        ("Plan", "WEB-7", "2026-10-12")
    ]


def test_boards_from_before_accounts_go_to_the_first_admin_without_a_welcome(tmp_path):
    path = tmp_path / "app.db"
    with closing(sqlite3.connect(path)) as old:
        old.executescript(
            "CREATE TABLE boards (id TEXT PRIMARY KEY, name TEXT, doc TEXT, version INTEGER,"
            " created_at TEXT, updated_at TEXT);"
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
            f"INSERT INTO boards VALUES ('b', 'Q4', '{{}}', 1, '{T}', '{T}');"
            "PRAGMA user_version = 2;"
        )

    admin = signed_in(create_app(Settings(db_path=str(path))))

    assert [b["name"] for b in admin.get("/api/boards").json()["boards"]] == ["Q4"]
    assert admin.delete("/api/boards/b").is_success
    assert admin.get("/api/boards").json()["boards"] == []


def test_the_token_from_before_accounts_moves_to_the_admin(db, tmp_path):
    path = made(tmp_path / "app.db")
    with closing(sqlite3.connect(path)) as conn, conn:
        conn.executemany(
            "INSERT OR REPLACE INTO settings VALUES (?, ?)",
            [("jira_base_url", "https://jira.example.com"), ("jira_token_enc", "sealed")],
        )
        # The cache from before trackers stays behind: its rows name none.
        conn.execute("INSERT INTO task_snapshots VALUES ('DEV-7', 'ok', '{}', 'x')")

    create_app(Settings(db_path=str(path)))

    admin = pg.PgUserRepo(db).find("admin")[0]
    assert pg.PgCredentialRepo(db).get(admin.id, "jira") == ("sealed", "https://jira.example.com")
    assert "jira_token_enc" not in pg.PgSettingsRepo(db).get_all()
