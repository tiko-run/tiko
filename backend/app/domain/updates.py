import threading
import time
from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel

from app.domain.errors import DependencyUnavailable
from app.domain.ports import ReleaseFeed

CHECK_EVERY_S = 1800
# A failed check (offline, GitHub blocked) is retried sooner, but not on every page load.
RETRY_FAILED_S = 600
# "Check now" is open to anyone signed in, so it shares one floor per instance.
CHECK_NOW_FLOOR_S = 60

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
