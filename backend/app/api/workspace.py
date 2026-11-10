from collections.abc import Callable

import anyio.to_thread
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.api.errors import KEY_CHALLENGE, error_body
from app.domain.accounts import Person
from app.domain.api_keys import KeyIdentity
from app.domain.workspaces import WorkspaceLookup, in_workspace

BOARDS = "/api/boards/"
PUBLIC = "/api/public/"
# What a person outside any workspace still reaches: their account, invites, public links, a
# running update, and the server routes, which check the server admin themselves.
WITHOUT_WORKSPACE = (
    "/api/auth/",
    "/api/invites/",
    PUBLIC,
    "/api/accounts",
    "/api/privacy",
    "/api/version",
)
WITHOUT_WORKSPACE_EXACT = {"/api/me", "/api/me/password", "/api/update"}
NO_WORKSPACE = "You are not in a workspace. Ask an admin for an invite link."


def reachable_without_workspace(path: str) -> bool:
    if not path.startswith("/api/"):
        return True
    return path in WITHOUT_WORKSPACE_EXACT or path.startswith(WITHOUT_WORKSPACE)


def _segment(path: str, prefix: str) -> str | None:
    """The first path segment after `prefix`, if the path starts with it."""
    if not path.startswith(prefix):
        return None
    return path[len(prefix) :].split("/", 1)[0] or None


class WorkspaceScope:
    """Sets the workspace a request works in and the person's role there. A public link works in
    its board's workspace; a board route in its board's, when the person is a member there; the
    rest in the person's own, where a board of another workspace is simply not found."""

    def __init__(
        self,
        app: ASGIApp,
        lookup: WorkspaceLookup,
        keys_enabled: Callable[[], bool] = lambda: False,
    ) -> None:
        self.app = app
        self.lookup = lookup
        # The workspace's API key switch, read inside the workspace.
        self.keys_enabled = keys_enabled

    def _by_key(self, scope: Scope, key: KeyIdentity) -> tuple[str, str | None]:
        """A key works in its own workspace only, as a member: no admin reaches every board
        through it. Returns the workspace and why the key is refused there, if it is."""
        state = scope["state"]
        person: Person = state["person"]
        role = self.lookup.role_in(person.id, key.workspace_id)
        if role is None:
            return key.workspace_id, "token_revoked"
        # Who the person is still sets limits such as the board limit; only board access drops.
        state["workspace_role"] = role
        state["person"] = person.model_copy(update={"role": "member"})
        with in_workspace(key.workspace_id):
            enabled = self.keys_enabled()
        return key.workspace_id, None if enabled else "api_disabled"

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
        key: KeyIdentity | None = scope.get("state", {}).get("api_key")
        if key is not None:
            workspace, refused = await anyio.to_thread.run_sync(self._by_key, scope, key)
            if refused:
                status, message = (
                    (401, "This API key's person left its workspace.")
                    if refused == "token_revoked"
                    else (403, "Your admin has switched API keys off.")
                )
                headers = KEY_CHALLENGE if status == 401 else None
                response = JSONResponse(
                    error_body(refused, message), status_code=status, headers=headers
                )
                await response(scope, receive, send)
                return
            with in_workspace(workspace):
                await self.app(scope, receive, send)
            return
        workspace = await anyio.to_thread.run_sync(self._find, scope)
        signed_in = scope.get("state", {}).get("person") is not None
        if workspace is None and signed_in and not reachable_without_workspace(scope["path"]):
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
                return
            response = JSONResponse(error_body("no_workspace", NO_WORKSPACE), status_code=403)
            await response(scope, receive, send)
            return
        with in_workspace(workspace):
            await self.app(scope, receive, send)
