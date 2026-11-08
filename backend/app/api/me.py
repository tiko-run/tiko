import time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field, SecretStr

from app.api import deps
from app.api.auth import me
from app.api.deps import AccountsDep, CurrentPerson, NotDemoVisitor
from app.domain.caldav import CalDavAccount, CalDavIn, CalDavSource, TaskList, normalize_address
from app.domain.errors import CalDavRejected, TrackerUnavailable, ValidationFailed
from app.domain.onboarding import Onboarding, OnboardingChange
from app.domain.settings import JiraKind, SettingsService, TokenState

router = APIRouter(prefix="/me", tags=["me"])


class MeUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    username: str | None = Field(default=None, max_length=200)


class PasswordChange(BaseModel):
    current: str = Field(max_length=1024)
    new: str = Field(max_length=1024)


@router.patch("", dependencies=[NotDemoVisitor])
def update_me(
    body: MeUpdate, person: CurrentPerson, accounts: AccountsDep, request: Request
) -> dict:
    return me(request, accounts.update(person, body.name, body.username))


@router.put("/password", status_code=204, dependencies=[NotDemoVisitor])
def change_password(
    body: PasswordChange,
    request: Request,
    person: CurrentPerson,
    accounts: AccountsDep,
) -> Response:
    accounts.change_password(person, body.current, body.new, keep_token=request.state.session)
    return Response(status_code=204)


@router.get("/onboarding")
def get_onboarding(person: CurrentPerson, accounts: AccountsDep) -> Onboarding:
    return accounts.onboarding(person.id)


@router.patch("/onboarding")
def change_onboarding(
    body: OnboardingChange, person: CurrentPerson, accounts: AccountsDep
) -> Onboarding:
    return accounts.change_onboarding(person.id, body, time.time())


Settings = Annotated[SettingsService, Depends(deps.settings)]


class TrackerView(BaseModel):
    provider: str
    base_url: str | None
    token_state: TokenState
    kind: JiraKind | None = None
    # The person's own Jira Cloud e-mail, never anyone else's.
    email: str | None = None
    # GitHub is read on every instance, whatever its own tracker is.
    github_token_state: TokenState


TokenSource = Literal["jira", "github"]


class TokenIn(BaseModel):
    token: SecretStr
    source: TokenSource = "jira"
    email: str | None = Field(default=None, max_length=320)


def _tracker(person_id: str, settings: SettingsService) -> TrackerView:
    return TrackerView(
        provider=settings.provider(),
        base_url=settings.base_url(),
        token_state=settings.token_state(person_id),
        github_token_state=settings.github_token_state(person_id),
        kind=settings.jira_kind(),
        email=settings.email(person_id),
    )


@router.get("/tracker")
def get_tracker(person: CurrentPerson, settings: Settings) -> TrackerView:
    if person.demo_expires_at:
        # The instance's tracker is for people with an account; a visitor is not shown it.
        return TrackerView(
            provider="demo", base_url=None, token_state="none", github_token_state="none"
        )
    return _tracker(person.id, settings)


@router.put("/tracker", dependencies=[NotDemoVisitor])
def set_tracker_token(
    body: TokenIn, person: CurrentPerson, settings: Settings, request: Request
) -> TrackerView:
    if body.source == "github":
        # A token GitHub does not accept is not stored.
        request.app.state.github_readers.login(body.token.get_secret_value().strip())
        settings.set_github_token(person.id, body.token)
    else:
        settings.set_token(person.id, body.token, body.email)
    return _tracker(person.id, settings)


@router.delete("/tracker", status_code=204)
def remove_tracker_token(
    person: CurrentPerson, settings: Settings, source: TokenSource = "jira"
) -> Response:
    if source == "github":
        settings.remove_github_token(person.id)
    else:
        settings.remove_token(person.id)
    return Response(status_code=204)


class CalDavView(BaseModel):
    state: TokenState
    address: str | None = None
    username: str | None = None


class CalDavConnected(CalDavView):
    # The name the server gives the account, shown to say the connection works.
    display_name: str
    lists: list[TaskList]


class ListsOut(BaseModel):
    lists: list[TaskList]


class ListsIn(BaseModel):
    # Ids of the lists the person switched off.
    hidden: list[str] = Field(max_length=500)


CalDav = Annotated[CalDavSource, Depends(deps.caldav_source)]


def _caldav(person_id: str, settings: SettingsService) -> CalDavView:
    state, account = settings.caldav_account(person_id)
    if account is None:
        return CalDavView(state=state)
    return CalDavView(state=state, address=account.address, username=account.username)


@router.get("/caldav")
def get_caldav(person: CurrentPerson, settings: Settings) -> CalDavView:
    if person.demo_expires_at:
        return CalDavView(state="none")
    return _caldav(person.id, settings)


@router.put("/caldav", dependencies=[NotDemoVisitor])
def connect_caldav(
    body: CalDavIn, person: CurrentPerson, settings: Settings, request: Request
) -> CalDavConnected:
    address = normalize_address(body.address)
    username = body.username.strip()
    _, stored = settings.caldav_account(person.id)
    password = body.password.get_secret_value().strip() if body.password else ""
    same = stored is not None and (stored.address, stored.username) == (address, username)
    if not password and stored is not None and same:
        password = stored.password.get_secret_value()
    if not password:
        raise ValidationFailed("password: enter the app password of this account")
    account = CalDavAccount(
        address=address,
        username=username,
        password=SecretStr(password),
        hidden=stored.hidden if stored is not None and same else frozenset(),
    )
    readers = request.app.state.caldav_readers
    reader = readers.reader(account)
    # An account the server does not accept is not stored.
    try:
        name = reader.check()
        lists = reader.lists()
    except CalDavRejected as exc:
        raise ValidationFailed(
            "password: the server did not accept this user name and password"
        ) from exc
    except TrackerUnavailable as exc:
        raise ValidationFailed(f"address: {exc.message}") from exc
    settings.connect_caldav(person.id, account)
    readers.forget(person.id)
    return CalDavConnected(
        state="set", address=address, username=username, display_name=name, lists=lists
    )


@router.delete("/caldav", status_code=204)
def remove_caldav(person: CurrentPerson, settings: Settings, request: Request) -> Response:
    settings.remove_caldav(person.id)
    request.app.state.caldav_readers.forget(person.id)
    return Response(status_code=204)


@router.get("/caldav/lists")
def caldav_lists(caldav: CalDav) -> ListsOut:
    return ListsOut(lists=caldav.lists())


@router.put("/caldav/lists", dependencies=[NotDemoVisitor])
def show_caldav_lists(
    body: ListsIn, person: CurrentPerson, settings: Settings, request: Request
) -> ListsOut:
    _, account = settings.caldav_account(person.id)
    if account is None:
        raise ValidationFailed("Connect your CalDAV account in Settings → My tracker.")
    changed = CalDavAccount(
        address=account.address,
        username=account.username,
        password=account.password,
        hidden=frozenset(body.hidden),
    )
    settings.set_caldav(person.id, changed)
    return ListsOut(lists=request.app.state.caldav_readers.of(person.id, changed).lists())
