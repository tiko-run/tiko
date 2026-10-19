import anyio.to_thread
from starlette.types import ASGIApp, Receive, Scope, Send

from app.domain.accounts import Person
from app.domain.workspaces import WorkspaceLookup, in_workspace

BOARDS = "/api/boards/"
PUBLIC = "/api/public/"


def _segment(path: str, prefix: str) -> str | None:
    """The first path segment after `prefix`, if the path starts with it."""
    if not path.startswith(prefix):
        return None
    return path[len(prefix) :].split("/", 1)[0] or None


class WorkspaceScope:
    """Sets the workspace a request works in and the person's role there. A public link works in
    its board's workspace; a board route in its board's, when the person is a member there; the
    rest in the person's own, where a board of another workspace is simply not found."""

    def __init__(self, app: ASGIApp, lookup: WorkspaceLookup) -> None:
        self.app = app
        self.lookup = lookup

    def _find(self, scope: Scope) -> str | None:
        path = scope["path"]
        if token := _segment(path, PUBLIC):
            return self.lookup.of_public_token(token)
        person: Person | None = scope.get("state", {}).get("person")
        if person is None:
            return None
        if (board_id := _segment(path, BOARDS)) and (found := self.lookup.of_board(board_id)):
            role = self.lookup.role_in(person.id, found)
            if role is not None:
                scope["state"]["person"] = person.model_copy(update={"role": role})
                return found
        workspace = self.lookup.of_person(person.id)
        role = self.lookup.role_in(person.id, workspace) if workspace else None
        # Without a membership a person is nobody's admin.
        scope["state"]["person"] = person.model_copy(update={"role": role or "member"})
        return workspace

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await self.app(scope, receive, send)
            return
        workspace = await anyio.to_thread.run_sync(self._find, scope)
        with in_workspace(workspace):
            await self.app(scope, receive, send)
