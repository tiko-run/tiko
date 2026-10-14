import os
import sqlite3
import time
from pathlib import Path

import httpx
import pytest

from app.adapters.storage.sqlite import Database
from app.adapters.storage.update_backups import SqliteUpdateBackups
from app.adapters.updater.http import HttpUpdater, ensure_token
from app.config import Settings
from app.domain.errors import DependencyUnavailable, NotEnoughSpace, UpdateNotPossible
from app.domain.updates import OneClickUpdate, Release, UpdaterStatus, UpdateService
from app.main import create_app
from tests.conftest import signed_in
from tests.test_people import invite, join


class Feed:
    def __init__(self, version: str = "2999.1.1") -> None:
        self.version = version

    def releases(self) -> list[Release]:
        return [Release(version=self.version, url="https://example.test/r")]


class FakeUpdater:
    def __init__(self, state: str = "idle", down: bool = False) -> None:
        self.state = state
        self.down = down
        self.started: list[tuple[str, str, str]] = []

    def status(self) -> UpdaterStatus:
        if self.down:
            raise DependencyUnavailable("no updater")
        return UpdaterStatus(state=self.state)

    def start(self, version: str, current: str, backup: str) -> UpdaterStatus:
        self.started.append((version, current, backup))
        self.state = "running"
        return UpdaterStatus(state="running", step="download", target=version)


class FakeBackups:
    def __init__(self, free: int = 10**9, needed: int = 10**6) -> None:
        self.space = (free, needed)
        self.copies: list[str] = []

    def free_and_needed(self) -> tuple[int, int]:
        return self.space

    def copy_before_update(self, version: str) -> str:
        self.copies.append(version)
        return f"pre-update-{version}.db"


def one_click(updater=None, backups=None, latest="2026.11.1", hosting=None) -> OneClickUpdate:
    updates = UpdateService("2026.10.6", Feed(latest))
    return OneClickUpdate(updates, updater, backups or FakeBackups(), "2026.10.6", hosting)


def test_starts_after_a_backup():
    updater, backups = FakeUpdater(), FakeBackups()
    view = one_click(updater, backups).start()
    assert (view.available, view.status.state, view.status.target) == (True, "running", "2026.11.1")
    assert backups.copies == ["2026.10.6"]
    assert updater.started == [("2026.11.1", "2026.10.6", "pre-update-2026.10.6.db")]


def test_no_updater_means_by_hand():
    view = one_click(None, hosting="railway").view()
    assert (view.available, view.hosting, view.status) == (False, "railway", None)
    assert one_click(FakeUpdater(down=True)).view().available is False
    with pytest.raises(UpdateNotPossible):
        one_click(None).start()


def test_refuses_without_a_newer_release():
    with pytest.raises(UpdateNotPossible, match="no newer release"):
        one_click(FakeUpdater(), latest="2026.10.6").start()


def test_refuses_a_second_update():
    backups = FakeBackups()
    with pytest.raises(UpdateNotPossible, match="already running"):
        one_click(FakeUpdater(state="running"), backups).start()
    assert backups.copies == []


def test_refuses_without_room_for_the_backup():
    backups = FakeBackups(free=2_000_000, needed=50_000_000)
    with pytest.raises(NotEnoughSpace, match="needs 50 MB, and only 2 MB is free"):
        one_click(FakeUpdater(), backups).start()
    assert backups.copies == []


def test_backups_keep_the_newest_three(tmp_path: Path):
    db = Database(str(tmp_path / "app.db"))
    with db.transaction() as conn:
        conn.execute("CREATE TABLE t (x)")
    backups = SqliteUpdateBackups(db)
    folder = tmp_path / "backups"
    folder.mkdir()
    (folder / "app-20261001-000000.db").write_text("make backup")
    for n, version in enumerate(["2026.10.1", "2026.10.2", "2026.10.3", "2026.10.4"]):
        name = backups.copy_before_update(version)
        os.utime(folder / name, (time.time() + n, time.time() + n))
    names = sorted(p.name for p in folder.iterdir())
    assert names == [
        "app-20261001-000000.db",
        "pre-update-2026.10.2.db",
        "pre-update-2026.10.3.db",
        "pre-update-2026.10.4.db",
    ]
    with sqlite3.connect(folder / "pre-update-2026.10.4.db") as copy:
        assert copy.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    free, needed = backups.free_and_needed()
    assert free > 0 and needed > 0


def test_token_is_made_once(tmp_path: Path):
    path = tmp_path / "updater-token"
    first = ensure_token(path)
    assert len(first) > 30 and ensure_token(path) == first
    assert path.stat().st_mode & 0o777 == 0o600


def test_http_updater_sends_the_token_and_reads_the_status():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer tok"
        if request.method == "POST":
            return httpx.Response(409, json={"error": "busy"})
        return httpx.Response(200, json={"state": "running", "step": "download", "log": ["x"]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    updater = HttpUpdater("http://updater:8080/", "tok", client)
    assert updater.status().log == ["x"]
    with pytest.raises(UpdateNotPossible):
        updater.start("2026.11.1", "2026.10.6", "pre-update-2026.10.6.db")


def test_http_updater_unreachable():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no such host")

    updater = HttpUpdater(
        "http://updater:8080", "tok", httpx.Client(transport=httpx.MockTransport(handler))
    )
    with pytest.raises(DependencyUnavailable):
        updater.status()


def test_update_routes_admin_only():
    updater = FakeUpdater()
    app = create_app(Settings(db_path=":memory:"), release_feed=Feed(), updater=updater)
    admin = signed_in(app)
    member = join(app, invite(admin))
    assert member.get("/api/update").json() == {
        "available": True,
        "hosting": None,
        "status": {
            "state": "idle",
            "step": None,
            "target": None,
            "downloaded": 0,
            "total": 0,
            "error": None,
            "log": [],
        },
    }
    assert member.post("/api/update").status_code == 403
    assert updater.started == []


def test_update_route_without_updater():
    app = create_app(Settings(db_path=":memory:", updater_url="http://updater:8080"))
    body = signed_in(app).get("/api/update").json()
    assert (body["available"], body["status"]) == (False, None)
