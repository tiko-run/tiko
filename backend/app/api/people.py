import time
from typing import Literal

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel

from app.api.deps import AccountsDep, CurrentPerson, InvitesDep, MembershipsDep, WorkspaceAdmin
from app.domain.accounts import PersonRecord
from app.domain.invites import Invite

router = APIRouter(tags=["people"])


class PersonView(BaseModel):
    id: str
    username: str
    name: str
    role: Literal["admin", "member"]
    disabled: bool
    last_sign_in_at: str | None
    created_at: str


class PeopleList(BaseModel):
    people: list[PersonView]
    invites: list[Invite]


class PersonChange(BaseModel):
    role: Literal["admin", "member"]


class InviteLink(BaseModel):
    invite: Invite
    # Relative, so it works on whatever address the admin opened tiko on.
    url: str


def link(invite: Invite, token: str) -> InviteLink:
    return InviteLink(invite=invite, url=f"/?{invite.kind}={token}")


def _view(person: PersonRecord) -> PersonView:
    return PersonView(**person.model_dump())


@router.get("/people")
def list_people(_: WorkspaceAdmin, accounts: AccountsDep, invites: InvitesDep) -> PeopleList:
    return PeopleList(
        people=[_view(person) for person in accounts.people()],
        invites=invites.pending(time.time()),
    )


@router.patch("/people/{user_id}")
def change_person(
    user_id: str, body: PersonChange, _: WorkspaceAdmin, accounts: AccountsDep
) -> PersonView:
    return _view(accounts.change_role(user_id, body.role))


@router.delete("/people/{user_id}", status_code=204)
def remove_person(user_id: str, admin: WorkspaceAdmin, memberships: MembershipsDep) -> Response:
    """Out of the workspace; the account and its sign-in stay."""
    memberships.remove(admin, user_id)
    return Response(status_code=204)


class DirectoryEntry(BaseModel):
    id: str
    username: str
    name: str


class Directory(BaseModel):
    people: list[DirectoryEntry]


@router.get("/people/directory")
def directory(
    _: CurrentPerson,
    accounts: AccountsDep,
    q: str = Query(default="", max_length=64),
) -> Directory:
    """Active people of the workspace for the share picker; open to everyone signed in."""
    needle = q.strip().lower()
    found = [
        DirectoryEntry(id=p.id, username=p.username, name=p.name)
        for p in accounts.people()
        if not p.disabled and (needle in p.name.lower() or needle in p.username.lower())
    ]
    return Directory(people=found[:20])
