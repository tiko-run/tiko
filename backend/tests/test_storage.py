import json
import sqlite3
import subprocess
import sys
import threading
from datetime import datetime

import pytest

from app.adapters.storage import sqlite
from app.adapters.storage.sqlite import Database, SqliteBoardRepo, SqliteSnapshotRepo
from app.adapters.tasks.demo import DemoTaskProvider
from app.domain.boards import BoardDoc
from app.domain.errors import VersionConflict
from app.domain.live import LiveDoc, stored_node
from tests.conftest import add_person

_HOLD_A_WRITE = """
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1], isolation_level=None)
conn.execute("BEGIN IMMEDIATE")
conn.execute("UPDATE boards SET name = 'after' WHERE id = ?", (sys.argv[2],))
print("held", flush=True)
sys.stdin.readline()
conn.execute("COMMIT")
"""


@pytest.fixture
def db():
    return Database(":memory:")


def test_board_save_is_compare_and_set(store):
    mod, db = store
    repo = mod.BoardRepo(db)
    board_id = repo.create("Q4", BoardDoc(), add_person(store, "owner"))
    assert repo.save(board_id, 1, BoardDoc()) == 2
    with pytest.raises(VersionConflict):
        repo.save(board_id, 1, BoardDoc())
    assert repo.get(board_id).version == 2
    assert [b.name for b in repo.listing("owner")] == ["Q4"]


def test_snapshots_upsert_by_key(store):
    mod, db = store
    repo = mod.SnapshotRepo(db).scoped(add_person(store, "ann"))
    provider = DemoTaskProvider()
    repo.put_many([provider.resolve("DEMO-1")])
    repo.put_many([provider.resolve("DEMO-1"), provider.resolve("DEMO-2")])
    refs = ["demo:DEMO-1", "demo:DEMO-2", "demo:DEMO-3"]
    assert set(repo.get_many(refs)) == {"demo:DEMO-1", "demo:DEMO-2"}
    assert repo.get_many([]) == {}


def test_snapshots_keep_trackers_and_people_apart(store):
    mod, db = store
    task = DemoTaskProvider().resolve("DEMO-1")
    other = task.model_copy(update={"source": "jira", "summary": "Another task"})
    ann = mod.SnapshotRepo(db).scoped(add_person(store, "ann"))
    ann.put_many([task, other])
    found = ann.get_many(["demo:DEMO-1", "jira:DEMO-1"])
    assert found["demo:DEMO-1"].summary != found["jira:DEMO-1"].summary == "Another task"
    assert mod.SnapshotRepo(db).scoped(add_person(store, "bob")).get_many(["demo:DEMO-1"]) == {}


@pytest.mark.sqlite_only
def test_migrations_run_once(tmp_path):
    path = str(tmp_path / "app.db")
    SqliteBoardRepo(Database(path)).create("kept", BoardDoc(), "owner")
    assert [b.name for b in SqliteBoardRepo(Database(path)).listing("owner")] == ["kept"]


@pytest.mark.sqlite_only
def test_upgrade_keeps_each_persons_task_cache(tmp_path):
    path = str(tmp_path / "app.db")
    Database(path)
    conn = sqlite3.connect(path)
    conn.executescript(
        "PRAGMA user_version = 10; DROP TABLE task_snapshots_v3;"
        "DROP TABLE attempts; DROP TABLE attempt_windows;"
        "CREATE TABLE task_snapshots_v2 (user_id TEXT, key TEXT, state TEXT, data TEXT,"
        " fetched_at TEXT, PRIMARY KEY (user_id, key));"
        "INSERT INTO settings VALUES ('provider', 'jira');"
    )
    old = DemoTaskProvider().resolve("DEMO-1").model_dump_json(exclude={"source"})
    conn.executemany(
        "INSERT INTO task_snapshots_v2 VALUES (?, 'DEMO-1', 'ok', ?, 'x')",
        [("ann", old), ("", old)],
    )
    conn.commit()
    conn.close()

    ann = SqliteSnapshotRepo(Database(path)).scoped("ann")
    assert ann.get_many(["jira:DEMO-1"])["jira:DEMO-1"].source == "jira"
    assert SqliteSnapshotRepo(Database(path)).scoped("").get_many(["jira:DEMO-1"]) == {}


def _legacy_card(node_id: str) -> dict:
    return {
        "id": node_id,
        "type": "jira_card",
        "position": {"x": 0, "y": 0},
        "data": {"key": "DEMO-1"},
    }


@pytest.mark.sqlite_only
def test_upgrade_renames_stored_cards_and_copies_the_database_first(tmp_path):
    path = str(tmp_path / "app.db")
    repo = SqliteBoardRepo(Database(path))
    plain = repo.create("plain", BoardDoc(), "owner")
    live_id = repo.create("live", BoardDoc(), "owner")
    sticky = {
        "id": "s",
        "type": "sticky",
        "position": {"x": 0, "y": 0},
        "data": {"text": "jira_card"},
    }
    old_doc = json.dumps({"nodes": [_legacy_card("a"), sticky], "edges": []})
    state = LiveDoc()
    state.write({"a": stored_node(_legacy_card("a"), 0), "s": stored_node(sticky, 1)}, {})
    conn = sqlite3.connect(path)
    conn.execute("UPDATE boards SET doc = ? WHERE id = ?", (old_doc, plain))
    conn.execute(
        "UPDATE boards SET doc = ?, ydoc = ? WHERE id = ?", (old_doc, state.state(), live_id)
    )
    conn.executescript("DROP TABLE attempts; DROP TABLE attempt_windows;")
    conn.execute("PRAGMA user_version = 11")
    conn.commit()
    conn.close()

    repo = SqliteBoardRepo(Database(path))
    for board_id in (plain, live_id):
        card, note = repo.get(board_id).doc.nodes
        assert (card.type, note.data.text) == ("task_card", "jira_card")
    record, ydoc = repo.load(live_id)
    nodes, _ = LiveDoc(ydoc).read()
    assert (nodes["a"]["type"], nodes["s"]["data"]["text"]) == ("task_card", "jira_card")
    assert repo.load(plain)[1] is None

    [copy] = (tmp_path / "backups").glob("before-v12-*.db")
    kept = sqlite3.connect(copy).execute("SELECT doc FROM boards WHERE id = ?", (plain,))
    assert '"type": "jira_card"' in kept.fetchone()[0]
    Database(path)
    assert len(list((tmp_path / "backups").glob("*.db"))) == 1


@pytest.mark.sqlite_only
def test_upgrade_rebuilds_a_live_state_it_cannot_read(tmp_path):
    path = str(tmp_path / "app.db")
    board_id = SqliteBoardRepo(Database(path)).create("b", BoardDoc(), "owner")
    conn = sqlite3.connect(path)
    conn.execute(
        "UPDATE boards SET doc = ?, ydoc = ? WHERE id = ?",
        (json.dumps({"nodes": [_legacy_card("a")]}), b"not a state", board_id),
    )
    conn.executescript("DROP TABLE attempts; DROP TABLE attempt_windows;")
    conn.execute("PRAGMA user_version = 11")
    conn.commit()
    conn.close()

    record, ydoc = SqliteBoardRepo(Database(path)).load(board_id)
    assert (record.doc.nodes[0].type, ydoc) == ("task_card", None)


@pytest.mark.sqlite_only
def test_the_copy_is_taken_before_the_first_step_of_the_upgrade(tmp_path, monkeypatch):
    path = str(tmp_path / "app.db")
    Database(path)
    top = sqlite.MIGRATIONS[-1][0]
    script = tmp_path / "drop.sql"
    script.write_text("DROP TABLE boards;")
    tries = []

    def rewrite(conn):
        tries.append(1)
        if len(tries) == 1:
            raise RuntimeError("the first start fails")

    steps = [*sqlite.MIGRATIONS, (top + 1, script), (top + 2, rewrite)]
    monkeypatch.setattr(sqlite, "MIGRATIONS", steps)
    # A retry within the same second must not write over the first copy.
    monkeypatch.setattr(
        sqlite, "datetime", type("Frozen", (), {"now": lambda: datetime(2026, 1, 1)})
    )
    with pytest.raises(RuntimeError):
        Database(path)
    Database(path)
    [copy] = (tmp_path / "backups").glob(f"before-v{top + 2}-*.db")
    kept = sqlite3.connect(copy)
    assert kept.execute("PRAGMA user_version").fetchone()[0] == top
    assert kept.execute("SELECT count(*) FROM boards").fetchone()[0] == 0


@pytest.mark.sqlite_only
def test_a_new_database_is_not_copied(tmp_path):
    Database(str(tmp_path / "app.db"))
    assert not (tmp_path / "backups").exists()


@pytest.mark.sqlite_only
def test_a_read_answers_while_a_write_is_held(tmp_path):
    db = Database(str(tmp_path / "app.db"))
    repo = SqliteBoardRepo(db)
    board_id = repo.create("before", BoardDoc(), "owner")
    seen = []
    with db.transaction() as conn:
        conn.execute("UPDATE boards SET name = 'after' WHERE id = ?", (board_id,))
        reader = threading.Thread(target=lambda: seen.append(repo.get(board_id).name))
        reader.start()
        reader.join(2)
    assert seen == ["before"]
    assert repo.get(board_id).name == "after"


@pytest.mark.sqlite_only
def test_a_read_does_not_wait_for_a_write_of_another_process(tmp_path):
    path = str(tmp_path / "app.db")
    repo = SqliteBoardRepo(Database(path))
    board_id = repo.create("before", BoardDoc(), "owner")
    writer = subprocess.Popen(
        [sys.executable, "-c", _HOLD_A_WRITE, path, board_id],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert writer.stdout.readline() == "held\n"
        assert [board.name for board in repo.listing("owner")] == ["before"]
    finally:
        writer.communicate("go\n", timeout=10)
    assert repo.get(board_id).name == "after"


@pytest.mark.sqlite_only
def test_the_connection_for_reads_cannot_write(tmp_path):
    db = Database(str(tmp_path / "app.db"))
    with pytest.raises(sqlite3.OperationalError), db.read() as conn:
        conn.execute("DELETE FROM boards")


@pytest.mark.sqlite_only
def test_a_commit_does_not_wait_for_its_own_fsync(tmp_path):
    db = Database(str(tmp_path / "app.db"))
    with db.transaction() as conn:
        assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1
