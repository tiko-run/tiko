import re
from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import quote

import anyio
import anyio.to_thread
from fastapi import APIRouter, Depends, Request, Response

from app.api import deps
from app.api.deps import CanView, CurrentPerson
from app.api.planning import PlanningDep
from app.domain.boards import task_refs
from app.domain.demo import board_limit
from app.domain.errors import FileTooLarge, NotFound, TooManyAttempts
from app.domain.files import Files
from app.domain.ports import BoardRepo, SnapshotRepo
from app.domain.transfer import (
    MAX_UPLOAD_BYTES,
    MEDIA_TYPE,
    ImportOut,
    PlanningLists,
    export_board,
    import_board,
    planning_refs,
    read_bundle,
)
from app.version import VERSION

router = APIRouter(prefix="/boards", tags=["transfer"])

# An import makes copies of every picture on the board: one at a time leaves the cores to others.
_IMPORTING = anyio.CapacityLimiter(1)
MAX_WAITING = 2
_UNSAFE = re.compile(r'[\x00-\x1f\\/:*?"<>|]+')

Boards = Annotated[BoardRepo, Depends(deps.boards)]
Snapshots = Annotated[SnapshotRepo, Depends(deps.snapshots)]
Tracker = Annotated[str, Depends(deps.tracker)]


def _files(request: Request) -> Files:
    return request.app.state.files


FilesDep = Annotated[Files, Depends(_files)]


def _file_name(board: str) -> str:
    return (_UNSAFE.sub(" ", board).strip(" .") or "board") + ".tiko"


@router.get("/{board_id}/export")
def export(
    board_id: str,
    _: CanView,
    boards: Boards,
    snapshots: Snapshots,
    tracker: Tracker,
    files: FilesDep,
    planning: PlanningDep,
) -> Response:
    record = boards.get(board_id)
    if record is None:
        raise NotFound("board not found")
    types, people, fields = planning_refs(record.doc)
    lists = PlanningLists()
    if planning.enabled():
        view = planning.view()
        lists = PlanningLists(
            types=[t for t in view.types if t.id in types],
            people=[p for p in view.people if p.id in people],
            fields=[f for f in view.fields if f.id in fields],
        )
    data = export_board(
        record,
        tracker,
        snapshots.get_many(task_refs(record.doc, tracker)),
        lists,
        lambda file_id: files.original(board_id, file_id),
        VERSION,
        datetime.now(UTC),
    )
    name = _file_name(record.name)
    ascii_name = name.encode("ascii", "replace").decode().replace("?", "_")
    disposition = f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"
    return Response(
        data,
        media_type=MEDIA_TYPE,
        headers={"Content-Disposition": disposition, "Cache-Control": "no-store"},
    )


async def _body(request: Request) -> bytes:
    too_large = FileTooLarge(
        f"The file is over {MAX_UPLOAD_BYTES // (1024 * 1024)} MB, more than tiko takes at once."
    )
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        raise too_large
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > MAX_UPLOAD_BYTES:
            raise too_large
    return bytes(data)


# The body is the file itself: no form parsing for one file.
@router.post("/import", status_code=201)
async def import_file(
    person: CurrentPerson,
    boards: Boards,
    snapshots: Snapshots,
    tracker: Tracker,
    files: FilesDep,
    planning: PlanningDep,
    request: Request,
) -> ImportOut:
    if _IMPORTING.statistics().tasks_waiting >= MAX_WAITING:
        raise TooManyAttempts("Other boards are importing. Trying again in a moment.", 10)
    limit = board_limit(person, request.app.state.board_limit)
    async with _IMPORTING:
        data = await _body(request)

        return await anyio.to_thread.run_sync(
            lambda: import_board(
                person, read_bundle(data), boards, files, snapshots, planning, tracker, limit
            )
        )
