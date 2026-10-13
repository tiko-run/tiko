from typing import Annotated

import anyio.to_thread
from fastapi import APIRouter, Depends, Request, WebSocket
from pydantic import BaseModel

from app.api import deps
from app.api.boards import RefreshOut
from app.api.live import close, serve
from app.domain.boards import task_refs
from app.domain.errors import DomainError, NotFound, TooManyAttempts
from app.domain.live import ACCESS_CHANGED, ROOM_FULL, room_key
from app.domain.ports import BoardRepo, TaskProvider
from app.domain.public import PublicBoard, PublicLinks, guest_tasks, public_board
from app.domain.refresh import SourceError, SourceStatus
from app.domain.settings import SettingsService
from app.domain.tasks import now_iso

# Open without a session (see gate.py). Nothing here changes a board or names its people.
router = APIRouter(prefix="/public", tags=["public"])

Links = Annotated[PublicLinks, Depends(deps.public_links)]
Boards = Annotated[BoardRepo, Depends(deps.boards)]
Settings = Annotated[SettingsService, Depends(deps.settings)]


def _open_sources(request: Request, board_id: str, boards: BoardRepo) -> dict[str, TaskProvider]:
    """The trackers a guest is answered from, read with nobody's token. The demo statuses are
    the board owner's on a demo instance, where each person has their own, and the shared ones
    anywhere else."""
    owner = (boards.owner(board_id) or "") if deps.is_demo(request) else ""
    state = request.app.state
    demo: TaskProvider = state.demo.scoped(owner)
    github: TaskProvider = state.github
    return {demo.source_id: demo, github.source_id: github}


def _error(exc: DomainError) -> SourceError:
    return SourceError(
        code=exc.code, message=exc.message, retry_after=getattr(exc, "retry_after", None)
    )


class VersionOut(BaseModel):
    version: int
    # A rename changes this and not the version.
    updated_at: str


@router.get("/{token}")
def get_public_board(
    token: str, request: Request, links: Links, boards: Boards, settings: Settings
) -> PublicBoard:
    board_id, *_ = links.find(token)
    return public_board(
        board_id,
        boards,
        _open_sources(request, board_id, boards),
        settings.provider(),
        settings.base_url(),
        settings.refresh_interval_s(),
    )


@router.get("/{token}/version")
def get_public_version(token: str, links: Links) -> VersionOut:
    _, version, updated_at = links.find(token)
    return VersionOut(version=version, updated_at=updated_at)


@router.post("/{token}/refresh")
def refresh_public_board(
    token: str, request: Request, links: Links, boards: Boards, settings: Settings
) -> RefreshOut:
    board_id, *_ = links.find(token)
    record = boards.get(board_id)
    if record is None:
        raise NotFound("board not found")
    open_sources = _open_sources(request, board_id, boards)
    tasks, failed = guest_tasks(
        task_refs(record.doc, settings.provider()), open_sources, settings.base_url()
    )
    # Nothing is polled with anyone's token, so only the open sources have a sync to report.
    read = {task.source for task in tasks.values() if task.state == "ok"}
    sources = [
        SourceStatus(
            id=source,
            name=provider.source_name,
            state="error" if source in failed else "ok",
            synced_at=None if source in failed else now_iso(),
            error=_error(failed[source]) if source in failed else None,
            note=provider.source_note,
        )
        for source, provider in open_sources.items()
        if source in read or source in failed
    ]
    return RefreshOut(tasks=tasks, fetched_at=now_iso(), sources=sources)


# The board's `room` key is in the path for the proxy, which picks the process of the board by it.
@router.websocket("/{token}/live/{key}")
async def live_public_board(websocket: WebSocket, token: str, key: str) -> None:
    state = websocket.app.state
    links: PublicLinks = state.public_links
    # Accepted before the link is checked: a refused upgrade cannot carry a close code.
    await websocket.accept()
    try:
        board_id, *_ = await anyio.to_thread.run_sync(links.find, token)
        if key != room_key(board_id):
            raise NotFound("board not found")
    except NotFound:
        await close(websocket, ACCESS_CHANGED)
        return
    except TooManyAttempts:
        await close(websocket, ROOM_FULL)
        return
    guest = await state.live.join_guest(board_id)
    if isinstance(guest, int):
        await close(websocket, guest)
        return
    room = guest.room

    def alive() -> bool:
        return links.alive(token, board_id)

    try:
        # The link may have been turned off while this guest was on the way in.
        if not await anyio.to_thread.run_sync(alive):
            await close(websocket, ACCESS_CHANGED)
            return
        await serve(
            websocket,
            board_id,
            guest,
            lambda data: room.answer(guest, data),
            alive,
            ACCESS_CHANGED,
        )
    finally:
        room.leave_guest(guest)
