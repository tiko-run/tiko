import base64
import hashlib
import hmac
import math
import re
import secrets
import uuid
from functools import cache
from typing import Literal

from pydantic import BaseModel

from app.domain import onboarding
from app.domain.attempts import MemoryAttempts
from app.domain.errors import (
    AccountDisabled,
    InvalidCredentials,
    LastAdmin,
    NotFound,
    TooManyAttempts,
    ValidationFailed,
    WeakPassword,
)
from app.domain.onboarding import Onboarding, OnboardingChange
from app.domain.ports import Attempts, UserRepo
from app.domain.sessions import Sessions, iso

Role = Literal["admin", "member"]

USERNAME = re.compile(r"[A-Za-z0-9._-]{3,32}")
MIN_PASSWORD = 10
MAX_PASSWORD = 1024
MAX_NAME = 64
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}

PER_USERNAME_FAILURES = 10
PER_USERNAME_WINDOW_S = 15 * 60.0
# Backstop against guessing across many usernames; a per-IP limit is dodged by forging
# X-Forwarded-For.
INSTANCE_FAILURES = 30
INSTANCE_WINDOW_S = 60.0


class Person(BaseModel):
    id: str
    username: str
    name: str
    role: Role
    disabled: bool = False
    # Set for a demo visitor only: when they are deleted unless they come back or sign up.
    demo_expires_at: str | None = None


class PersonRecord(Person):
    last_sign_in_at: str | None
    created_at: str


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    params = "$".join(str(_SCRYPT[k]) for k in ("n", "r", "p"))
    b64 = base64.b64encode
    return f"scrypt${params}${b64(salt).decode()}${b64(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p)
        )
    except ValueError:
        return False
    return hmac.compare_digest(actual, expected)


@cache
def _dummy_hash() -> str:
    return hash_password(secrets.token_urlsafe(16))


def check_username(value: str) -> str:
    username = value.strip()
    if not USERNAME.fullmatch(username):
        raise ValidationFailed("username: 3 to 32 letters, digits, '.', '-' or '_'")
    return username


def check_name(value: str) -> str:
    name = value.strip()
    if not name or len(name) > MAX_NAME:
        raise ValidationFailed(f"name: 1 to {MAX_NAME} characters")
    return name


def check_password(value: str) -> str:
    if len(value) < MIN_PASSWORD or len(value) > MAX_PASSWORD:
        raise WeakPassword(f"Use at least {MIN_PASSWORD} characters.")
    return value


class Limiter:
    """Counts failures per key in a sliding window."""

    def __init__(
        self,
        scope: str,
        limit: int,
        window_s: float,
        message: str = "too many wrong passwords, try again later",
        attempts: Attempts | None = None,
    ) -> None:
        self._scope = scope
        self._limit = limit
        self._window_s = window_s
        self._message = message
        self._attempts = attempts or MemoryAttempts()

    def _refuse(self, oldest: float, now: float) -> TooManyAttempts:
        wait = math.ceil(oldest + self._window_s - now)
        return TooManyAttempts(self._message, max(wait, 1))

    def check(self, key: str, now: float) -> None:
        count, oldest = self._attempts.recent(self._scope, key, now - self._window_s)
        if count >= self._limit:
            raise self._refuse(oldest, now)

    def fail(self, key: str, now: float) -> None:
        self._attempts.add(self._scope, key, now, now - self._window_s)

    def spend(self, key: str, now: float) -> None:
        """Checks and counts in one step, for a budget of requests instead of failures."""
        oldest = self._attempts.add_under(self._scope, key, self._limit, now, now - self._window_s)
        if oldest is not None:
            raise self._refuse(oldest, now)


class Accounts:
    def __init__(
        self, users: UserRepo, sessions: Sessions, attempts: Attempts | None = None
    ) -> None:
        self._users = users
        self._sessions = sessions
        attempts = attempts or MemoryAttempts()
        self._per_username = Limiter(
            "sign-in", PER_USERNAME_FAILURES, PER_USERNAME_WINDOW_S, attempts=attempts
        )
        self._instance = Limiter(
            "sign-in-instance", INSTANCE_FAILURES, INSTANCE_WINDOW_S, attempts=attempts
        )

    def create(self, username: str, name: str, password: str, role: Role) -> Person:
        person = Person(
            id=uuid.uuid4().hex, username=check_username(username), name=check_name(name), role=role
        )
        self._users.add(person, hash_password(password))
        return person

    def sign_in(self, username: str, password: str, now: float) -> str:
        key = username.strip().lower()
        self._instance.check("", now)
        self._per_username.check(key, now)
        found = self._users.find(key)
        # An unknown username costs a full hash too, so timing does not tell which exist.
        valid = verify_password(password, found[1] if found else _dummy_hash())
        if not found or not valid:
            self._instance.fail("", now)
            self._per_username.fail(key, now)
            raise InvalidCredentials("Wrong username or password.")
        person = found[0]
        if person.disabled:
            raise AccountDisabled("This account is disabled. Ask your admin.")
        self._users.touch_sign_in(person.id)
        return self._sessions.start(person.id, now)

    def came_back(self, user_id: str) -> None:
        """Counts as a sign-in: the person proved who they are by a link instead of a password."""
        self._users.touch_sign_in(user_id)

    def update(self, person: Person, name: str | None, username: str | None) -> Person:
        changed = person.model_copy(
            update={
                "name": check_name(name) if name is not None else person.name,
                "username": check_username(username) if username is not None else person.username,
            }
        )
        self._users.update(changed)
        self._sessions.forget(person.id)
        return changed

    def onboarding(self, user_id: str) -> Onboarding:
        return onboarding.read(self._users, user_id)

    def change_onboarding(self, user_id: str, patch: OnboardingChange, now: float) -> Onboarding:
        return onboarding.change(self._users, user_id, patch, iso(now))

    def get(self, user_id: str) -> Person:
        person = self._users.get(user_id)
        if person is None:
            raise NotFound("person not found")
        return person

    def people(self) -> list[PersonRecord]:
        return self._users.list()

    def change(self, user_id: str, role: Role | None, disabled: bool | None) -> PersonRecord:
        """Admin changes to a person; the last active admin cannot be demoted or disabled."""
        person = self.get(user_id)
        if person.demo_expires_at:
            raise NotFound("person not found")
        loses_admin = person.role == "admin" and not person.disabled
        loses_admin = loses_admin and (role == "member" or disabled is True)
        if loses_admin and self._users.active_admins() <= 1:
            raise LastAdmin("Make someone else an admin first.")
        if role is not None:
            self._users.set_role(user_id, role)
        if disabled is not None:
            self._users.set_disabled(user_id, disabled)
            if disabled:
                self._sessions.end_all(user_id)
        self._sessions.forget(user_id)
        return next(record for record in self._users.list() if record.id == user_id)

    def set_password(self, user_id: str, password: str) -> None:
        """Sets a password without the current one, as a reset link does; ends every session."""
        self._users.set_password(user_id, hash_password(check_password(password)))
        self._sessions.end_all(user_id)

    def change_password(self, person: Person, current: str, new: str, keep_token: str) -> None:
        found = self._users.find(person.username.lower())
        if not found or not verify_password(current, found[1]):
            raise InvalidCredentials("The current password is wrong.")
        self._users.set_password(person.id, hash_password(check_password(new)))
        self._sessions.end_all(person.id, keep_token=keep_token)
