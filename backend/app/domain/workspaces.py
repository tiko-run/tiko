from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Protocol

from app.domain.accounts import Role

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
