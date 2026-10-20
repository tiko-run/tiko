import secrets
import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app.domain.accounts import (
    Accounts,
    Person,
    Role,
    check_name,
    check_password,
    check_username,
)
from app.domain.errors import (
    AccountDisabled,
    InviteExpired,
    InWorkspace,
    NotFound,
    UsernameTaken,
    ValidationFailed,
)
from app.domain.ports import InviteRepo
from app.domain.sessions import Sessions, iso, token_hash
from app.domain.workspaces import in_workspace

INVITE_TTL_S = 7 * 24 * 3600
RESET_TTL_S = 24 * 3600
EXPIRED = "This invite link has expired. Ask your admin for a new one."
IN_WORKSPACE = "You are already in a workspace."

Kind = Literal["invite", "reset"]


class Invite(BaseModel):
    id: str
    kind: Kind
    role: Role | None = None
    user_id: str | None = None
    username: str | None = None
    expires_at: str
    created_at: str
    # The workspace an invite joins; never shown, the link is enough.
    workspace: str | None = Field(default=None, exclude=True)


class Invites:
    """One-time links: an invite creates a person, a reset sets a password. Only the token's
    hash is stored, so the link is shown once."""

    def __init__(self, repo: InviteRepo, accounts: Accounts, sessions: Sessions) -> None:
        self._repo = repo
        self._accounts = accounts
        self._sessions = sessions

    def _create(self, invite: Invite, created_by: str) -> tuple[Invite, str]:
        token = secrets.token_urlsafe(32)
        self._repo.add(invite, token_hash(token), created_by)
        return invite, token

    def invite(self, by: Person, role: Role, now: float) -> tuple[Invite, str]:
        invite = Invite(
            id=uuid.uuid4().hex,
            kind="invite",
            role=role,
            expires_at=iso(now + INVITE_TTL_S),
            created_at=iso(now),
        )
        return self._create(invite, by.id)

    def reset(self, by_id: str, user_id: str, now: float) -> tuple[Invite, str]:
        # Any account on the server, also one that is in no workspace.
        person = self._accounts.account(user_id)
        invite = Invite(
            id=uuid.uuid4().hex,
            kind="reset",
            user_id=person.id,
            username=person.username,
            expires_at=iso(now + RESET_TTL_S),
            created_at=iso(now),
        )
        return self._create(invite, by_id)

    def open(self, token: str, now: float) -> Invite:
        invite = self._repo.find_open(token_hash(token), iso(now))
        if invite is None:
            raise InviteExpired(EXPIRED)
        return invite

    def accept(
        self,
        token: str,
        password: str,
        now: float,
        username: str | None = None,
        name: str | None = None,
    ) -> str:
        """Uses the link and returns a session token for the person it is about."""
        invite = self.open(token, now)
        check_password(password)
        if invite.kind == "invite":
            if username is None or name is None:
                raise ValidationFailed("username and name are required")
            check_username(username)
            check_name(name)
        elif self._accounts.account(invite.user_id or "").disabled:
            raise AccountDisabled("This account is disabled. Ask your admin.")
        if not self._repo.consume(invite.id, iso(now)):
            raise InviteExpired(EXPIRED)
        if invite.kind == "reset":
            user_id = invite.user_id or ""
            self._accounts.set_password(user_id, password)
            self._accounts.came_back(user_id)
            return self._sessions.start(user_id, now)
        try:
            with in_workspace(invite.workspace):
                person = self._accounts.create(
                    username or "", name or "", password, invite.role or "member"
                )
        except UsernameTaken:
            # The link stays usable, so the person can pick another name.
            self._repo.unconsume(invite.id)
            raise
        return self._sessions.start(person.id, now)

    def join(self, person: Person, token: str, now: float) -> None:
        """A signed-in person joins the invite's workspace with the account they have."""
        invite = self.open(token, now)
        if invite.kind != "invite" or invite.workspace is None:
            raise ValidationFailed("This link is not an invite.")
        if person.demo_expires_at:
            raise InWorkspace(IN_WORKSPACE)
        if not self._repo.consume(invite.id, iso(now)):
            raise InviteExpired(EXPIRED)
        if not self._accounts.join(person.id, invite.workspace, invite.role or "member"):
            # The link stays usable for someone who is not in a workspace yet.
            self._repo.unconsume(invite.id)
            raise InWorkspace(IN_WORKSPACE)

    def pending(self, now: float) -> list[Invite]:
        return self._repo.pending(iso(now))

    def revoke(self, invite_id: str, now: float) -> None:
        if not self._repo.revoke(invite_id, iso(now)):
            raise NotFound("invite not found")
