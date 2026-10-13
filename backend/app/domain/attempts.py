import threading
from collections import deque

_KEEP_WINDOWS = 1024


class MemoryAttempts:
    """The `Attempts` port in the memory of one process: for tests and a single process."""

    def __init__(self) -> None:
        self._events: dict[tuple[str, str], deque[float]] = {}
        self._windows: dict[tuple[str, str], tuple[float, int]] = {}
        self._lock = threading.Lock()

    def _kept(self, scope: str, key: str, since: float) -> deque[float]:
        events = self._events.setdefault((scope, key), deque())
        while events and events[0] <= since:
            events.popleft()
        return events

    def recent(self, scope: str, key: str, since: float) -> tuple[int, float]:
        with self._lock:
            events = self._kept(scope, key, since)
            if not events:
                del self._events[(scope, key)]
                return 0, 0.0
            return len(events), events[0]

    def add(self, scope: str, key: str, at: float, since: float) -> None:
        with self._lock:
            self._kept(scope, key, since).append(at)

    def add_under(self, scope: str, key: str, limit: int, at: float, since: float) -> float | None:
        with self._lock:
            events = self._kept(scope, key, since)
            if len(events) >= limit:
                return events[0]
            events.append(at)
            return None

    def spend(self, scope: str, key: str, limit: int, window_s: float, at: float) -> float | None:
        with self._lock:
            opened, used = self._windows.get((scope, key), (at, 0))
            if at - opened >= window_s:
                opened, used = at, 0
            if (scope, key) not in self._windows and len(self._windows) >= _KEEP_WINDOWS:
                # Keys that went quiet would otherwise stay here for good.
                self._windows = {
                    k: w for k, w in self._windows.items() if k[0] != scope or at - w[0] < window_s
                }
            if used >= limit:
                return opened
            self._windows[(scope, key)] = (opened, used + 1)
            return None

    def drop(self, scope: str, key: str) -> None:
        with self._lock:
            self._windows.pop((scope, key), None)
