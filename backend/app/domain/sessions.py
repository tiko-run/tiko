from __future__ import annotations

import hashlib
import secrets
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from app.domain.ports import LiveBoards, SessionRepo

if TYPE_CHECKING:
    from app.domain.accounts import Person

SESSION_TTL_S = 30 * 24 * 3600
# Bounds how long a revoked session or a disabled person still gets through on another worker.
CACHE_S = 30.0
# A demo visitor's expiry moves on with their requests, but not on every one.
TOUCH_EVERY_S = 60.0


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).isoformat(timespec="seconds")


def _ts(iso: str) -> float:
    return datetime.fromisoformat(iso).timestamp()


class Sessions:
    """Random cookie tokens; only their hashes are stored, so a leaked database signs no one in."""

    def __init__(
        self,
        repo: SessionRepo,
        live: LiveBoards | None = None,
        touch_demo: Callable[[str, float], str | None] | None = None,
    ) -> None:
        self._repo = repo
        # Moves a demo visitor's expiry; without it the instance is not a demo and has none.
        self._touch_demo = touch_demo
        self._touched: dict[str, float] = {}
        # Open sockets outlive the 30 s cache, so they are told about every ended session.
        self._live = live
        self._cache: dict[str, tuple[Person, float, float]] = {}
        self._lock = threading.Lock()

    def start(self, user_id: str, now: float) -> str:
        token = secrets.token_urlsafe(32)
        self._repo.delete_expired(iso(now))
        self._repo.add(token_hash(token), user_id, iso(now + SESSION_TTL_S), iso(now))
        return token

    def resolve(self, token: str, now: float) -> Person | None:
        key = token_hash(token)
        with self._lock:
            cached = self._cache.get(key)
        if cached and now - cached[2] < CACHE_S:
            person, expires, _ = cached
            return person if expires > now and self._alive(person, now) else None
        found = self._repo.get(key)
        if found is None or _ts(found[1]) <= now or found[0].disabled:
            with self._lock:
                self._cache.pop(key, None)
            return None
        person = self._touch(key, found[0], now)
        if person is None:
            with self._lock:
                self._cache.pop(key, None)
            return None
        with self._lock:
            self._cache[key] = (person, _ts(found[1]), now)
        return person

    def _alive(self, person: Person, now: float) -> bool:
        return person.demo_expires_at is None or _ts(person.demo_expires_at) > now

    def _touch(self, key: str, person: Person, now: float) -> Person | None:
        """A demo visitor who is still in time, with the expiry moved on; anyone else as is."""
        if person.demo_expires_at is None:
            return person
        if self._touch_demo is None or not self._alive(person, now):
            return None
        with self._lock:
            fresh = now - self._touched.get(person.id, 0.0) < TOUCH_EVERY_S
            if not fresh:
                self._touched[person.id] = now
        if fresh:
            return person
        expires = self._touch_demo(person.id, now)
        if expires is None:
            # They signed up or were deleted between the read and the touch: the session tells.
            again = self._repo.get(key)
            return again[0] if again else None
        return person.model_copy(update={"demo_expires_at": expires})

    def end(self, token: str) -> None:
        key = token_hash(token)
        self._repo.delete(key)
        with self._lock:
            self._cache.pop(key, None)
        if self._live:
            self._live.end_session(token)

    def uncache(self, token: str) -> None:
        """The session ended in another process: the next request reads it fresh."""
        with self._lock:
            self._cache.pop(token_hash(token), None)

    def uncache_person(self, user_id: str, *_: object) -> None:
        """The person's sessions or record changed in another process."""
        self._forget(user_id)

    def end_all(self, user_id: str, keep_token: str | None = None) -> None:
        self._repo.delete_for_user(user_id, token_hash(keep_token) if keep_token else None)
        self._forget(user_id)
        if self._live:
            self._live.end_person(user_id, keep_token)

    def forget(self, user_id: str) -> None:
        """The person's record changed: the next request and their sockets read it fresh."""
        self._forget(user_id)
        if self._live:
            self._live.recheck_person(user_id)

    def _forget(self, user_id: str) -> None:
        with self._lock:
            self._touched.pop(user_id, None)
            for key in [k for k, v in self._cache.items() if v[0].id == user_id]:
                del self._cache[key]
