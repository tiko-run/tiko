from collections.abc import Callable, Mapping
from typing import Annotated

from fastapi import Depends, Request

from app.domain.accounts import Accounts, Person
from app.domain.api_keys import ApiKeys
from app.domain.caldav import CalDavSource, NoCalDav
from app.domain.errors import Forbidden, JiraNotConfigured, ValidationFailed
from app.domain.invites import Invites
from app.domain.members import BoardRole, Members
from app.domain.ports import (
    BoardRepo,
    DemoTasks,
    LiveBoards,
    PrefixChoiceRepo,
    SnapshotRepo,
    TaskProvider,
)
from app.domain.public import PublicLinks
from app.domain.refresh import RefreshService
from app.domain.sessions import Sessions
from app.domain.settings import Provider, SettingsService
from app.domain.sources import SOURCES, jira_not_connected
from app.domain.tasks import GITHUB, LINEAR, NotConnected, linear_url
from app.domain.workspaces import Memberships


def boards(request: Request) -> BoardRepo:
    return request.app.state.boards


def live(request: Request) -> LiveBoards:
    return request.app.state.live


def is_demo(request: Request) -> bool:
    """Whether the instance takes demo visitors (TIKO_DEMO), so strangers share it."""
    return request.app.state.visitors is not None


def is_visitor(request: Request) -> bool:
    return current_person(request).demo_expires_at is not None


def tracker(request: Request) -> Provider:
    """The request's tracker: the demo tasks for a visitor, the instance's for everyone else."""
    return "demo" if is_visitor(request) else request.app.state.settings.provider()


def _statuses_owner(request: Request) -> str:
    """Whose demo task statuses a request reads: the person's own on a demo instance, the
    ones everyone shares anywhere else."""
    return current_person(request).id if is_demo(request) else ""


def snapshots(request: Request) -> SnapshotRepo:
    """The person's own task cache: what one token can see never reaches another person."""
    return request.app.state.snapshots.scoped(current_person(request).id)


def settings(request: Request) -> SettingsService:
    return request.app.state.settings


def token_stamps(request: Request) -> dict[str, str | None]:
    """The person's tokens as they are before `providers` reads them."""
    return request.app.state.settings.token_stamps(current_person(request).id)


def providers(request: Request) -> dict[str, TaskProvider]:
    """Every tracker this request can read, by source id: the demo tasks, GitHub, CalDAV and
    Linear always, and Jira with the signed-in person's own token when the instance is set to it."""
    builders = (demo, _github, caldav_source, _linear)
    found = {p.source_id: p for p in (build(request) for build in builders)}
    if tracker(request) == "jira":
        settings: SettingsService = request.app.state.settings
        try:
            jira = request.app.state.jira(settings.jira_credentials(current_person(request).id))
        except JiraNotConfigured as exc:
            jira = jira_not_connected(settings.base_url(), exc)
        found[jira.source_id] = jira
    return found


def prefix_choices(request: Request) -> PrefixChoiceRepo:
    return request.app.state.prefix_choices


def prefix_choice(request: Request) -> Callable[[str], str | None]:
    """The tracker the person chose for a key prefix two of their trackers know."""
    person = current_person(request)
    return lambda prefix: prefix_choices(request).get(person.id, prefix)


def token_checks(request: Request) -> Mapping[str, Callable[[str], str]]:
    """Who a token signs in as, asked of its tracker before the token is stored; by tracker."""
    return request.app.state.token_checks


def _linear(request: Request) -> TaskProvider:
    """Linear with the person's own key; without one, cards say how to connect it."""
    state = request.app.state
    person = current_person(request)
    if not is_visitor(request) and (key := state.settings.source_token(person.id, LINEAR)):
        return state.linear_readers.of(person.id, key.get_secret_value())
    name = SOURCES[LINEAR].name
    return NotConnected(
        LINEAR,
        name,
        ValidationFailed(f"Connect your {name} key in Settings → My tracker."),
        linear_url,
    )


def _github(request: Request) -> TaskProvider:
    """GitHub with the person's own token when they have one, else the shared reader of public
    repositories. A demo visitor has no token."""
    state = request.app.state
    person = current_person(request)
    if not is_visitor(request) and (token := state.settings.source_token(person.id, GITHUB)):
        return state.github_readers.of(person.id, token.get_secret_value())
    return state.github


def caldav_source(request: Request) -> CalDavSource:
    """The person's own CalDAV reader, or a stand-in that asks them to connect one."""
    if is_visitor(request):
        return NoCalDav()
    _, account = request.app.state.settings.caldav_account(current_person(request).id)
    if account is None:
        return NoCalDav()
    return request.app.state.caldav_readers.of(current_person(request).id, account)


def provider(request: Request) -> TaskProvider:
    """The tracker of this request; a typed key or a query goes to it."""
    return providers(request)[tracker(request)]


def query_provider(request: Request, source: str | None = None) -> TaskProvider:
    """The tracker a query names, or the request's own; one without a query is refused."""
    if source is None:
        return provider(request)
    found = SOURCES.get(source)
    readers = providers(request)
    if found is None or found.search != "query" or source not in readers:
        raise ValidationFailed(f"source: {source} takes no query here")
    return readers[source]


def owner(request: Request) -> str:
    return current_person(request).id


def refresher(request: Request) -> RefreshService:
    return request.app.state.refresher


def demo(request: Request) -> DemoTasks:
    return request.app.state.demo.scoped(_statuses_owner(request))


def api_keys(request: Request) -> ApiKeys:
    return request.app.state.api_keys


def accounts(request: Request) -> Accounts:
    return request.app.state.accounts


def sessions(request: Request) -> Sessions:
    return request.app.state.sessions


def current_person(request: Request) -> Person:
    """Set by PasswordGate; every route outside its open paths has one."""
    return request.state.person


def workspace_admin(request: Request) -> Person:
    person = current_person(request)
    if person.role != "admin":
        raise Forbidden("Only an admin can do this.")
    return person


def current_server_admin(request: Request) -> Person:
    """Runs the server; it needs no workspace of its own."""
    person = current_person(request)
    if not person.server_admin:
        raise Forbidden("Only the server admin can do this.")
    return person


def not_demo_visitor(request: Request) -> None:
    """Sharing, account changes and a tracker of their own wait until a demo visitor signs up."""
    if is_visitor(request):
        raise Forbidden("Sign up to do this.")


def not_on_demo(request: Request) -> None:
    if is_demo(request):
        raise Forbidden("This is switched off where anyone can sign up.")


def members(request: Request) -> Members:
    return request.app.state.members


def board_role(needed: BoardRole):
    """Dependency for a board route: the person's role on `board_id`, at least `needed`."""

    def check(board_id: str, request: Request) -> BoardRole:
        return members(request).require(current_person(request), board_id, needed)

    return Depends(check)


def client_address(request: Request) -> str:
    # The web container's nginx works the client out and is the only way in to the API.
    peer = request.client.host if request.client else ""
    return request.headers.get("x-real-ip") or peer


def public_links(request: Request) -> PublicLinks:
    return request.app.state.public_links


def invites(request: Request) -> Invites:
    return request.app.state.invites


def memberships(request: Request) -> Memberships:
    return request.app.state.memberships


CurrentPerson = Annotated[Person, Depends(current_person)]
AccountsDep = Annotated[Accounts, Depends(accounts)]
SessionsDep = Annotated[Sessions, Depends(sessions)]
WorkspaceAdmin = Annotated[Person, Depends(workspace_admin)]
CurrentServerAdmin = Annotated[Person, Depends(current_server_admin)]
InvitesDep = Annotated[Invites, Depends(invites)]
MembershipsDep = Annotated[Memberships, Depends(memberships)]
MembersDep = Annotated[Members, Depends(members)]
CanView = Annotated[BoardRole, board_role("viewer")]
CanEdit = Annotated[BoardRole, board_role("editor")]
IsOwner = Annotated[BoardRole, board_role("owner")]
NotDemoVisitor = Depends(not_demo_visitor)
