import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime

from app.adapters.storage.sqlite import (
    Database,
    SqliteBoardRepo,
    SqliteCredentialRepo,
    SqliteMemberRepo,
    SqliteUserRepo,
)
from app.adapters.tasks.demo import DemoTaskProvider
from app.domain.accounts import Person
from app.domain.boards import BoardDoc, check_doc, list_boards, task_refs
from app.domain.tasks import split_ref
from app.domain.upgrade import adopt_orphans
from app.domain.welcome import WELCOME_NAME, welcome_doc

NOW = datetime(2026, 10, 7, 9, 30, tzinfo=UTC)


def test_welcome_doc_is_a_valid_board_with_every_kind():
    doc = BoardDoc.model_validate(welcome_doc(NOW))
    check_doc(doc)
    kinds = {node.type for node in doc.nodes}
    assert kinds == {"text", "frame", "sticky", "task_card", "timer", "module"}
    assert len(doc.edges) == 2
    assert any(n.type == "task_card" and n.data.collapsed for n in doc.nodes)


def test_welcome_doc_uses_only_demo_tasks():
    doc = BoardDoc.model_validate(welcome_doc(NOW))
    demo = DemoTaskProvider()
    # Whatever tracker the instance is set to, the welcome tasks stay demo tasks.
    for ref in task_refs(doc, "jira"):
        source, key = split_ref(ref)
        assert source == "demo"
        assert demo.resolve(key).key == key


def test_welcome_dates_follow_the_day_it_is_made():
    doc = BoardDoc.model_validate(welcome_doc(NOW))
    gantt = next(n for n in doc.nodes if n.type == "module").data.content
    assert date.fromisoformat(gantt["start"]) < NOW.date() < date.fromisoformat(gantt["end"])
    assert gantt["milestones"][0]["date"] > NOW.date().isoformat()
    timer = next(n for n in doc.nodes if n.type == "timer")
    assert timer.data.dueAt > NOW


def person(db: Database, username: str = "admin", role: str = "admin") -> Person:
    created = Person(id=username, username=username, name=username.title(), role=role)
    SqliteUserRepo(db).add(created, "hash")
    return created


def test_first_read_creates_the_welcome_board_once_per_person():
    db = Database(":memory:")
    repo = SqliteBoardRepo(db)
    admin, ann = person(db), person(db, "ann", "member")
    [board], _ = list_boards(admin, repo, NOW)
    assert (board.name, board.my_role, board.owner.id) == (WELCOME_NAME, "owner", "admin")
    assert [b.id for b in list_boards(admin, repo, NOW)[0]] == [board.id]
    [own], _ = list_boards(ann, repo, NOW)
    assert own.id != board.id and own.owner.id == "ann"


def test_deleting_every_board_does_not_bring_it_back():
    db = Database(":memory:")
    repo, admin = SqliteBoardRepo(db), person(db)
    [board], _ = list_boards(admin, repo, NOW)
    repo.delete(board.id)
    assert list_boards(admin, repo, NOW) == ([], [])


def test_someone_who_made_a_board_is_never_welcomed():
    db = Database(":memory:")
    repo, admin = SqliteBoardRepo(db), person(db)
    repo.delete(repo.create("Q4", BoardDoc(), admin.id))
    assert repo.create_welcome(admin.id, WELCOME_NAME, BoardDoc()) is None


def test_upgrade_gives_old_boards_to_the_admin_without_a_second_welcome(tmp_path):
    path = str(tmp_path / "app.db")
    # A database from before the welcome board: schema version 2 with one board.
    old = sqlite3.connect(path)
    old.executescript(
        "CREATE TABLE boards (id TEXT PRIMARY KEY, name TEXT, doc TEXT, version INTEGER,"
        " created_at TEXT, updated_at TEXT);"
        "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
        "INSERT INTO boards VALUES ('b', 'Q4', '{}', 1, 'x', 'x');"
        "PRAGMA user_version = 2;"
    )
    old.close()
    db = Database(path)
    users, repo = SqliteUserRepo(db), SqliteBoardRepo(db)
    admin = person(db)
    adopt_orphans(users, SqliteMemberRepo(db), SqliteCredentialRepo(db))
    [board], _ = list_boards(admin, repo, NOW)
    assert (board.id, board.owner.id) == ("b", "admin")
    repo.delete("b")
    assert list_boards(admin, repo, NOW) == ([], [])


def test_concurrent_first_reads_create_one_board():
    db = Database(":memory:")
    repo, admin = SqliteBoardRepo(db), person(db)
    with ThreadPoolExecutor(8) as pool:
        list(pool.map(lambda _: list_boards(admin, repo, NOW), range(8)))
    assert len(repo.listing(admin.id)) == 1
