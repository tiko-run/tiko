import pytest

from app.adapters.tasks.demo import DemoTaskProvider
from app.domain.boards import BoardDoc
from app.domain.errors import VersionConflict
from tests.conftest import add_person


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
