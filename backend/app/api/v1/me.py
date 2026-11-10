from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.api.v1.deps import Key, KeyPerson, read_budget

router = APIRouter(tags=["key"], dependencies=[Depends(read_budget)])


class WorkspaceOut(BaseModel):
    id: str
    name: str


class KeyOut(BaseModel):
    name: str
    scope: Literal["read", "write"]
    # None: every board the person reaches.
    boards: list[str] | None
    expires_at: str


class MeOut(BaseModel):
    id: str
    name: str
    username: str
    workspace: WorkspaceOut
    key: KeyOut


@router.get("/me")
def get_me(person: KeyPerson, key: Key, request: Request) -> MeOut:
    """Who the key signs in, where, and what it may do."""
    name = request.app.state.workspaces.name(key.workspace_id) or ""
    return MeOut(
        id=person.id,
        name=person.name,
        username=person.username,
        workspace=WorkspaceOut(id=key.workspace_id, name=name),
        key=KeyOut(name=key.name, scope=key.scope, boards=key.boards, expires_at=key.expires_at),
    )
