import shutil
from pathlib import Path

import httpx
import pytest

from app.adapters.storage.update_backups import SqliteUpdateBackups
from app.adapters.updater.http import HttpUpdater, ensure_token
from app.config import Settings
from app.domain.errors import DependencyUnavailable, NotEnoughSpace, UpdateNotPossible
from app.domain.updates import OneClickUpdate, Release, UpdaterStatus, UpdateService
from app.main import create_app
from tests.conftest import signed_in
from tests.test_people import invite, join


class Feed:
    def __init__(self, version: str = "2999.1.1", installer: tuple[str, ...] = ()) -> None:
        self.version = version
        self.installer = installer

    def releases(self) -> list[Release]:
        versions = {self.version, *self.installer}
        return [
            Release(version=v, url="https://example.test/r", installer=v in self.installer)
            for v in versions
        ]


class FakeUpdater:
    def __init__(self, state: str = "idle", down: bool = False) -> None:
        self.state = state
        self.down = down
        self.started: list[tuple[str, str]] = []

    def status(self) -> UpdaterStatus:
        if self.down:
            raise DependencyUnavailable("no updater")
        return UpdaterStatus(state=self.state)

    def start(self, version: str, current: str) -> UpdaterStatus:
        self.started.append((version, current))
        self.state = "running"
        return UpdaterStatus(state="running", step="download", target=version)


class FakeBackups:
    def __init__(self, free: int = 10**9, needed: int = 10**6) -> None:
        self.space = (free, needed)
        self.asked: list[str] = []

    def free_and_needed(self, version: str) -> tuple[int, int]:
        self.asked.append(version)
        return self.space


def one_click(
    updater=None, backups=None, latest="2026.11.1", hosting=None, installer=()
) -> OneClickUpdate:
    updates = UpdateService("2026.10.6", Feed(latest, installer))
    return OneClickUpdate(updates, updater, backups or FakeBackups(), "2026.10.6", hosting)


def test_starts_after_checking_room_for_the_backup():
    updater, backups = FakeUpdater(), FakeBackups()
    view = one_click(updater, backups).start()
    assert (view.available, view.status.state, view.status.target) == (True, "running", "2026.11.1")
    assert backups.asked == ["2026.10.6"]
    assert updater.started == [("2026.11.1", "2026.10.6")]


def test_unreachable_updater_answers_503():
    with pytest.raises(DependencyUnavailable):
        one_click(FakeUpdater(down=True)).start()


def test_no_updater_means_by_hand():
    view = one_click(None, hosting="railway").view()
    assert (view.available, view.hosting, view.status) == (False, "railway", None)
    assert one_click(FakeUpdater(down=True)).view().available is False
    with pytest.raises(UpdateNotPossible):
        one_click(None).start()


def test_refuses_without_a_newer_release():
    with pytest.raises(UpdateNotPossible, match="no newer release"):
        one_click(FakeUpdater(), latest="2026.10.6").start()


@pytest.mark.parametrize("marked", ["2026.11.1", "2026.10.9"])
def test_refuses_when_a_release_on_the_way_needs_the_installer(marked: str):
    updater = FakeUpdater()
    with pytest.raises(UpdateNotPossible, match="needs the installer"):
        one_click(updater, installer=(marked,)).start()
    assert updater.started == []


def test_an_older_marked_release_does_not_block():
    updater = FakeUpdater()
    one_click(updater, installer=("2026.10.1",)).start()
    assert updater.started == [("2026.11.1", "2026.10.6")]


def test_refuses_a_second_update():
    backups = FakeBackups()
    updater = FakeUpdater(state="running")
    with pytest.raises(UpdateNotPossible, match="already running"):
        one_click(updater, backups).start()
    assert updater.started == []


def test_refuses_without_room_for_the_backup():
    backups = FakeBackups(free=2_000_000, needed=50_000_000)
    updater = FakeUpdater()
    with pytest.raises(NotEnoughSpace, match="needs 50 MB, and only 2 MB is free"):
        one_click(updater, backups).start()
    assert updater.started == []


def test_room_for_the_backup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "app.adapters.storage.update_backups.shutil.disk_usage",
        lambda path: shutil._ntuple_diskusage(10_000, 5_000, 5_000),
    )
    db = tmp_path / "app.db"
    db.write_bytes(b"x" * 1000)
    (tmp_path / "app.db-wal").write_bytes(b"x" * 500)
    backups = SqliteUpdateBackups(str(db))
    assert backups.free_and_needed("2026.10.6") == (5_000, 1_800)
    (tmp_path / "backups").mkdir()
    (tmp_path / "backups" / "pre-update-2026.10.6.db").write_bytes(b"x" * 700)
    assert backups.free_and_needed("2026.10.6") == (5_700, 1_800)


def test_token_is_made_once(tmp_path: Path):
    path = tmp_path / "updater-token"
    first = ensure_token(path)
    assert len(first) > 30 and ensure_token(path) == first
    assert path.stat().st_mode & 0o777 == 0o600
    assert [p.name for p in tmp_path.iterdir()] == ["updater-token"]


def test_an_empty_token_is_made_again(tmp_path: Path):
    path = tmp_path / "updater-token"
    path.write_text("")
    assert len(ensure_token(path)) > 30


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
        updater.start("2026.11.1", "2026.10.6")


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
