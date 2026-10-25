import secrets
import time

from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.api.errors import error_body
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

    def __init__(self, app: ASGIApp, sessions: Sessions, metrics_token: str = "") -> None:
        self.app = app
        self.sessions = sessions
        self.metrics_token = metrics_token

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
