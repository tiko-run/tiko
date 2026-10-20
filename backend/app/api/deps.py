from typing import Annotated

from fastapi import Depends, Request

from app.domain.accounts import Accounts, Person
from app.domain.errors import Forbidden, JiraNotConfigured
from app.domain.invites import Invites
from app.domain.members import BoardRole, Members
from app.domain.ports import BoardRepo, DemoTasks, LiveBoards, SnapshotRepo, TaskProvider
from app.domain.public import PublicLinks
from app.domain.refresh import RefreshService
from app.domain.sessions import Sessions
from app.domain.settings import Provider, SettingsService
from app.domain.tasks import NoTokenProvider


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


def providers(request: Request) -> dict[str, TaskProvider]:
    """Every tracker this request can read, by source id: the demo tasks and GitHub always,
    and Jira with the signed-in person's own token when the instance is set to it. GitHub is
    read with the person's own token when they have one, and by the shared reader of public
    repositories otherwise. A demo visitor has no token."""
    state = request.app.state
    settings: SettingsService = state.settings
    person = current_person(request)
    demo_tasks: TaskProvider = state.demo.scoped(_statuses_owner(request))
    github: TaskProvider = state.github
    if not is_visitor(request) and (token := settings.github_token(person.id)):
        github = state.github_readers.of(person.id, token.get_secret_value())
    found = {demo_tasks.source_id: demo_tasks, github.source_id: github}
    if tracker(request) == "jira":
        try:
            jira = state.jira(settings.jira_credentials(person.id))
        except JiraNotConfigured as exc:
            jira = NoTokenProvider(settings.base_url(), exc)
        found[jira.source_id] = jira
    return found


def provider(request: Request) -> TaskProvider:
    """The tracker of this request; a typed key or a query goes to it."""
    return providers(request)[tracker(request)]


def owner(request: Request) -> str:
    return current_person(request).id


def refresher(request: Request) -> RefreshService:
    return request.app.state.refresher


def demo(request: Request) -> DemoTasks:
    return request.app.state.demo.scoped(_statuses_owner(request))


def accounts(request: Request) -> Accounts:
    return request.app.state.accounts


def sessions(request: Request) -> Sessions:
    return request.app.state.sessions


def current_person(request: Request) -> Person:
    """Set by PasswordGate; every route outside its open paths has one."""
    return request.state.person


def current_admin(request: Request) -> Person:
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


def public_links(request: Request) -> PublicLinks:
    return request.app.state.public_links


def invites(request: Request) -> Invites:
    return request.app.state.invites


CurrentPerson = Annotated[Person, Depends(current_person)]
AccountsDep = Annotated[Accounts, Depends(accounts)]
SessionsDep = Annotated[Sessions, Depends(sessions)]
CurrentAdmin = Annotated[Person, Depends(current_admin)]
CurrentServerAdmin = Annotated[Person, Depends(current_server_admin)]
InvitesDep = Annotated[Invites, Depends(invites)]
MembersDep = Annotated[Members, Depends(members)]
CanView = Annotated[BoardRole, board_role("viewer")]
CanEdit = Annotated[BoardRole, board_role("editor")]
IsOwner = Annotated[BoardRole, board_role("owner")]
NotDemoVisitor = Depends(not_demo_visitor)
