import time

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from app.api.deps import AccountsDep, CurrentPerson, SessionsDep
from app.api.gate import COOKIE
from app.domain.accounts import BROWSER_TTL_S, Person
from app.domain.demo import DemoVisitors
from app.domain.errors import NotFound
from app.domain.sessions import SESSION_TTL_S
from app.domain.workspaces import WorkspaceLookup, current_workspace

router = APIRouter(prefix="/auth", tags=["auth"])


class SignInRequest(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=1024)


def me(request: Request, person: Person) -> dict:
    fields = {"id", "username", "name", "role", "server_admin", "must_change_password"}
    # Only a demo instance tells who is a demo visitor.
    if request.app.state.visitors is not None:
        fields.add("demo_expires_at")
    view = person.model_dump(include=fields)
    workspace = current_workspace.get()
    lookup: WorkspaceLookup = request.app.state.workspaces
    name = lookup.name(workspace) if workspace else None
    view["workspace"] = {"id": workspace, "name": name} if workspace and name else None
    if view["workspace"] is None:
        view["role"] = None
    return view


def _https(request: Request) -> bool:
    # Railway and Render end TLS at their edge and pass the scheme on.
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    return proto.split(",")[0].strip() == "https"


def _signed_out() -> Response:
    response = Response(status_code=204)
    response.delete_cookie(COOKIE, httponly=True, samesite="lax")
    return response


@router.get("/status")
def status(request: Request) -> dict:
    person = getattr(request.state, "person", None)
    answer = {"signed_in": person is not None, "me": me(request, person) if person else None}
    if request.app.state.visitors is not None:
        answer["demo"] = True
    return answer


def signed_in(request: Request, token: str) -> Response:
    """A 204 that starts the session in this browser."""
    response = Response(status_code=204)
    response.set_cookie(
        COOKIE,
        token,
        max_age=SESSION_TTL_S,
        httponly=True,
        samesite="lax",
        secure=_https(request),
    )
    return response


# Kept after signing out: it tells that this browser signed in as the person before.
BROWSER_COOKIE = "tiko_device"


def _address(request: Request) -> str:
    # The web container's nginx works the client out and is the only way in to the API.
    peer = request.client.host if request.client else ""
    return request.headers.get("x-real-ip") or peer


@router.post("/login", status_code=204)
def login(body: SignInRequest, request: Request, accounts: AccountsDep) -> Response:
    session, browser = accounts.sign_in(
        body.username,
        body.password,
        time.time(),
        address=_address(request),
        browser=request.cookies.get(BROWSER_COOKIE),
    )
    response = signed_in(request, session)
    if browser:
        response.set_cookie(
            BROWSER_COOKIE,
            browser,
            max_age=int(BROWSER_TTL_S),
            httponly=True,
            samesite="lax",
            secure=_https(request),
        )
    return response


@router.post("/demo", status_code=204)
def start_demo(request: Request) -> Response:
    """Makes a demo visitor and signs them in; only on a demo instance."""
    visitors: DemoVisitors | None = request.app.state.visitors
    if visitors is None:
        raise NotFound("not found")
    if getattr(request.state, "person", None) is not None:
        return Response(status_code=204)
    return signed_in(request, visitors.create(_address(request), time.time()))


class SignUpRequest(BaseModel):
    name: str = Field(max_length=200)
    username: str = Field(max_length=64)
    password: str = Field(max_length=1024)


@router.post("/signup")
def sign_up(body: SignUpRequest, request: Request) -> dict:
    """A demo visitor picks a name and a password and stays; for nobody else."""
    visitors: DemoVisitors | None = request.app.state.visitors
    person: Person | None = getattr(request.state, "person", None)
    if visitors is None or person is None or not person.demo_expires_at:
        raise NotFound("not found")
    return me(request, visitors.sign_up(person, body.name, body.username, body.password))


@router.post("/logout", status_code=204)
def logout(request: Request, sessions: SessionsDep) -> Response:
    if token := request.cookies.get(COOKIE):
        sessions.end(token)
    return _signed_out()


@router.post("/logout-all", status_code=204)
def logout_all(person: CurrentPerson, sessions: SessionsDep) -> Response:
    sessions.end_all(person.id)
    return _signed_out()
