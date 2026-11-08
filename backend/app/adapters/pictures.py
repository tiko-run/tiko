import io
import warnings

from PIL import Image, ImageCms, ImageOps, ImageSequence, UnidentifiedImageError

from app.domain.errors import FileTooLarge, UnsupportedFile
from app.domain.files import COPY_WIDTHS, MAX_PIXELS, Picture

FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif"}
# Metadata a picture may carry: camera, place, the software that made it.
_META = ("exif", "xmp", "XML:com.adobe.xmp", "comment")
# What a saved picture keeps of its info: how it is drawn, nothing about where it came from.
_KEPT = ("transparency", "duration", "loop", "background")
COPY_QUALITY = 90
# A moving picture plays at most this wide: enough for a GIF on a board, light to decode.
MOTION_WIDTH = 1024
MOTION_QUALITY = 80
# WebP cannot be taller or wider than this; a copy past it is left out and the original serves.
WEBP_MAX_SIDE = 16383
_SRGB = ImageCms.createProfile("sRGB")
# Every frame of a moving picture is decoded in turn: a small GIF with thousands of large
# frames would otherwise fill the worker's memory.
MAX_FRAME_PIXELS = 100_000_000


def _open(data: bytes) -> Image.Image:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(io.BytesIO(data), formats=list(FORMATS))
            width, height = image.size
            if width * height > MAX_PIXELS:
                raise FileTooLarge("The picture is over 50 megapixels.")
            if width * height * getattr(image, "n_frames", 1) > MAX_FRAME_PIXELS:
                raise FileTooLarge("The animation is too long or too large.")
            image.load()
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise FileTooLarge("The picture is over 50 megapixels.") from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise UnsupportedFile("This file is not a picture tiko can show.") from exc
    return image


def _has_meta(image: Image.Image) -> bool:
    return (
        bool(image.getexif())
        or any(key in image.info for key in _META)
        or bool(getattr(image, "text", None))
    )


def _bare(frame: Image.Image) -> Image.Image:
    frame.info = {key: frame.info[key] for key in _KEPT if key in frame.info}
    return frame


def _without_meta(image: Image.Image, moving: bool) -> bytes:
    out = io.BytesIO()
    kind = image.format or "PNG"
    extra = {"icc_profile": image.info["icc_profile"]} if "icc_profile" in image.info else {}
    if kind in ("JPEG", "WEBP"):
        extra |= {"quality": 95}
    if "transparency" in image.info:
        extra |= {"transparency": image.info["transparency"]}
    if moving:
        frames = [_bare(frame.copy()) for frame in ImageSequence.Iterator(image)]
        frames[0].save(
            out,
            kind,
            save_all=True,
            append_images=frames[1:],
            duration=[frame.info.get("duration", 100) for frame in frames],
            loop=image.info.get("loop", 0),
            **extra,
        )
    else:
        _bare(ImageOps.exif_transpose(image)).save(out, kind, **extra)
    return out.getvalue()


def _srgb(frame: Image.Image, icc: bytes | None) -> Image.Image:
    """The frame in sRGB, as browsers assume for a picture without a profile."""
    if not icc:
        return frame
    try:
        source = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        return ImageCms.profileToProfile(frame, source, _SRGB, outputMode=frame.mode) or frame
    except (ImageCms.PyCMSError, OSError):
        return frame


def _flat(image: Image.Image) -> Image.Image:
    """The first frame in a mode WebP takes, keeping transparency, in sRGB."""
    image.seek(0)
    see_through = image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info
    return _srgb(image.convert("RGBA" if see_through else "RGB"), image.info.get("icc_profile"))


def _webp(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, "WEBP", quality=COPY_QUALITY, method=4)
    return out.getvalue()


def _motion(image: Image.Image) -> bytes:
    """The moving picture as an animated WebP, several times lighter than a GIF."""
    width, height = image.size
    scale = min(1.0, MOTION_WIDTH / width, WEBP_MAX_SIDE / height)
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    frames, durations = [], []
    icc = image.info.get("icc_profile")
    for frame in ImageSequence.Iterator(image):
        # A WebP frame tells its duration only once it is loaded.
        frame.load()
        durations.append(frame.info.get("duration", 100))
        frame = _srgb(frame.convert("RGBA"), icc)
        frames.append(frame.resize(size, Image.Resampling.LANCZOS) if scale < 1 else frame)
    out = io.BytesIO()
    frames[0].save(
        out,
        "WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=image.info.get("loop", 0),
        quality=MOTION_QUALITY,
        method=4,
    )
    return out.getvalue()


def _color(image: Image.Image) -> str:
    red, green, blue = image.convert("RGB").resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
    return f"#{red:02x}{green:02x}{blue:02x}"


class PillowPictures:
    def make(self, data: bytes) -> Picture:
        image = _open(data)
        moving = getattr(image, "is_animated", False)
        upright = _flat(ImageOps.exif_transpose(image) if not moving else image)
        width, height = upright.size
        # A moving picture is drawn still from a copy, so it gets one even when it is small.
        widths = (
            sorted({min(w, width) for w in COPY_WIDTHS}, reverse=True)
            if moving
            else [w for w in reversed(COPY_WIDTHS) if w < width]
        )
        copies: dict[int, bytes] = {}
        smaller = upright
        for copy_width in widths:
            size = (copy_width, max(1, round(height * copy_width / width)))
            if size[1] > WEBP_MAX_SIDE:
                continue
            # Each copy from the one before it: a 4K picture is read in full only once.
            smaller = smaller.resize(size, Image.Resampling.LANCZOS, reducing_gap=3.0)
            copies[copy_width] = _webp(smaller)
        original = _without_meta(image, moving) if _has_meta(image) else data
        motion = _motion(image) if moving else None
        return Picture(
            mime=FORMATS[image.format],
            data=original,
            width=width,
            height=height,
            color=_color(smaller),
            moving=moving,
            copies=copies,
            motion=motion,
        )
