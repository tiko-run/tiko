import time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field, SecretStr

from app.api import deps
from app.api.auth import me
from app.api.deps import AccountsDep, CurrentPerson, NotDemoVisitor
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
    body: MeUpdate,
    person: CurrentPerson,
    accounts: AccountsDep,
    demo: Annotated[bool, Depends(deps.is_demo)],
) -> dict:
    return me(accounts.update(person, body.name, body.username), demo)


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
