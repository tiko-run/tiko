from typing import Annotated

import anyio
import anyio.to_thread
from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel

from app.api import deps
from app.api.deps import CanEdit, CanView, CurrentPerson
from app.domain.errors import FileTooLarge, TooManyAttempts
from app.domain.files import MAX_BYTES, Files, Served
from app.domain.public import PublicLinks

boards = APIRouter(prefix="/boards", tags=["files"])
public = APIRouter(prefix="/public", tags=["files"])

# Making copies of a 4K picture takes a core for a moment; a few at once leave the rest free.
# A slot is taken before the body is read, so waiting uploads hold no memory; past a short
# queue an upload is turned away and the browser retries it.
_MAKING = anyio.CapacityLimiter(2)
MAX_WAITING = 8
# An address names one file forever, so the browser keeps it; a page never runs from it.
SERVED_HEADERS = {
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Security-Policy": "default-src 'none'",
    "X-Content-Type-Options": "nosniff",
}
Width = Annotated[int | None, Query(alias="w", ge=1, le=16384)]
# A moving picture asked to move gets its animated WebP; otherwise it is served still.
Moving = Annotated[bool, Query(alias="move")]


def _files(request: Request) -> Files:
    return request.app.state.files


FilesDep = Annotated[Files, Depends(_files)]


class FileOut(BaseModel):
    id: str
    width: int
    height: int
    color: str
    moving: bool


async def _body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise FileTooLarge(f"The picture is over {MAX_BYTES // (1024 * 1024)} MB.")
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > MAX_BYTES:
            raise FileTooLarge(f"The picture is over {MAX_BYTES // (1024 * 1024)} MB.")
    return bytes(data)


def _served(served: Served) -> Response:
    return Response(served.data, media_type=served.mime, headers=SERVED_HEADERS)


# The body is the picture itself, typed by Content-Type: no form parsing for one file.
@boards.post("/{board_id}/files", status_code=201)
async def upload(
    board_id: str, _: CanEdit, person: CurrentPerson, files: FilesDep, request: Request
) -> FileOut:
    if _MAKING.statistics().tasks_waiting >= MAX_WAITING:
        raise TooManyAttempts("Many pictures are uploading. Trying again in a moment.", 5)
    mime = request.headers.get("content-type", "").split(";")[0].strip().lower()
    async with _MAKING:
        data = await _body(request)
        stored = await anyio.to_thread.run_sync(lambda: files.add(data, mime, person.id, board_id))
    return FileOut(
        id=stored.id,
        width=stored.width,
        height=stored.height,
        color=stored.color,
        moving=stored.moving,
    )


@boards.get("/{board_id}/files/{file_id}")
def get_file(
    board_id: str, file_id: str, _: CanView, files: FilesDep, w: Width = None, move: Moving = False
) -> Response:
    return _served(files.open(board_id, file_id, w, move))


@public.get("/{token}/files/{file_id}")
def get_public_file(
    token: str,
    file_id: str,
    files: FilesDep,
    links: Annotated[PublicLinks, Depends(deps.public_links)],
    w: Width = None,
    move: Moving = False,
) -> Response:
    return _served(files.open(links.files_of(token), file_id, w, move))
