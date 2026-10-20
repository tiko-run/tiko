import time
from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from app.api.auth import signed_in
from app.api.deps import CurrentPerson, InvitesDep, WorkspaceAdmin
from app.api.people import InviteLink, link

router = APIRouter(prefix="/invites", tags=["invites"])


class InviteRequest(BaseModel):
    role: Literal["admin", "member"] = "member"


class InviteInfo(BaseModel):
    kind: Literal["invite", "reset"]
    role: Literal["admin", "member"] | None
    username: str | None


class Acceptance(BaseModel):
    password: str = Field(max_length=1024)
    username: str | None = Field(default=None, max_length=64)
    name: str | None = Field(default=None, max_length=200)


@router.post("", status_code=201)
def create_invite(body: InviteRequest, admin: WorkspaceAdmin, invites: InvitesDep) -> InviteLink:
    return link(*invites.invite(admin, body.role, time.time()))


@router.delete("/{invite_id}", status_code=204)
def revoke_invite(invite_id: str, _: WorkspaceAdmin, invites: InvitesDep) -> Response:
    invites.revoke(invite_id, time.time())
    return Response(status_code=204)


@router.get("/{token}")
def open_invite(token: str, invites: InvitesDep) -> InviteInfo:
    invite = invites.open(token, time.time())
    return InviteInfo(kind=invite.kind, role=invite.role, username=invite.username)


@router.post("/{token}/accept", status_code=204)
def accept_invite(token: str, body: Acceptance, request: Request, invites: InvitesDep) -> Response:
    session = invites.accept(token, body.password, time.time(), body.username, body.name)
    return signed_in(request, session)


@router.post("/{token}/join", status_code=204)
def join_workspace(token: str, person: CurrentPerson, invites: InvitesDep) -> Response:
    invites.join(person, token, time.time())
    return Response(status_code=204)
