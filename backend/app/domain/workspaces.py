from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Protocol

from app.domain.accounts import LAST_ADMIN, Person, Role
from app.domain.errors import LastAdmin, NotFound, ValidationFailed
from app.domain.ports import LiveBoards, UserRepo
from app.domain.sessions import Sessions

# The workspace the current request or job works in. Storage reads it; None: the default one.
# Threads of anyio and asyncio timers inherit it from where they were started.
current_workspace: ContextVar[str | None] = ContextVar("current_workspace", default=None)


@contextmanager
def in_workspace(workspace: str | None) -> Iterator[None]:
    token = current_workspace.set(workspace)
    try:
        yield
    finally:
        current_workspace.reset(token)


class WorkspaceLookup(Protocol):
    """Finds the workspace of a request before anything in it is read."""

    def of_board(self, board_id: str) -> str | None: ...

    def of_public_token(self, token: str) -> str | None: ...

    def of_person(self, user_id: str) -> str | None: ...

    def role_in(self, user_id: str, workspace: str) -> Role | None:
        """The person's role in the workspace, None when they are not a member."""
        ...

    def name(self, workspace: str) -> str | None: ...


class NoWorkspaces:
    """Storage without workspaces: every request works in the one database."""

    def of_board(self, board_id: str) -> str | None:
        return None

    def of_public_token(self, token: str) -> str | None:
        return None

    def of_person(self, user_id: str) -> str | None:
        return None

    def role_in(self, user_id: str, workspace: str) -> Role | None:
        return None

    def name(self, workspace: str) -> str | None:
        return None


class Memberships:
    """A person's place in the workspace. The account itself stays the server admin's."""

    def __init__(self, users: UserRepo, sessions: Sessions, live: LiveBoards) -> None:
        self._users = users
        self._sessions = sessions
        self._live = live

    def remove(self, by: Person, user_id: str) -> None:
        if user_id == by.id:
            raise ValidationFailed("You cannot remove yourself.")
        person = self._users.get(user_id)
        if person is None or person.demo_expires_at:
            raise NotFound("person not found")
        boards = self._users.remove_member(user_id, by.id)
        if boards is None:
            raise LastAdmin(LAST_ADMIN)
        self._sessions.forget(user_id)
        # Their tabs read the account again and find no workspace.
        self._live.recheck_person(user_id)
        for board_id in boards:
            self._live.recheck_board(board_id)
