from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, SecretStr

from app.api import deps
from app.api.deps import CurrentPerson, NotDemoVisitor, WorkspaceAdmin
from app.domain.errors import Forbidden
from app.domain.settings import (
    JiraCredentials,
    JiraView,
    SettingsIn,
    SettingsService,
    SettingsView,
)

router = APIRouter(prefix="/settings", tags=["settings"])

Settings = Annotated[SettingsService, Depends(deps.settings)]


class TestIn(BaseModel):
    base_url: str | None = Field(default=None, max_length=500)
    token: SecretStr | None = None
    # Jira Cloud only: the e-mail of the Atlassian account the token belongs to.
    email: str | None = Field(default=None, max_length=320)


class TestOut(BaseModel):
    ok: bool
    user: str


@router.get("")
def get_settings(person: CurrentPerson, settings: Settings) -> SettingsView:
    """Instance settings for everyone; `jira.token_state` is the person's own token."""
    view = settings.view(person.id)
    if person.demo_expires_at:
        # The instance's tracker is for people with an account; a visitor is not shown it.
        hidden = {"provider": "demo", "jira": JiraView(base_url=None, token_state="none")}
        return view.model_copy(update=hidden | {"locked": []})
    return view


@router.put("")
def put_settings(body: SettingsIn, admin: WorkspaceAdmin, settings: Settings) -> SettingsView:
    return settings.update(body, admin.id)


@router.post("/jira/test", dependencies=[NotDemoVisitor])
def test_jira(body: TestIn, person: CurrentPerson, settings: Settings, request: Request) -> TestOut:
    # Only an admin picks the address the server calls; anyone else tests the one that is set.
    if body.base_url is not None and person.role != "admin":
        raise Forbidden("Only an admin can do this.")
    creds = settings.jira_credentials(person.id, body.base_url, body.token, body.email)
    check: Callable[[JiraCredentials], str] = request.app.state.check_jira
    return TestOut(ok=True, user=check(creds))
