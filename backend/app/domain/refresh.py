import math
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel

from app.domain.boards import task_refs
from app.domain.errors import (
    DomainError,
    NotFound,
    TrackerRateLimited,
    TrackerUnavailable,
    TrackerUnreachable,
)
from app.domain.ports import BoardRepo, SnapshotRepo, TaskProvider
from app.domain.tasks import Task, now_iso, split_ref, task_ref

MAX_BACKOFF_S = 300


class SourceError(BaseModel):
    code: str
    message: str
    retry_after: int | None = None


class SourceStatus(BaseModel):
    """How the last poll of one tracker went."""

    id: str
    name: str
    state: Literal["ok", "error"]
    synced_at: str | None
    error: SourceError | None = None
    # What a person should know about this tracker's sync while it works.
    note: str | None = None


@dataclass
class _Source:
    fails: int = 0
    backoff_until: float = 0.0
    synced_at: str | None = None
    error: SourceError | None = None


class RefreshService:
    """One batched poll per tracker per call; backoff is per tracker and shared by all boards."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._sources: dict[str, _Source] = {}
        # Sync routes run on a threadpool; two tabs must not both pass the backoff check.
        self._lock = threading.Lock()

    def reset(self) -> None:
        """Called when settings change: a fixed URL or token deserves an immediate try."""
        with self._lock:
            for source in self._sources.values():
                source.fails = 0
                source.backoff_until = 0.0

    def refresh(
        self,
        board_id: str,
        interval_s: int,
        boards: BoardRepo,
        snapshots: SnapshotRepo,
        providers: dict[str, TaskProvider],
        default_source: str,
        owner: str = "",
        tokens_before: dict[str, str | None] | None = None,
        tokens_now: Callable[[], dict[str, str | None]] = dict,
        max_age_s: float | None = None,
    ) -> tuple[dict[str, Task], list[SourceStatus]]:
        """Polls each tracker of the board once with the providers of `owner`; each person's
        tracker errors and backoff are their own, since each uses their own token. A failing
        tracker leaves the others alone. Tasks come back by ref.

        `tokens_before` stamps the tokens the providers were built with, `tokens_now` reads
        them again: a tracker whose token changed meanwhile has its tasks dropped.

        `max_age_s`: tasks cached more recently than this are not asked for again. A browser
        tab paces itself; a caller of the API may not."""
        record = boards.get(board_id)
        if record is None:
            raise NotFound("board not found")
        keys: dict[str, list[str]] = {}
        for ref in task_refs(record.doc, default_source):
            source_id, key = split_ref(ref)
            keys.setdefault(source_id, []).append(key)
        if max_age_s is not None:
            keys = _stale(keys, snapshots, max_age_s)
        # The instance's own tracker is reported even while the board has none of its tasks.
        keys.setdefault(default_source, [])
        tasks: list[Task] = []
        statuses: list[SourceStatus] = []
        with self._lock:
            for source_id, source_keys in keys.items():
                provider = providers.get(source_id)
                if provider is None:
                    tasks += _unknown(source_id, source_keys)
                    continue
                source = self._sources.setdefault(f"{source_id}:{owner}", _Source())
                if source_keys:
                    tasks += self._poll(source, source_keys, interval_s, provider)
                statuses.append(
                    SourceStatus(
                        id=source_id,
                        name=provider.source_name,
                        state="error" if source.error else "ok",
                        synced_at=source.synced_at,
                        error=source.error,
                        note=provider.source_note,
                    )
                )
        before = tokens_before or {}

        def changed() -> set[str]:
            now = tokens_now()
            return {source for source, stamp in before.items() if now.get(source) != stamp}

        # A token replaced or removed mid-poll cleared the cache; its tasks must not refill it.
        stale = changed()
        tasks = _kept([task for task in tasks if task.source not in stale], snapshots)
        snapshots.put_many(tasks)
        # A change that lands between the check and the write may have cleared the cache first.
        late = changed() - stale
        for source in late:
            snapshots.forget(source)
        tasks = [task for task in tasks if task.source not in late]
        return {task.ref: task for task in tasks}, statuses

    def _poll(
        self, source: _Source, keys: list[str], interval_s: int, provider: TaskProvider
    ) -> list[Task]:
        now = self._clock()
        if now < source.backoff_until:
            if source.error:
                source.error.retry_after = math.ceil(source.backoff_until - now)
            return []
        try:
            tasks = provider.poll(keys)
        except DomainError as exc:
            source.error = SourceError(code=exc.code, message=exc.message)
            # Only an overloaded tracker is spared; auth, config and network errors retry at
            # the normal pace, so a fixed token or a VPN coming back shows up on the next tick.
            if isinstance(exc, TrackerUnavailable | TrackerRateLimited) and not isinstance(
                exc, TrackerUnreachable
            ):
                source.fails += 1
                retry_after = exc.retry_after if isinstance(exc, TrackerRateLimited) else 0
                wait = min(MAX_BACKOFF_S, max(retry_after, interval_s * 2**source.fails))
                source.backoff_until = now + wait
                source.error.retry_after = wait
            return []
        source.fails = 0
        source.error = None
        source.synced_at = now_iso()
        return tasks


def _stale(
    keys: dict[str, list[str]], snapshots: SnapshotRepo, max_age_s: float
) -> dict[str, list[str]]:
    """Only the keys whose cached task is missing or older than `max_age_s`."""
    refs = [task_ref(source, key) for source, source_keys in keys.items() for key in source_keys]
    cached = snapshots.get_many(refs)
    since = datetime.now(UTC) - timedelta(seconds=max_age_s)
    stale: dict[str, list[str]] = {}
    for source, source_keys in keys.items():
        for key in source_keys:
            task = cached.get(task_ref(source, key))
            if task is None or datetime.fromisoformat(task.fetched_at) < since:
                stale.setdefault(source, []).append(key)
    return stale


def _unknown(source_id: str, keys: list[str]) -> list[Task]:
    """Tasks of a tracker this instance does not read, as on a board from elsewhere."""
    return [
        Task(source=source_id, key=key, state="not_connected", url="", fetched_at=now_iso())
        for key in keys
    ]


# A task its tracker cannot be asked about yet: what was last seen of it still says what it is.
_UNREAD = ("no_token", "not_connected")


def _kept(tasks: list[Task], snapshots: SnapshotRepo) -> list[Task]:
    unread = [task.ref for task in tasks if task.state in _UNREAD]
    if not unread:
        return tasks
    cached = snapshots.get_many(unread)
    out = []
    for task in tasks:
        last = cached.get(task.ref)
        if last is not None and last.summary:
            task = last.model_copy(update={"state": task.state})
        out.append(task)
    return out
