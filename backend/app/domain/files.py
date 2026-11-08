import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.domain.errors import FileQuota, FileTooLarge, NotFound, UnsupportedFile
from app.domain.ports import FileStore, PictureMaker, UnusedFiles

MAX_BYTES = 25 * 1024 * 1024
MAX_PIXELS = 50_000_000
# Widths of the copies the canvas draws; only those narrower than the picture are made.
COPY_WIDTHS = (512, 1024, 2048)
TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
# A demo workspace is anyone's; a few screenshots are enough to try the feature.
DEMO_QUOTA_MB = 20
# A picture off its last board stays this long, so undo and a pasted copy still find it.
UNUSED_DAYS = 7


@dataclass(frozen=True)
class Picture:
    """A file made fit to serve: the original without its metadata, and its copies by width."""

    mime: str
    data: bytes
    width: int
    height: int
    color: str
    moving: bool
    copies: dict[int, bytes]
    # A moving picture as an animated WebP, several times lighter than its GIF; None when still.
    motion: bytes | None = None


@dataclass(frozen=True)
class StoredFile:
    id: str
    width: int
    height: int
    color: str
    moving: bool = False


@dataclass(frozen=True)
class Served:
    data: bytes
    mime: str


def _too_large() -> FileTooLarge:
    return FileTooLarge(f"The picture is over {MAX_BYTES // (1024 * 1024)} MB.")


class Files:
    def __init__(self, store: FileStore, maker: PictureMaker, quota_mb: int | None) -> None:
        self._store = store
        self._maker = maker
        self._quota = quota_mb * 1024 * 1024 if quota_mb else None

    def add(self, data: bytes, mime: str, uploaded_by: str, board_id: str) -> StoredFile:
        """Keeps a picture once per workspace: the same bytes again answer with the stored file.
        The board it was uploaded to may serve it from then on."""
        if mime not in TYPES:
            raise UnsupportedFile("Only PNG, JPEG, WebP and GIF pictures can go on a board.")
        if len(data) > MAX_BYTES:
            raise _too_large()
        sha = hashlib.sha256(data).hexdigest()
        stored = self._store.find(sha)
        if stored is None:
            picture = self._maker.make(data)
            size = len(picture.data) + sum(len(copy) for copy in picture.copies.values())
            size += len(picture.motion or b"")
            stored = self._store.add(sha, picture, size, uploaded_by, self._quota)
            if stored is None:
                raise FileQuota("There is no room for more pictures in this workspace.")
        if not self._store.link(board_id, stored.id):
            # The cleanup deleted it between the two steps: store it again.
            return self.add(data, mime, uploaded_by, board_id)
        return stored

    def link(self, board_id: str, file_id: str) -> None:
        """Lets the board serve a file of its workspace stored before."""
        if not self._store.link(board_id, file_id):
            raise NotFound("picture not found")

    def open(self, board_id: str, file_id: str, width: int | None, moving: bool = False) -> Served:
        """What `board_id` shows of a file it refers to: moving, the animated WebP; else the
        smallest copy at least `width` wide, else the original. A moving picture asked still is
        never served moving: past its copies, its widest."""
        served = self._store.get(board_id, file_id, width, moving)
        if served is None:
            raise NotFound("picture not found")
        return served


def clean_files(files: UnusedFiles, now: datetime) -> int:
    """Deletes the pictures no board and no sticker pack has used for UNUSED_DAYS."""
    return files.clean(now.isoformat(), (now - timedelta(days=UNUSED_DAYS)).isoformat())
