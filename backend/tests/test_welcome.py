from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime

from app.adapters.tasks.demo import DemoTaskProvider
from app.domain import planning_sample as sample
from app.domain.accounts import Person
from app.domain.boards import BoardDoc, check_doc, list_boards, task_refs
from app.domain.modules.gantt import GanttContent
from app.domain.tasks import split_ref
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


def person(store, username: str = "admin", role: str = "admin") -> Person:
    mod, db = store
    created = Person(id=username, username=username, name=username.title(), role=role)
    mod.UserRepo(db).add(created, "hash")
    return created


def test_first_read_creates_the_welcome_board_once_per_person(store):
    mod, db = store
    repo = mod.BoardRepo(db)
    admin, ann = person(store), person(store, "ann", "member")
    [board], _ = list_boards(admin, repo, NOW)
    assert (board.name, board.my_role, board.owner.id) == (WELCOME_NAME, "owner", "admin")
    assert [b.id for b in list_boards(admin, repo, NOW)[0]] == [board.id]
    [own], _ = list_boards(ann, repo, NOW)
    assert own.id != board.id and own.owner.id == "ann"


def test_deleting_every_board_does_not_bring_it_back(store):
    mod, db = store
    repo, admin = mod.BoardRepo(db), person(store)
    [board], _ = list_boards(admin, repo, NOW)
    repo.delete(board.id)
    assert list_boards(admin, repo, NOW) == ([], [])


def test_someone_who_made_a_board_is_never_welcomed(store):
    mod, db = store
    repo, admin = mod.BoardRepo(db), person(store)
    repo.delete(repo.create("Q4", BoardDoc(), admin.id))
    assert repo.create_welcome(admin.id, WELCOME_NAME, BoardDoc()) is None


def test_concurrent_first_reads_create_one_board(store):
    mod, db = store
    repo, admin = mod.BoardRepo(db), person(store)
    with ThreadPoolExecutor(8) as pool:
        list(pool.map(lambda _: list_boards(admin, repo, NOW), range(8)))
    assert len(repo.listing(admin.id)) == 1


def test_the_demo_welcome_gantt_plans_with_the_sample():
    doc = BoardDoc.model_validate(welcome_doc(NOW, demo=True))
    check_doc(doc)
    gantt = next(n for n in doc.nodes if n.type == "module").data.content
    GanttContent.model_validate(gantt)
    assert gantt["workingDays"] is True
    assert gantt["columns"] == ["priority", "size", "team"]
    stages = [s for row in gantt["rows"] for s in row.get("stages", [])]
    assert {s["type"] for s in stages} <= {t.id for t in sample.TYPES}
    people = {p.id: p for p in sample.people(NOW.date())}
    assert {who for s in stages for who in s["people"]} <= people.keys()
    for s in stages:
        assert date.fromisoformat(s["start"]).weekday() < 5
        assert date.fromisoformat(s["end"]).weekday() < 5
    # One stage overlaps its person's time off, so the Gantt shows the red outline.
    off = people[sample.CHLOE].off[0]
    assert any(
        sample.CHLOE in s["people"]
        and date.fromisoformat(s["start"]) <= off.end
        and date.fromisoformat(s["end"]) >= off.start
        for s in stages
    )


def test_the_self_hosted_welcome_gantt_has_no_stages():
    gantt = next(n for n in welcome_doc(NOW)["nodes"] if n["type"] == "module")["data"]["content"]
    assert all("stages" not in row for row in gantt["rows"])
    assert "columns" not in gantt and "workingDays" not in gantt
