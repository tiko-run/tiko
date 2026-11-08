from dataclasses import dataclass

from app.domain.errors import NotFound, StickerLimit
from app.domain.files import Files, Served, StoredFile
from app.domain.ports import StickerArt, StickerPack

# Up to this wide on screen a built-in sticker is drawn small, for a cell of the panel.
PANEL_WIDTH = 96
# A pack is a shelf people pick from, not an archive; past this it stops being browsable.
PACK_LIMIT = 500
NAME_MAX = 64


@dataclass(frozen=True)
class Sticker:
    """One of the built-in stickers, named by its emoji code point."""

    code: str
    name: str
    tags: list[str]
    category: str


@dataclass(frozen=True)
class PackSticker:
    """A picture of the workspace saved to its stickers; the file is the one already stored."""

    id: str
    name: str
    file: StoredFile


class Stickers:
    def __init__(self, art: StickerArt, pack: StickerPack, files: Files) -> None:
        self._art = art
        self._pack = pack
        self._files = files

    def catalog(self) -> list[Sticker]:
        return self._art.catalog()

    def picture(self, code: str, width: int | None, moving: bool = False) -> bytes:
        """A built-in sticker: drawn for the panel up to its cell's width, else for a board.
        It is no file of the workspace, so it takes no room in its quota."""
        shown = self._art.picture(code, width is None or width > PANEL_WIDTH, moving)
        if shown is None:
            raise NotFound("sticker not found")
        return shown

    def pack(self) -> list[PackSticker]:
        return self._pack.list()

    def save(self, file_id: str, name: str, person_id: str) -> PackSticker:
        """Saving a picture that is in the pack already answers with it."""
        saved = self._pack.add(file_id, name.strip()[:NAME_MAX] or "Sticker", person_id, PACK_LIMIT)
        if saved is None:
            raise StickerLimit(f"The workspace has {PACK_LIMIT} stickers. Remove some first.")
        return saved

    def remove(self, sticker_id: str) -> None:
        """The picture stays where it is on boards; only the panel loses it."""
        if not self._pack.remove(sticker_id):
            raise NotFound("sticker not found")

    def use(self, sticker_id: str, board_id: str) -> StoredFile:
        """Lets the board serve a sticker of the pack, as it would a picture uploaded to it."""
        sticker = self._pack.get(sticker_id)
        if sticker is None:
            raise NotFound("sticker not found")
        self._files.link(board_id, sticker.file.id)
        return sticker.file

    def pack_picture(self, sticker_id: str, width: int | None, moving: bool = False) -> Served:
        """What the panel shows of a sticker in the pack: still, the smallest copy wide enough,
        or playing under the pointer."""
        served = self._pack.picture(sticker_id, width, moving)
        if served is None:
            raise NotFound("sticker not found")
        return served
