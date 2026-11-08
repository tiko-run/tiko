import io
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

from app.domain.errors import FileTooLarge, UnsupportedFile
from app.domain.files import COPY_WIDTHS, MAX_PIXELS, Picture

FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif"}
# Metadata a picture may carry: camera, place, the software that made it.
_META = ("exif", "xmp", "XML:com.adobe.xmp", "comment")
COPY_QUALITY = 90


def _open(data: bytes) -> Image.Image:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(io.BytesIO(data), formats=list(FORMATS))
            width, height = image.size
            if width * height > MAX_PIXELS:
                raise FileTooLarge("The picture is over 50 megapixels.")
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


def _without_meta(image: Image.Image, upright: Image.Image) -> bytes:
    out = io.BytesIO()
    kind = image.format or "PNG"
    extra = {"icc_profile": image.info["icc_profile"]} if "icc_profile" in image.info else {}
    if kind == "JPEG" or kind == "WEBP":
        extra |= {"quality": 95}
    upright.save(out, kind, **extra)
    return out.getvalue()


def _flat(image: Image.Image) -> Image.Image:
    """The first frame in a mode WebP takes, keeping transparency."""
    image.seek(0)
    see_through = image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info
    return image.convert("RGBA" if see_through else "RGB")


def _webp(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, "WEBP", quality=COPY_QUALITY, method=4)
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
            # Each copy from the one before it: a 4K picture is read in full only once.
            smaller = smaller.resize(size, Image.Resampling.LANCZOS, reducing_gap=3.0)
            copies[copy_width] = _webp(smaller)
        original = data
        if not moving and _has_meta(image):
            original = _without_meta(image, ImageOps.exif_transpose(image))
        return Picture(
            mime=FORMATS[image.format],
            data=original,
            width=width,
            height=height,
            color=_color(smaller),
            moving=moving,
            copies=copies,
        )
