import contextlib
import io
import json
import logging
import lzma
import os
import threading
from pathlib import Path

from PIL import Image
from rlottie_python import LottieAnimation

from app.domain.stickers import Sticker

NOTO = Path(__file__).parent / "noto"
log = logging.getLogger(__name__)
# A sticker is placed 160 px wide; 256 gives a retina screen at 100 % zoom nearly every pixel.
LARGE_PX = 256
# A panel cell is 48 px; twice that keeps it sharp on a retina screen.
SMALL_PX = 96
# Noto is drawn at 60 fps; every second frame plays as smoothly as Google's own WebP at half
# the weight.
FPS = 30
QUALITY = 80
# Edges of transparency do not need lossless alpha; it is most of the weight otherwise.
ALPHA_QUALITY = 70
# Part of every cached name: a change to how stickers are drawn makes new files, not stale ones.
DRAWING = "1"
# Drawing a large sticker takes a core for a moment; a board opened after a restart asks for
# many at once, and the rest of the server keeps its cores.
_DRAWING_AT_ONCE = threading.Semaphore(2)


def _coverage(frame: Image.Image) -> int:
    return sum(1 for alpha in frame.getchannel("A").get_flattened_data() if alpha > 32)


def _poster(animation: LottieAnimation) -> int:
    """The frame a sticker is shown by when still: of the frames where it is drawn nearly in
    full, the one nearest the middle. Most of the set starts on a plain face and shows itself
    midway; an animal may swim in from the edge, so the middle alone can be empty."""
    frames = animation.lottie_animation_get_totalframe()
    drawn = [
        _coverage(animation.render_pillow_frame(frame_num=n, width=24, height=24))
        for n in range(frames)
    ]
    full = [n for n in range(frames) if drawn[n] >= 0.9 * max(drawn)]
    return min(full, key=lambda n: abs(n - frames // 2))


def _webp(frames: list[Image.Image], duration: int) -> bytes:
    out = io.BytesIO()
    frames[0].save(
        out,
        "WEBP",
        save_all=len(frames) > 1,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        quality=QUALITY,
        alpha_quality=ALPHA_QUALITY,
        method=4,
    )
    return out.getvalue()


def _draw(animation: LottieAnimation, side: int, moving: bool) -> bytes:
    start = _poster(animation)
    if not moving:
        return _webp([animation.render_pillow_frame(frame_num=start, width=side, height=side)], 0)
    frames = animation.lottie_animation_get_totalframe()
    rate = animation.lottie_animation_get_framerate()
    step = max(1, round(rate / FPS))
    # The loop starts on the poster frame, so a sticker standing still shows what it shows
    # when it plays.
    drawn = [
        animation.render_pillow_frame(frame_num=(start + n) % frames, width=side, height=side)
        for n in range(0, frames, step)
    ]
    return _webp(drawn, round(1000 * step / rate))


class LottieStickers:
    """Noto Animated Emoji, kept as Lottie and drawn to WebP with rlottie on request. What is
    drawn is kept in `cache`, a folder anyone may empty: it is drawn again when asked for."""

    def __init__(self, cache: Path | None = None, folder: Path = NOTO) -> None:
        self._folder = folder
        self._cache = cache
        entries = json.loads((folder / "catalog.json").read_text())
        self._catalog = [Sticker(**entry) for entry in entries]
        self._codes = {sticker.code for sticker in self._catalog}
        # One lock per drawing; a few thousand at most, for the set in two sizes, still and moving.
        self._locks: dict[str, threading.Lock] = {}
        self._locks_lock = threading.Lock()

    def catalog(self) -> list[Sticker]:
        return self._catalog

    def picture(self, code: str, large: bool, moving: bool) -> bytes | None:
        # Only codes of the catalog reach the disk: a code is never a path.
        if code not in self._codes:
            return None
        name = f"{code}-{'large' if large else 'small'}-{'moving' if moving else 'still'}"
        kept = self._cache / f"{name}-{DRAWING}.webp" if self._cache else None
        if kept and kept.exists():
            return kept.read_bytes()
        # A board opened cold asks for the same sticker from many browsers at once: the first
        # request draws it, the others wait for that drawing instead of making their own.
        with self._drawing(name):
            if kept and kept.exists():
                return kept.read_bytes()
            source = lzma.decompress((self._folder / f"{code}.json.xz").read_bytes()).decode()
            with _DRAWING_AT_ONCE:
                side = LARGE_PX if large else SMALL_PX
                data = _draw(LottieAnimation.from_data(source), side, moving)
            if kept:
                _keep(kept, data)
        return data

    def _drawing(self, name: str) -> threading.Lock:
        with self._locks_lock:
            return self._locks.setdefault(name, threading.Lock())


def _keep(path: Path, data: bytes) -> None:
    """Best effort: a full or read-only disk still serves the sticker, drawn again next time."""
    part = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.part")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Written aside and renamed, so a reader never gets half a file.
        part.write_bytes(data)
        part.replace(path)
    except OSError:
        log.warning("sticker not kept in %s", path.parent, exc_info=True)
        with contextlib.suppress(OSError):
            part.unlink(missing_ok=True)
