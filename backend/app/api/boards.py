import re
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from app.api import deps
from app.api.deps import (
    AccountsDep,
    CanEdit,
    CanView,
    CurrentPerson,
    IsOwner,
    MembersDep,
    NotDemoVisitor,
)
from app.domain import boards as service
from app.domain.boards import BoardDoc, BoardName, BoardSummary, BoardView
from app.domain.demo import board_limit
from app.domain.errors import BoardLimit
from app.domain.members import Member, ShareRole
from app.domain.ports import BoardRepo, LiveBoards, SnapshotRepo, TaskProvider
from app.domain.preview import board_preview
from app.domain.public import PublicLinks
from app.domain.refresh import RefreshService, SourceStatus
from app.domain.settings import SettingsService
from app.domain.tasks import Task, now_iso

router = APIRouter(prefix="/boards", tags=["boards"])

ENTITY_TAG = re.compile(r'(?:W/)?"([^"]*)"')
PREVIEW_HEADERS = {
    "Cache-Control": "private, max-age=0, must-revalidate",
    # Shown through <img>; this keeps a script out even if the file is opened on its own.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "X-Content-Type-Options": "nosniff",
}

Boards = Annotated[BoardRepo, Depends(deps.boards)]
Snapshots = Annotated[SnapshotRepo, Depends(deps.snapshots)]
Live = Annotated[LiveBoards, Depends(deps.live)]
Tracker = Annotated[str, Depends(deps.tracker)]


class BoardIn(BaseModel):
    name: BoardName


class BoardList(BaseModel):
    boards: list[BoardSummary]
    # Admins only: boards nobody shared with them, which they can still manage.
    all: list[BoardSummary]


class SaveIn(BaseModel):
    version: int
    doc: BoardDoc


class SaveOut(BaseModel):
    version: int


class RefreshOut(BaseModel):
    # By ref, `source:key`.
    tasks: dict[str, Task]
    fetched_at: str
    sources: list[SourceStatus]


class MemberList(BaseModel):
    members: list[Member]
    everyone_role: ShareRole | None
    public: bool
    # The link itself is the owner's to hand out.
    public_token: str | None


class MemberIn(BaseModel):
    role: ShareRole


class EveryoneIn(BaseModel):
    role: ShareRole | None


class TransferIn(BaseModel):
    user_id: str


class PublicIn(BaseModel):
    public: bool


class PublicOut(BaseModel):
    public: bool
    public_token: str | None


@router.get("")
def list_boards(person: CurrentPerson, boards: Boards) -> BoardList:
    mine, others = service.list_boards(person, boards, datetime.now(UTC))
    return BoardList(boards=mine, all=others)


@router.post("", status_code=201)
def create_board(
    body: BoardIn, person: CurrentPerson, boards: Boards, request: Request
) -> BoardSummary:
    limit = board_limit(person, request.app.state.board_limit)
    return service.create_board(person, body.name, boards, limit)


@router.post("/{board_id}/duplicate", status_code=201)
def duplicate_board(
    board_id: str, _: CanView, person: CurrentPerson, boards: Boards, request: Request
) -> BoardSummary:
    limit = board_limit(person, request.app.state.board_limit)
    return service.duplicate_board(person, board_id, boards, limit)


def _seen_tags(header: str | None) -> set[str]:
    # Whole quoted tags, which may hold a comma; a proxy that compresses makes them weak,
    # W/"42.1", and they still name the same picture.
    return set(ENTITY_TAG.findall(header or ""))


@router.get("/{board_id}/preview")
def get_preview(board_id: str, _: CanView, boards: Boards, request: Request) -> Response:
    tag, svg = board_preview(board_id, boards, _seen_tags(request.headers.get("if-none-match")))
    headers = {"ETag": f'"{tag}"', **PREVIEW_HEADERS}
    if svg is None:
        return Response(status_code=304, headers=headers)
    return Response(svg, media_type="image/svg+xml", headers=headers)


@router.get("/{board_id}")
def get_board(
    board_id: str,
    role: CanView,
    person: CurrentPerson,
    boards: Boards,
    snapshots: Snapshots,
    tracker: Tracker,
) -> BoardView:
    return service.get_board(person, role, board_id, boards, snapshots, tracker)


@router.put("/{board_id}")
def save_board(board_id: str, body: SaveIn, _: CanEdit, live: Live) -> SaveOut:
    return SaveOut(version=service.save_board(board_id, body.version, body.doc, live))


@router.patch("/{board_id}")
def rename_board(
    board_id: str, body: BoardIn, _: CanEdit, person: CurrentPerson, boards: Boards, live: Live
) -> BoardSummary:
    return service.rename_board(person, board_id, body.name, boards, live)


@router.delete("/{board_id}", status_code=204)
def delete_board(
    board_id: str,
    person: CurrentPerson,
    members: MembersDep,
    boards: Boards,
    live: Live,
    forever: bool = False,
) -> Response:
    # A board in the trash answers 404 to the role check, so `forever` checks on its own.
    if forever:
        service.delete_forever(person, board_id, boards)
    else:
        members.require(person, board_id, "owner")
        service.delete_board(person, board_id, boards, live)
    return Response(status_code=204)


@router.post("/{board_id}/restore", status_code=204)
def restore_board(board_id: str, person: CurrentPerson, boards: Boards) -> Response:
    service.restore_board(person, board_id, boards)
    return Response(status_code=204)


@router.post("/{board_id}/refresh")
def refresh_board(
    board_id: str,
    _: CanView,
    boards: Boards,
    snapshots: Snapshots,
    settings: Annotated[SettingsService, Depends(deps.settings)],
    tracker: Tracker,
    providers: Annotated[dict[str, TaskProvider], Depends(deps.providers)],
    refresher: Annotated[RefreshService, Depends(deps.refresher)],
    owner: Annotated[str, Depends(deps.owner)],
) -> RefreshOut:
    tasks, sources = refresher.refresh(
        board_id,
        settings.refresh_interval_s(),
        boards,
        snapshots,
        providers,
        tracker,
        owner,
    )
    return RefreshOut(tasks=tasks, fetched_at=now_iso(), sources=sources)


@router.get("/{board_id}/members")
def list_members(
    board_id: str,
    role: CanView,
    members: MembersDep,
    links: Annotated[PublicLinks, Depends(deps.public_links)],
) -> MemberList:
    listed, everyone = members.list(board_id)
    token = links.token(board_id)
    return MemberList(
        members=listed,
        everyone_role=everyone,
        public=token is not None,
        public_token=token if role == "owner" else None,
    )


@router.put("/{board_id}/members/{user_id}", dependencies=[NotDemoVisitor])
def share_board(
    board_id: str, user_id: str, body: MemberIn, _: IsOwner, members: MembersDep
) -> Member:
    return members.share(board_id, user_id, body.role)


@router.delete("/{board_id}/members/{user_id}", status_code=204, dependencies=[NotDemoVisitor])
def unshare_board(board_id: str, user_id: str, _: IsOwner, members: MembersDep) -> Response:
    members.remove(board_id, user_id)
    return Response(status_code=204)


@router.put("/{board_id}/everyone", status_code=204)
def share_with_everyone(
    board_id: str, body: EveryoneIn, _: IsOwner, members: MembersDep, request: Request
) -> Response:
    # Taking the role away stays open: a board shared before the demo was turned on can be closed.
    if body.role is not None:
        deps.not_on_demo(request)
    members.set_everyone(board_id, body.role)
    return Response(status_code=204)


@router.put("/{board_id}/public", dependencies=[NotDemoVisitor])
def set_public_link(
    board_id: str,
    body: PublicIn,
    _: IsOwner,
    links: Annotated[PublicLinks, Depends(deps.public_links)],
) -> PublicOut:
    token = links.set(board_id, body.public)
    return PublicOut(public=token is not None, public_token=token)


@router.post("/{board_id}/transfer", status_code=204, dependencies=[NotDemoVisitor])
def transfer_board(
    board_id: str,
    body: TransferIn,
    _: IsOwner,
    members: MembersDep,
    accounts: AccountsDep,
    boards: Boards,
    request: Request,
) -> Response:
    # A board handed over counts against the new owner like one they made.
    limit = board_limit(accounts.get(body.user_id), request.app.state.board_limit)
    if limit is not None and boards.owned(body.user_id) >= limit:
        raise BoardLimit("This person already holds as many boards as an account can.")
    members.transfer(board_id, body.user_id)
    return Response(status_code=204)
