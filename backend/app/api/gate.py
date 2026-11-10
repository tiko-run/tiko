import secrets
import time

import anyio.to_thread
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.api.errors import KEY_CHALLENGE, error_body
from app.domain.api_keys import ApiKeys
from app.domain.errors import KeyRefused
from app.domain.ports import Attempts
from app.domain.sessions import Sessions

COOKIE = "tiko_session"
# Platform health checks must pass before anyone signs in.
OPEN_PATHS = {
    "/health",
    "/ready",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/logout",
    # Answers 404 unless the instance is a demo.
    "/api/auth/demo",
    "/api/auth/signup",
}
INVITES = "/api/invites/"
# Boards shown by their public link; the routes there only read.
PUBLIC = "/api/public/"
METRICS = "/metrics"
# All the first admin can do before replacing the password, besides the open paths.
BEFORE_NEW_PASSWORD = {"/api/me/password", "/api/auth/logout-all"}
# Signed in by an API key and nothing else (spec 046).
BY_KEY = ("/api/v1/", "/api/mcp")
KEY_OPEN = {"/api/v1/openapi.json"}
# Requests with a key tiko does not know, per client address and minute.
WRONG_KEYS = 30


def by_key(path: str) -> bool:
    return path.startswith(BY_KEY) or path == "/api/v1"


def is_open(scope: Scope) -> bool:
    path = scope["path"]
    if path in OPEN_PATHS or path.startswith(PUBLIC):
        return True
    # Reading an invite link and accepting it come before the person has an account.
    token = path.removeprefix(INVITES)
    if token == path or not token:
        return False
    method = scope.get("method")
    return (method == "GET" and "/" not in token) or (
        method == "POST" and token.count("/") == 1 and token.endswith("/accept")
    )


class PasswordGate:
    """Puts the signed-in person on the request and closes every route except OPEN_PATHS
    to requests without one."""

    def __init__(
        self,
        app: ASGIApp,
        sessions: Sessions,
        metrics_token: str = "",
        api_keys: ApiKeys | None = None,
        attempts: Attempts | None = None,
    ) -> None:
        self.app = app
        self.sessions = sessions
        self.metrics_token = metrics_token
        self.api_keys = api_keys
        self.attempts = attempts

    def _scrapes(self, scope: Scope) -> bool:
        """A monitoring system reading /metrics with the token of the instance."""
        if not self.metrics_token or scope["path"] != METRICS or scope["type"] != "http":
            return False
        sent = HTTPConnection(scope).headers.get("authorization", "")
        return secrets.compare_digest(sent.encode(), f"Bearer {self.metrics_token}".encode())

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await self.app(scope, receive, send)
            return
        if by_key(scope["path"]):
            if scope["path"] == "/api/mcp":
                # The mount would answer with a redirect built from the address inside the proxy.
                scope["path"], scope["raw_path"] = "/api/mcp/", b"/api/mcp/"
            await self._by_key(scope, receive, send)
            return
        token = HTTPConnection(scope).cookies.get(COOKIE)
        person = self.sessions.resolve(token, time.time()) if token else None
        if person is not None:
            state = scope.setdefault("state", {})
            state["person"], state["session"] = person, token
        scraper = self._scrapes(scope)
        if scraper:
            scope.setdefault("state", {})["scraper"] = True
        held = (
            person is not None
            and person.must_change_password
            and not is_open(scope)
            and scope["path"] not in BEFORE_NEW_PASSWORD
        )
        if not held and (person is not None or scraper or is_open(scope)):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        if held:
            body = error_body("password_change_required", "Set a new password first.")
            response = JSONResponse(body, status_code=403)
        else:
            response = JSONResponse(error_body("auth_required", "sign in to tiko"), status_code=401)
        await response(scope, receive, send)

    async def _by_key(self, scope: Scope, receive: Receive, send: Send) -> None:
        """The cookie is never read here, so the public API has nothing to forge from a page."""
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        if self.api_keys is None:
            await _refuse(scope, receive, send, 401, "auth_required", "Use an API key.")
            return
        if scope["path"] in KEY_OPEN:
            await self.app(scope, receive, send)
            return
        conn = HTTPConnection(scope)
        sent = conn.headers.get("authorization", "")
        token = sent[7:].strip() if sent[:7].lower() == "bearer " else ""
        try:
            key, person = await anyio.to_thread.run_sync(self.api_keys.resolve, token)
        except KeyRefused as refused:
            if refused.code == "auth_required" and await self._too_many_wrong(conn):
                await _refuse(scope, receive, send, 429, "rate_limited", "Too many wrong keys.")
                return
            await _refuse(scope, receive, send, 401, refused.code, refused.message)
            return
        if person.must_change_password:
            body = "Set a new password in tiko first."
            await _refuse(scope, receive, send, 403, "password_change_required", body)
            return
        state = scope.setdefault("state", {})
        state["person"], state["api_key"] = person, key
        await self.app(scope, receive, send)

    async def _too_many_wrong(self, conn: HTTPConnection) -> bool:
        if self.attempts is None:
            return False
        # The web container's nginx works the client out and is the only way in to the API.
        address = conn.headers.get("x-real-ip") or (conn.client.host if conn.client else "")
        spent = await anyio.to_thread.run_sync(
            self.attempts.spend, "api-key-wrong", address, WRONG_KEYS, 60.0, time.time()
        )
        return spent is not None


async def _refuse(
    scope: Scope, receive: Receive, send: Send, status: int, code: str, message: str
) -> None:
    headers = dict(KEY_CHALLENGE) if status == 401 else {}
    if status == 429:
        headers["retry-after"] = "60"
    response = JSONResponse(error_body(code, message), status_code=status, headers=headers)
    await response(scope, receive, send)
