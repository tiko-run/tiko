import asyncio
import re
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters.stats.http import HttpStatsSender
from app.adapters.stats.mock import MockStatsSender
from app.config import Settings
from app.domain.errors import DependencyUnavailable
from app.domain.usage import Ping, Privacy, bucket
from app.main import create_app
from app.version import VERSION
from tests.conftest import signed_in

GUIDE = Path(__file__).parents[2] / "docs/guide/src/content/docs/privacy.md"


def app_with(sender=None, **settings):
    sender = sender or MockStatsSender()
    settings = {
        "db_path": ":memory:",
        "tiko_error_reports": None,
        "tiko_error_reports_dsn": "",
        **settings,
    }
    app = create_app(Settings(**settings), stats_sender=sender)
    return app, sender


class Down:
    def send(self, body: dict) -> None:
        raise DependencyUnavailable("collector down")


@pytest.mark.parametrize(
    ("count", "expected"),
    [(0, "0"), (1, "1"), (2, "2-5"), (5, "2-5"), (6, "6-20"), (21, "21-100"), (101, "100+")],
)
def test_bucket(count, expected):
    assert bucket(count) == expected


def test_ping_sends_only_the_documented_fields():
    app, sender = app_with()
    signed_in(app)
    assert app.state.privacy.send_ping() is True
    body = sender.sent[0]
    assert set(body) == {
        "kind", "schema", "instance_id", "version", "deploy", "arch",
        "trackers", "people", "boards", "boards_active", "os", "updater",
    }  # fmt: skip
    assert body["kind"] == "ping"
    assert body["schema"] == 2
    assert body["version"] == VERSION
    assert body["deploy"] == "compose"
    assert body["people"] == "1"
    assert body["updater"] is False


def test_instance_id_is_random_and_kept():
    app, sender = app_with()
    app.state.privacy.send_ping()
    app.state.privacy.send_ping()
    first, second = (body["instance_id"] for body in sender.sent)
    assert first == second
    assert re.fullmatch(r"[0-9a-f-]{36}", first)
    other, _ = app_with()
    assert other.state.privacy.instance_id() != first


class Counts:
    def people(self) -> int:
        return 3

    def boards(self) -> int:
        return 0

    def boards_active(self, since: str) -> int:
        return 0

    def sources(self) -> set[str]:
        return {"jira", "github", "something-new"}


def test_trackers_are_named_kinds_without_urls():
    sender = MockStatsSender()
    stats = Privacy(Repo(), Counts(), sender, "1", "compose", "arm64", updater=True)
    ping = stats.ping()
    assert ping.trackers == ["github", "jira_dc"]
    assert (ping.people, ping.boards, ping.updater) == ("2-5", "0", True)


class Repo:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get_all(self) -> dict[str, str]:
        return dict(self.values)

    def set_many(self, values: dict[str, str | None]) -> None:
        self.values.update({k: v for k, v in values.items() if v is not None})


def test_off_by_the_admin_sends_nothing():
    app, sender = app_with()
    client = signed_in(app)
    assert client.put("/api/privacy", json={"usage_stats": False}).json()["usage_stats"] is False
    assert app.state.privacy.send_ping() is False
    assert sender.sent == []


def test_off_by_env_locks_the_switch():
    app, sender = app_with(tiko_usage_stats=False)
    client = signed_in(app)
    view = client.get("/api/privacy").json()
    assert view["usage_stats"] is False
    assert view["locked"] == ["usage_stats"]
    assert client.put("/api/privacy", json={"usage_stats": True}).status_code == 422
    assert app.state.privacy.send_ping() is False
    assert sender.sent == []


def test_preview_is_the_next_ping():
    app, sender = app_with()
    preview = signed_in(app).get("/api/privacy").json()["next_ping"]
    app.state.privacy.send_ping()
    assert preview == sender.sent[0]


def test_only_admins_see_privacy():
    app, _ = app_with()
    admin = signed_in(app)
    token = admin.post("/api/invites", json={"role": "member"}).json()["url"].split("=", 1)[1]
    member = TestClient(app)
    member.post(
        f"/api/invites/{token}/accept",
        json={"username": "ann", "name": "Ann Lee", "password": "long-enough-password"},
    )
    assert member.get("/api/privacy").status_code == 403
    assert member.put("/api/privacy", json={"usage_stats": False}).status_code == 403
    assert admin.get("/api/privacy").status_code == 200


def test_collector_down_is_quiet():
    app, _ = app_with(Down())
    assert app.state.privacy.send_ping() is False


def test_demo_instance_reports_demo():
    app, sender = app_with(tiko_demo=True)
    app.state.privacy.send_ping()
    assert sender.sent[0]["deploy"] == "demo"


def test_deploy_from_env():
    app, sender = app_with(tiko_deploy="installer")
    app.state.privacy.send_ping()
    assert sender.sent[0]["deploy"] == "installer"


def test_http_sender_posts_json_and_maps_failures():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(204)

    HttpStatsSender(
        "https://t.example/v1/events", httpx.Client(transport=httpx.MockTransport(handler))
    ).send({"kind": "ping"})
    assert seen[0].method == "POST"
    assert seen[0].read() == b'{"kind":"ping"}'
    failing = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    with pytest.raises(DependencyUnavailable):
        HttpStatsSender("https://t.example/v1/events", failing).send({})


def test_guide_lists_every_field():
    text = GUIDE.read_text()
    for field in ["kind", "schema", *Ping.model_fields]:
        name = "schema" if field == "schema_version" else field
        assert f"`{name}`" in text, f"privacy.md does not list `{name}`"


def test_ping_schedule_first_after_10_minutes_then_daily():
    from app.domain import usage
    from app.main import ping_daily

    app, sender = app_with()
    waits: list[float] = []
    now = [1_000_000.0]

    async def sleep(seconds: float) -> None:
        waits.append(seconds)
        now[0] += seconds
        if len(waits) == 3:
            raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(ping_daily(app.state.privacy, sleep=sleep, clock=lambda: now[0]))
    assert waits[0] == usage.FIRST_PING_S
    assert all(
        usage.PING_EVERY_S <= w <= usage.PING_EVERY_S + usage.PING_JITTER_S for w in waits[1:]
    )
    assert len(sender.sent) == 2


def test_processes_of_one_instance_share_the_id(tmp_path):
    db = str(tmp_path / "app.db")
    first, _ = app_with(db_path=db)
    second, _ = app_with(db_path=db)
    assert first.state.privacy.instance_id() == second.state.privacy.instance_id()


def test_guide_lists_every_install_field():
    text = GUIDE.read_text()
    fields = ["kind", "schema", "version", "os", "arch", "installer", "updater", "fresh"]
    for name in [*fields, "failed_step"]:
        assert f"`{name}`" in text, f"privacy.md does not list `{name}`"


def test_a_restart_sends_no_ping_before_a_day_has_passed(tmp_path):
    from app.domain import usage
    from app.main import ping_daily

    db = str(tmp_path / "app.db")
    first, sender = app_with(db_path=db)
    assert first.state.privacy.send_ping(now=1_000_000.0)
    now = [1_000_000.0 + 3600]
    sent_at: list[float] = []

    class Clocked(MockStatsSender):
        def send(self, body: dict) -> None:
            sent_at.append(now[0])

    second, _ = app_with(Clocked(), db_path=db)

    async def sleep(seconds: float) -> None:
        now[0] += seconds
        if len(sent_at) == 2:
            raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(ping_daily(second.state.privacy, sleep=sleep, clock=lambda: now[0]))
    # Started an hour after a ping, the API waits for the rest of the day, then once a day.
    day, jitter = usage.PING_EVERY_S, usage.PING_JITTER_S
    assert day <= sent_at[0] - 1_000_000.0 <= day + jitter
    assert sent_at[1] - sent_at[0] >= day


def test_boards_active_counts_only_boards_changed_lately():
    app, sender = app_with()
    client = signed_in(app)
    board_id = client.post("/api/boards", json={"name": "Plans"}).json()["id"]
    assert app.state.privacy.ping().boards_active == "0"
    client.put(f"/api/boards/{board_id}", json={"version": 1, "doc": {"nodes": []}})
    assert app.state.privacy.ping().boards_active == "1"


def test_os_comes_from_the_installer():
    app, sender = app_with(tiko_host_os="darwin")
    app.state.privacy.send_ping()
    assert sender.sent[0]["os"] == "darwin"
