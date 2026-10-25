import secrets
import threading
import uuid
from contextlib import AbstractContextManager
from datetime import UTC, datetime

from app.domain import planning_sample as sample
from app.domain.accounts import (
    Limiter,
    Person,
    address_key,
    check_name,
    check_password,
    check_username,
    hash_password,
)
from app.domain.attempts import MemoryAttempts
from app.domain.errors import DemoFull, NotFound
from app.domain.planning import Planning
from app.domain.ports import Attempts, LiveBoards, UserRepo
from app.domain.sessions import Sessions, iso
from app.domain.workspaces import in_workspace

VISITOR_TTL_S = 7 * 24 * 3600
# An account that changed nothing is what a bot leaves behind; it does not get the week.
UNTOUCHED_TTL_S = 3600
# Sign-up asks for no mail, so an account nobody comes back to is not kept for ever.
UNUSED_ACCOUNT_TTL_S = 90 * 24 * 3600
PER_ADDRESS = 5
PER_ADDRESS_WINDOW_S = 3600.0
MAX_ALIVE = 500
MAX_BOARDS = 3
CLEANUP_EVERY_S = 600
VISITOR_NAME = "Demo visitor"
# No password hashes to this, so a demo visitor cannot sign in by password.
NO_PASSWORD = "!"


def touch(users: UserRepo, user_id: str, now: float) -> str | None:
    """A demo visitor was here: their expiry moves on. Returns it, None for anyone else."""
    until = iso(now + VISITOR_TTL_S)
    return until if users.touch_demo(user_id, until) else None


def board_limit(person: Person, member_limit: int | None) -> int | None:
    """A demo visitor holds MAX_BOARDS, anyone else what the instance allows; admins any number."""
    if person.role == "admin":
        return None
    return MAX_BOARDS if person.demo_expires_at else member_limit


class DemoVisitors:
    """Temporary people of a demo instance: made in one click, each in a workspace of their
    own, deleted with it when they stay away."""

    def __init__(
        self,
        users: UserRepo,
        sessions: Sessions,
        live: LiveBoards,
        planning: Planning,
        max_alive: int = MAX_ALIVE,
        attempts: Attempts | None = None,
        creating: AbstractContextManager | None = None,
    ) -> None:
        self._users = users
        self._sessions = sessions
        self._live = live
        self._planning = planning
        self.max_alive = max_alive
        attempts = attempts or MemoryAttempts()
        self._per_address = Limiter(
            "demo-address",
            PER_ADDRESS,
            PER_ADDRESS_WINDOW_S,
            "Too many demos from this address, try again later.",
            attempts,
        )
        # Held across the processes of the instance when it runs several.
        self._creating = creating or threading.Lock()

    def create(self, address: str, now: float) -> str:
        """Makes a demo visitor and returns the token of their session."""
        key = address_key(address)
        # One at a time: requests that arrive together would all pass the same two checks.
        with self._creating:
            self._per_address.check(key, now)
            # A loop: a limit lowered under the people already here takes more than one place back.
            while self._users.demo_alive(iso(now)) >= self.max_alive:
                gone = self._users.evict_untouched_demo()
                if not gone[0]:
                    raise DemoFull("The demo is full right now. Try again later.")
                self._forget(*gone)
            person = Person(
                id=uuid.uuid4().hex,
                # "~" is outside the username rule: nobody can pick this name or sign in with it.
                username=f"~{secrets.token_hex(6)}",
                name=VISITOR_NAME,
                role="member",
                demo_expires_at=iso(now + VISITOR_TTL_S),
            )
            workspace = self._users.add_visitor(person, NO_PASSWORD)
            self._per_address.fail(key, now)
        # Their own copy, so they change it as they like; time off is dated from today.
        with in_workspace(workspace):
            today = datetime.fromtimestamp(now, UTC).date()
            self._planning.write_sample(sample.TYPES, sample.people(today))
        return self._sessions.start(person.id, now)

    def sign_up(self, person: Person, name: str, username: str, password: str) -> Person:
        """Makes a demo visitor a regular member: same person, workspace, boards and session."""
        changed = person.model_copy(
            update={
                "name": check_name(name),
                "username": check_username(username),
                "demo_expires_at": None,
            }
        )
        password_hash = hash_password(check_password(password))
        if not self._users.sign_up_demo(person.id, changed.username, changed.name, password_hash):
            raise NotFound("not found")
        # Open boards and the next request read the person again, now without the demo limits.
        self._sessions.forget(person.id)
        return changed

    def cleanup(self, now: float) -> int:
        """Deletes the demo visitors whose time is up and the accounts nobody signed in to for
        90 days; returns how many people went."""
        # The expiry is always a week after the last request, so one who changed nothing
        # and was last here an hour ago has this much of it left.
        untouched = iso(now + VISITOR_TTL_S - UNTOUCHED_TTL_S)
        gone = self._users.delete_expired_demo(iso(now), untouched)
        self._forget(*gone)
        unused = self._users.delete_unused_members(iso(now - UNUSED_ACCOUNT_TTL_S))
        self._forget(*unused)
        return len(gone[0]) + len(unused[0])

    def _forget(self, user_ids: list[str], board_ids: list[str]) -> None:
        for user_id in user_ids:
            self._sessions.end_all(user_id)
        for board_id in board_ids:
            self._live.recheck_board(board_id)
            self._live.end_public(board_id)
