"""Personal API keys (spec 046): each signs one person in to one workspace, for a while."""

import secrets
import string
import threading
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.domain.accounts import (
    PER_USERNAME_FAILURES,
    PER_USERNAME_WINDOW_S,
    Limiter,
    Person,
    verify_password,
)
from app.domain.errors import (
    ApiDisabled,
    Forbidden,
    InvalidCredentials,
    KeyRefused,
    NotFound,
    TokenExpired,
    TokenRevoked,
    ValidationFailed,
)
from app.domain.ports import ApiKeyRepo, Attempts, UserRepo
from app.domain.sessions import token_hash

PREFIX = "tiko_"
_ALPHABET = string.ascii_letters + string.digits
_LENGTH = 40
# Shown in Settings next to the name, so two keys with one name can be told apart.
_SHOWN = 4
MAX_LIVE = 20
DAYS = (7, 30, 90, 365)
MAX_BOARDS = 100
# Bounds how long a revoked key still works in another process, as for sessions.
CACHE_S = 30.0
# Ended and expired keys answer with their reason this long, then their rows go.
KEPT_DAYS = 30

Scope = Literal["read", "write"]
EndReason = Literal["revoked", "signed_out", "removed"]


class ApiKey(BaseModel):
    id: str
    name: str
    scope: Scope
    boards: list[str] | None
    prefix: str
    created_at: str
    expires_at: str
    last_used_on: str | None = None


class StoredKey(BaseModel):
    key: ApiKey
    user_id: str
    workspace_id: str
    ended_at: str | None = None


class KeyIdentity(BaseModel):
    """What a request signed in with a key may do; the person comes next to it."""

    id: str
    name: str
    scope: Scope
    boards: list[str] | None
    workspace_id: str
    expires_at: str


class KeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    scope: Scope = "read"
    boards: list[str] | None = Field(default=None, min_length=1, max_length=MAX_BOARDS)
    days: Literal[7, 30, 90, 365] = 90
    password: str = Field(max_length=1024)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("enter a name")
        return value

    @field_validator("boards")
    @classmethod
    def _boards(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else list(dict.fromkeys(value))


def _iso(at: datetime) -> str:
    return at.isoformat(timespec="seconds")


def _at(value: str) -> datetime:
    return datetime.fromisoformat(value)


class ApiKeys:
    def __init__(
        self,
        repo: ApiKeyRepo,
        users: UserRepo,
        attempts: Attempts,
        enabled: Callable[[], bool],
        offered: bool = True,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repo = repo
        self._users = users
        # The workspace's switch, read in the request's workspace.
        self._enabled = enabled
        # False where anyone can sign up: a demo instance offers no keys.
        self._offered = offered
        self._clock = clock
        self._password = Limiter(
            "api-key-password",
            PER_USERNAME_FAILURES,
            PER_USERNAME_WINDOW_S,
            attempts=attempts,
        )
        self._cache: dict[str, tuple[KeyIdentity, Person, float]] = {}
        self._lock = threading.Lock()

    def enabled(self) -> bool:
        return self._offered and self._enabled()

    def create(self, person: Person, workspace: str, body: KeyIn) -> tuple[ApiKey, str]:
        if not self._offered or person.demo_expires_at:
            raise Forbidden("API keys are switched off here.")
        if not self._enabled():
            raise ApiDisabled("Your admin has switched API keys off.")
        now = self._clock()
        self._check_password(person, body.password, now.timestamp())
        if self._repo.count_live(person.id, workspace, _iso(now)) >= MAX_LIVE:
            raise ValidationFailed(f"You have {MAX_LIVE} keys. Revoke one first.")
        token = PREFIX + "".join(secrets.choice(_ALPHABET) for _ in range(_LENGTH))
        key = ApiKey(
            id=uuid.uuid4().hex,
            name=body.name,
            scope=body.scope,
            boards=body.boards,
            prefix=token[len(PREFIX) : len(PREFIX) + _SHOWN],
            created_at=_iso(now),
            expires_at=_iso(now + timedelta(days=body.days)),
        )
        self._repo.add(key, token_hash(token), person.id, workspace)
        return key, token

    def _check_password(self, person: Person, password: str, now: float) -> None:
        self._password.check(person.id, now)
        found = self._users.find(person.username.lower())
        if not found or not verify_password(password, found[1]):
            self._password.fail(person.id, now)
            raise InvalidCredentials("The password is wrong.")

    def list(self, user_id: str, workspace: str) -> list[ApiKey]:
        return self._repo.list(user_id, workspace)

    def live_count(self, workspace: str) -> int:
        return self._repo.count_workspace_live(workspace, _iso(self._clock()))

    def revoke(self, user_id: str, workspace: str, key_id: str) -> None:
        if not self._repo.end(key_id, user_id, workspace, _iso(self._clock()), "revoked"):
            raise NotFound("key not found")
        self._drop(lambda identity, _: identity.id == key_id)

    def end_for_person(self, user_id: str, reason: EndReason = "signed_out") -> None:
        """Every key of the person, in every workspace: they signed out everywhere, lost their
        password or were disabled."""
        self._repo.end_for_person(user_id, None, _iso(self._clock()), reason)
        self._drop(lambda _, person: person.id == user_id)

    def end_for_member(self, user_id: str, workspace: str | None) -> None:
        """The person left `workspace`; None, a request outside any, ends all their keys."""
        self._repo.end_for_person(user_id, workspace, _iso(self._clock()), "removed")
        self._drop(
            lambda identity, person: (
                person.id == user_id and workspace in (None, identity.workspace_id)
            )
        )

    def resolve(self, token: str) -> tuple[KeyIdentity, Person]:
        """The key's identity and person; raises a `KeyRefused` that names why not."""
        if not token.startswith(PREFIX):
            raise KeyRefused("Use an API key from Settings → API keys.")
        hashed = token_hash(token)
        now = self._clock()
        with self._lock:
            cached = self._cache.get(hashed)
        if cached and now.timestamp() - cached[2] < CACHE_S:
            identity, person, _ = cached
            if _at(identity.expires_at) <= now:
                raise TokenExpired("This API key expired. Make a new one in Settings.")
            return identity, person
        found = self._repo.get(hashed)
        if found is None:
            with self._lock:
                self._cache.pop(hashed, None)
            raise KeyRefused("Use an API key from Settings → API keys.")
        stored, person = found
        if stored.ended_at is not None or person.disabled:
            with self._lock:
                self._cache.pop(hashed, None)
            raise TokenRevoked("This API key was revoked. Make a new one in Settings.")
        if _at(stored.key.expires_at) <= now:
            raise TokenExpired("This API key expired. Make a new one in Settings.")
        today = now.date().isoformat()
        if stored.key.last_used_on != today:
            self._repo.touch(stored.key.id, today)
        identity = KeyIdentity(
            id=stored.key.id,
            name=stored.key.name,
            scope=stored.key.scope,
            boards=stored.key.boards,
            workspace_id=stored.workspace_id,
            expires_at=stored.key.expires_at,
        )
        with self._lock:
            self._cache[hashed] = (identity, person, now.timestamp())
        return identity, person

    def add_board(self, key: KeyIdentity, board_id: str) -> KeyIdentity:
        """A board made with a key for chosen boards joins them."""
        if key.boards is None:
            return key
        self._repo.add_board(key.id, board_id)
        self._drop(lambda identity, _: identity.id == key.id)
        return key.model_copy(update={"boards": [*key.boards, board_id]})

    def purge(self) -> int:
        """Rows of keys that ended or expired long enough ago to need no answer."""
        return self._repo.purge(_iso(self._clock() - timedelta(days=KEPT_DAYS)))

    def _drop(self, matches: Callable[[KeyIdentity, Person], bool]) -> None:
        with self._lock:
            for hashed in [h for h, (i, p, _) in self._cache.items() if matches(i, p)]:
                del self._cache[hashed]
