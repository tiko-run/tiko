import threading
import time
from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel

from app.domain.errors import DependencyUnavailable, NotEnoughSpace, UpdateNotPossible
from app.domain.ports import ReleaseFeed, UpdateBackups, Updater

CHECK_EVERY_S = 1800
# A failed check (offline, GitHub blocked) is retried sooner, but not on every page load.
RETRY_FAILED_S = 600
# "Check now" is open to anyone signed in, and without a token GitHub counts every call, a 304 too,
# against the 60 an hour this address also spends on GitHub issue cards.
CHECK_NOW_FLOOR_S = 300

Level = Literal["feature", "hotfix", "breaking", "security"]
LEVELS: tuple[Level, ...] = ("feature", "hotfix", "breaking", "security")
# The first line of a version's section in CHANGELOG.md, written by scripts/release.sh.
LEVEL_LINES: dict[str, Level] = {
    "**Hotfix.**": "hotfix",
    "**Breaking changes.**": "breaking",
    "**Security release.**": "security",
}


class Release(BaseModel):
    version: str
    url: str
    level: Level = "feature"


class VersionView(BaseModel):
    version: str
    update_check: bool
    latest: Release | None
    update_available: bool
    # The highest level among the releases newer than the running one.
    level: Level | None
    newer: list[Release]


def level_of(notes: str) -> Level:
    first = next((line.strip() for line in notes.splitlines() if line.strip()), "")
    return LEVEL_LINES.get(first, "feature")


def _calver(version: str) -> tuple[int, ...] | None:
    try:
        return tuple(int(part) for part in version.removeprefix("v").split("."))
    except ValueError:
        return None


def is_newer(candidate: str, current: str) -> bool:
    new, old = _calver(candidate), _calver(current)
    return new is not None and old is not None and new > old


class UpdateService:
    """The running version and, when checks are on, the releases published after it."""

    def __init__(
        self,
        current: str,
        feed: ReleaseFeed | None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._current = current
        self._feed = feed
        self._clock = clock
        self._releases: list[Release] = []
        self._next_check = 0.0
        self._last_ask = float("-inf")
        self._lock = threading.Lock()

    def view(self) -> VersionView:
        return self._view(force=False)

    def check_now(self) -> VersionView:
        return self._view(force=True)

    def _view(self, force: bool) -> VersionView:
        releases = sorted(
            (r for r in self._fetch(force) if _calver(r.version)),
            key=lambda r: _calver(r.version) or (),
            reverse=True,
        )
        newer = [r for r in releases if is_newer(r.version, self._current)]
        return VersionView(
            version=self._current,
            update_check=self._feed is not None,
            latest=releases[0] if releases else None,
            update_available=bool(newer),
            level=max((r.level for r in newer), key=LEVELS.index) if newer else None,
            newer=newer,
        )

    def _fetch(self, force: bool) -> list[Release]:
        if self._feed is None:
            return []
        with self._lock:
            now = self._clock()
            due = now >= self._next_check or (force and now >= self._last_ask + CHECK_NOW_FLOOR_S)
            if due:
                self._last_ask = now
                try:
                    self._releases = self._feed.releases()
                    self._next_check = now + CHECK_EVERY_S
                except DependencyUnavailable:
                    self._next_check = now + RETRY_FAILED_S
            return self._releases


class UpdaterStatus(BaseModel):
    state: Literal["idle", "running", "done", "failed"]
    step: str | None = None
    target: str | None = None
    downloaded: int = 0
    total: int = 0
    error: str | None = None
    log: list[str] = []


class UpdateView(BaseModel):
    # False: no updater answers, so About shows how to update by hand.
    available: bool
    # Where the instance runs when a platform says so; it updates by a redeploy there.
    hosting: Literal["railway", "render"] | None
    status: UpdaterStatus | None


class OneClickUpdate:
    """Starts an update through the updater service, after a backup of the database."""

    def __init__(
        self,
        updates: UpdateService,
        updater: Updater | None,
        backups: UpdateBackups,
        current: str,
        hosting: Literal["railway", "render"] | None = None,
    ) -> None:
        self._updates = updates
        self._updater = updater
        self._backups = backups
        self._current = current
        self._hosting = hosting

    def view(self) -> UpdateView:
        if self._updater is None:
            return UpdateView(available=False, hosting=self._hosting, status=None)
        try:
            status = self._updater.status()
        except DependencyUnavailable:
            return UpdateView(available=False, hosting=self._hosting, status=None)
        return UpdateView(available=True, hosting=self._hosting, status=status)

    def start(self) -> UpdateView:
        if self._updater is None:
            raise UpdateNotPossible("One-click updates are off on this instance.")
        latest = self._updates.view().latest
        if latest is None or not is_newer(latest.version, self._current):
            raise UpdateNotPossible("There is no newer release to update to.")
        if self._updater.status().state == "running":
            raise UpdateNotPossible("An update is already running.")
        free, needed = self._backups.free_and_needed()
        if free < needed:
            raise NotEnoughSpace(
                f"The backup before the update needs {_mb(needed)}, "
                f"and only {_mb(free)} is free next to the database."
            )
        backup = self._backups.copy_before_update(self._current)
        status = self._updater.start(latest.version, self._current, backup)
        return UpdateView(available=True, hosting=self._hosting, status=status)


def _mb(size: int) -> str:
    return f"{max(1, round(size / 1_000_000))} MB"
