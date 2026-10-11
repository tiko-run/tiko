import pytest

from app.adapters.storage.sqlite import Database, SqliteBoardRepo, SqliteSnapshotRepo
from app.adapters.tasks.demo import DemoTaskProvider
from app.domain.boards import BoardDoc
from app.domain.errors import (
    JiraRateLimited,
    JiraUnauthorized,
    JiraUnavailable,
    JiraUnreachable,
    NotFound,
)
from app.domain.refresh import RefreshService

DOC = BoardDoc.model_validate(
    {
        "nodes": [
            {"id": "a", "type": "task_card", "position": {"x": 0, "y": 0}, "data": {"key": k}}
            for k in ("DEMO-1", "DEMO-2")
        ]
    }
)


class Flaky:
    """Demo provider that fails with the queued errors before answering."""

    base_host = "jira.example.com"
    source_id = "jira"
    source_name = "Jira Data Center"
    source_note = None

    def __init__(self, *errors: Exception) -> None:
        self.errors = list(errors)
        self.calls = 0
        self.demo = DemoTaskProvider()

    def poll(self, keys):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return [task.model_copy(update={"source": self.source_id}) for task in self.demo.poll(keys)]


@pytest.fixture
def repos():
    db = Database(":memory:")
    boards = SqliteBoardRepo(db)
    board_id = boards.create("b", BoardDoc(), "owner")
    boards.save(board_id, 1, DOC)
    return board_id, boards, SqliteSnapshotRepo(db)


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def poll(service, repos, provider, board_id=None):
    default_id, boards, snapshots = repos
    tasks, (status,) = service.refresh(
        board_id or default_id, 30, boards, snapshots, {"jira": provider}, "jira"
    )
    return tasks, status


def test_one_poll_stores_snapshots(repos):
    _, _, snapshots = repos
    provider = Flaky()
    tasks, status = poll(RefreshService(), repos, provider)
    assert set(tasks) == {"jira:DEMO-1", "jira:DEMO-2"}
    assert provider.calls == 1
    assert (status.id, status.state, status.error) == ("jira", "ok", None)
    assert status.synced_at
    assert set(snapshots.get_many(["jira:DEMO-1", "jira:DEMO-2"])) == {"jira:DEMO-1", "jira:DEMO-2"}


def test_failure_is_a_source_status_not_an_exception(repos):
    service = RefreshService(Clock())
    poll(service, repos, Flaky())
    tasks, status = poll(service, repos, Flaky(JiraUnauthorized("Jira returned 401")))
    assert tasks == {}
    assert status.state == "error"
    assert (status.error.code, status.error.message) == ("jira_unauthorized", "Jira returned 401")
    # The last good sync time stays, so the UI can say how stale the cards are.
    assert status.synced_at


def test_backoff_doubles_and_resets(repos):
    clock = Clock()
    service = RefreshService(clock)
    provider = Flaky(JiraUnavailable("down"), JiraUnavailable("down"))

    _, status = poll(service, repos, provider)
    assert status.error.retry_after == 60
    clock.now += 59
    _, status = poll(service, repos, provider)
    assert (status.state, status.error.message, status.error.retry_after) == ("error", "down", 1)
    assert provider.calls == 1

    clock.now += 1
    _, status = poll(service, repos, provider)
    assert status.error.retry_after == 120
    clock.now += 119
    poll(service, repos, provider)
    assert provider.calls == 2

    clock.now += 1
    tasks, status = poll(service, repos, provider)
    assert tasks and status.state == "ok"

    # After a success the next outage starts again from interval × 2.
    provider.errors.append(JiraUnavailable("down"))
    _, status = poll(service, repos, provider)
    assert status.error.retry_after == 60


def test_unreachable_tracker_retries_at_normal_pace(repos):
    service = RefreshService(Clock())
    provider = Flaky(*[JiraUnreachable("Jira is unreachable")] * 3)
    for _ in range(3):
        _, status = poll(service, repos, provider)
        assert status.error.retry_after is None
    assert provider.calls == 3
    # The VPN is back: the very next tick syncs.
    tasks, status = poll(service, repos, provider)
    assert tasks and status.state == "ok"


def test_retry_after_and_cap(repos):
    clock = Clock()
    service = RefreshService(clock)
    provider = Flaky(JiraRateLimited("slow down", 500))
    _, status = poll(service, repos, provider)
    assert status.error.retry_after == 300
    clock.now += 299
    poll(service, repos, provider)
    assert provider.calls == 1
    clock.now += 1
    tasks, _ = poll(service, repos, provider)
    assert tasks


def test_auth_errors_do_not_back_off(repos):
    service = RefreshService(Clock())
    provider = Flaky(JiraUnauthorized("401"))
    poll(service, repos, provider)
    tasks, _ = poll(service, repos, provider)
    assert tasks


def test_failed_refresh_keeps_last_snapshot(repos):
    _, _, snapshots = repos
    service = RefreshService(Clock())
    poll(service, repos, Flaky())
    poll(service, repos, Flaky(JiraUnavailable("down")))
    assert set(snapshots.get_many(["jira:DEMO-1"])) == {"jira:DEMO-1"}


def test_missing_board(repos):
    with pytest.raises(NotFound):
        poll(RefreshService(), repos, Flaky(), board_id="nope")


def test_reset_clears_backoff(repos):
    service = RefreshService(Clock())
    poll(service, repos, Flaky(JiraUnavailable("down")))
    service.reset()
    tasks, _ = poll(service, repos, Flaky())
    assert tasks


def test_empty_board_reports_the_last_known_state(repos):
    _, boards, _ = repos
    service = RefreshService(Clock())
    empty = boards.create("empty", BoardDoc(), "owner")
    provider = Flaky()
    _, status = poll(service, repos, provider, board_id=empty)
    assert (status.state, provider.calls) == ("ok", 0)
    poll(service, repos, Flaky(JiraUnreachable("down")))
    _, status = poll(service, repos, provider, board_id=empty)
    assert status.state == "error"


def mixed_board(repos):
    """A card of the instance's tracker, a demo card with the same key, and one of a tracker
    this instance does not read."""
    _, boards, _ = repos
    cards = [("a", None), ("b", "demo"), ("c", "elsewhere")]
    doc = {
        "nodes": [
            {
                "id": node_id,
                "type": "task_card",
                "position": {"x": 0, "y": 0},
                "data": {"key": "DEMO-1"} | ({"source": source} if source else {}),
            }
            for node_id, source in cards
        ]
    }
    board_id = boards.create("mixed", BoardDoc(), "owner")
    boards.save(board_id, 1, BoardDoc.model_validate(doc))
    return board_id


def test_each_tracker_of_the_board_is_polled_once(repos):
    _, boards, snapshots = repos
    jira, demo = Flaky(), DemoTaskProvider()
    tasks, statuses = RefreshService().refresh(
        mixed_board(repos), 30, boards, snapshots, {"jira": jira, "demo": demo}, "jira"
    )
    assert {ref: task.state for ref, task in tasks.items()} == {
        "jira:DEMO-1": "ok",
        "demo:DEMO-1": "ok",
        "elsewhere:DEMO-1": "not_found",
    }
    assert jira.calls == 1
    assert sorted(status.id for status in statuses) == ["demo", "jira"]


def test_a_failing_tracker_leaves_the_others_alone(repos):
    """SC-003."""
    _, boards, snapshots = repos
    providers = {"jira": Flaky(JiraUnavailable("down")), "demo": DemoTaskProvider()}
    tasks, statuses = RefreshService(Clock()).refresh(
        mixed_board(repos), 30, boards, snapshots, providers, "jira"
    )
    assert "demo:DEMO-1" in tasks and "jira:DEMO-1" not in tasks
    assert {status.id: status.state for status in statuses} == {"jira": "error", "demo": "ok"}
