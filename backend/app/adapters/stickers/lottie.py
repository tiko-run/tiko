import io
import json
import lzma
from functools import lru_cache
from pathlib import Path

from PIL import Image
from rlottie_python import LottieAnimation

from app.domain.stickers import Sticker

NOTO = Path(__file__).parent / "noto"
# Drawn this wide on a board: a sticker is placed at 160 px, so a retina screen at 100 % zoom
# gets nearly every pixel, and a sticker stays near 270 KB.
MOVING_PX = 256
# A panel cell is 48 px; twice that keeps it sharp on a retina screen.
STILL_PX = 96
# Noto is drawn at 60 fps; every second frame plays as smoothly as Google's own WebP at half
# the weight.
FPS = 30
QUALITY = 80
# Edges of transparency do not need lossless alpha; it is most of the weight otherwise.
ALPHA_QUALITY = 70


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


class LottieStickers:
    """Noto Animated Emoji, kept as Lottie and drawn to WebP with rlottie."""

    def __init__(self, folder: Path = NOTO) -> None:
        self._folder = folder
        entries = json.loads((folder / "catalog.json").read_text())
        self._catalog = [Sticker(**entry) for entry in entries]
        self._codes = {sticker.code for sticker in self._catalog}

    def catalog(self) -> list[Sticker]:
        return self._catalog

    def _animation(self, code: str) -> LottieAnimation | None:
        # Only codes of the catalog reach the disk: a code is never a path.
        if code not in self._codes:
            return None
        data = lzma.decompress((self._folder / f"{code}.json.xz").read_bytes())
        return LottieAnimation.from_data(data.decode())

    # A few hundred stills fill a panel; each is a few KB.
    @lru_cache(maxsize=1024)  # noqa: B019 - one instance lives as long as the app
    def still(self, code: str) -> bytes | None:
        animation = self._animation(code)
        if animation is None:
            return None
        frame = animation.render_pillow_frame(
            frame_num=_poster(animation), width=STILL_PX, height=STILL_PX
        )
        return _webp([frame], 0)

    # Drawn once per process; the workspace keeps what it placed.
    @lru_cache(maxsize=32)  # noqa: B019 - one instance lives as long as the app
    def moving(self, code: str) -> bytes | None:
        return self._played(code, MOVING_PX)

    # The panel plays one sticker at a time, under the pointer; each is a few dozen KB.
    @lru_cache(maxsize=256)  # noqa: B019 - one instance lives as long as the app
    def playing(self, code: str) -> bytes | None:
        return self._played(code, STILL_PX)

    def _played(self, code: str, side: int) -> bytes | None:
        animation = self._animation(code)
        if animation is None:
            return None
        frames = animation.lottie_animation_get_totalframe()
        rate = animation.lottie_animation_get_framerate()
        step = max(1, round(rate / FPS))
        # The loop starts on the poster frame, so a sticker standing still on a board shows
        # what the panel shows.
        start = _poster(animation)
        drawn = [
            animation.render_pillow_frame(frame_num=(start + n) % frames, width=side, height=side)
            for n in range(0, frames, step)
        ]
        return _webp(drawn, round(1000 * step / rate))
