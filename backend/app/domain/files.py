import hashlib
from dataclasses import dataclass

from app.domain.errors import FileQuota, FileTooLarge, NotFound, UnsupportedFile
from app.domain.ports import FileStore, PictureMaker

MAX_BYTES = 25 * 1024 * 1024
MAX_PIXELS = 50_000_000
# Widths of the copies the canvas draws; only those narrower than the picture are made.
COPY_WIDTHS = (512, 1024, 2048)
TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
# A demo workspace is anyone's; a few screenshots are enough to try the feature.
DEMO_QUOTA_MB = 20


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


@dataclass(frozen=True)
class StoredFile:
    id: str
    width: int
    height: int
    color: str


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

    def add(self, data: bytes, mime: str, uploaded_by: str) -> StoredFile:
        """Keeps a picture once per workspace: the same bytes again answer with the stored file."""
        if mime not in TYPES:
            raise UnsupportedFile("Only PNG, JPEG, WebP and GIF pictures can go on a board.")
        if len(data) > MAX_BYTES:
            raise _too_large()
        sha = hashlib.sha256(data).hexdigest()
        if found := self._store.find(sha):
            return found
        picture = self._maker.make(data)
        size = len(picture.data) + sum(len(copy) for copy in picture.copies.values())
        if self._quota is not None and self._store.used() + size > self._quota:
            raise FileQuota("There is no room for more pictures in this workspace.")
        return self._store.add(sha, picture, size, uploaded_by)

    def open(self, file_id: str, width: int | None) -> Served:
        """The smallest copy at least `width` wide, else the original; without a width, the
        original. A GIF is never served moving on the canvas: past its copies, its widest."""
        served = self._store.get(file_id, width)
        if served is None:
            raise NotFound("picture not found")
        return served
