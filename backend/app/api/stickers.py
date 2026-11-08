from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from app.api import deps
from app.api.deps import CanEdit, CurrentPerson
from app.api.files import SERVED_HEADERS, FileOut, Moving, Width
from app.domain.files import StoredFile
from app.domain.public import PublicLinks
from app.domain.stickers import NAME_MAX, Sticker, Stickers

router = APIRouter(tags=["stickers"])
public = APIRouter(prefix="/public", tags=["stickers"])

# The set changes only with a release; a day keeps the panel fast and picks up a new one.
CATALOG_HEADERS = {"Cache-Control": "private, max-age=86400"}
# A refreshed set may redraw a sticker under the same code, so it is kept a month, not a year.
STICKER_HEADERS = {**SERVED_HEADERS, "Cache-Control": "private, max-age=2592000"}


def _stickers(request: Request) -> Stickers:
    return request.app.state.stickers


StickersDep = Annotated[Stickers, Depends(_stickers)]


class Catalog(BaseModel):
    stickers: list[Sticker]


class PackStickerOut(BaseModel):
    id: str
    name: str
    file: FileOut


class Pack(BaseModel):
    stickers: list[PackStickerOut]


class SaveIn(BaseModel):
    file: str = Field(min_length=1, max_length=64)
    name: str = Field(default="", max_length=NAME_MAX)


def _file(stored: StoredFile) -> FileOut:
    return FileOut(
        id=stored.id,
        width=stored.width,
        height=stored.height,
        color=stored.color,
        moving=stored.moving,
    )


@router.get("/stickers")
def catalog(_: CurrentPerson, stickers: StickersDep, response: Response) -> Catalog:
    response.headers.update(CATALOG_HEADERS)
    return Catalog(stickers=stickers.catalog())


@router.get("/stickers/{code}/picture")
def picture(
    code: str, _: CurrentPerson, stickers: StickersDep, w: Width = None, move: Moving = False
) -> Response:
    return _sticker(stickers.picture(code, w, move))


@public.get("/{token}/stickers/{code}/picture")
def public_picture(
    token: str,
    code: str,
    request: Request,
    stickers: StickersDep,
    links: Annotated[PublicLinks, Depends(deps.public_links)],
    w: Width = None,
    move: Moving = False,
) -> Response:
    links.files_of(token, deps.client_address(request))
    return _sticker(stickers.picture(code, w, move))


def _sticker(data: bytes) -> Response:
    return Response(data, media_type="image/webp", headers=STICKER_HEADERS)


@router.get("/stickers/pack")
def pack(_: CurrentPerson, stickers: StickersDep) -> Pack:
    return Pack(
        stickers=[PackStickerOut(id=s.id, name=s.name, file=_file(s.file)) for s in stickers.pack()]
    )


@router.post("/stickers/pack", status_code=201)
def save(body: SaveIn, person: CurrentPerson, stickers: StickersDep) -> PackStickerOut:
    saved = stickers.save(body.file, body.name, person.id)
    return PackStickerOut(id=saved.id, name=saved.name, file=_file(saved.file))


@router.delete("/stickers/pack/{sticker_id}", status_code=204)
def remove(sticker_id: str, _: CurrentPerson, stickers: StickersDep) -> None:
    stickers.remove(sticker_id)


@router.get("/stickers/pack/{sticker_id}/picture")
def pack_picture(
    sticker_id: str, _: CurrentPerson, stickers: StickersDep, w: Width = None, move: Moving = False
) -> Response:
    served = stickers.pack_picture(sticker_id, w, move)
    return Response(served.data, media_type=served.mime, headers=SERVED_HEADERS)


@router.post("/boards/{board_id}/pack/{sticker_id}", status_code=201)
def use(board_id: str, sticker_id: str, _: CanEdit, stickers: StickersDep) -> FileOut:
    return _file(stickers.use(sticker_id, board_id))
