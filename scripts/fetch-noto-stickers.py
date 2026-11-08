"""Fetches Noto Animated Emoji (CC BY 4.0) into the backend as xz-packed Lottie and a catalog.

Run by hand when the set should be refreshed: python3 scripts/fetch-noto-stickers.py
"""

import json
import lzma
import pathlib
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://googlefonts.github.io/noto-emoji-animation/data/api.json"
LOTTIE = "https://fonts.gstatic.com/s/e/notoemoji/latest/{code}/lottie.json"
OUT = pathlib.Path(__file__).resolve().parent.parent / "backend/app/adapters/stickers/noto"


def get(url: str) -> bytes:
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return response.read()
        except OSError:
            if attempt == 4:
                raise
            time.sleep(2**attempt)
    raise AssertionError


def fetch(icon: dict) -> dict | None:
    code = icon["codepoint"]
    path = OUT / f"{code}.json.xz"
    if not path.exists():
        try:
            data = json.loads(get(LOTTIE.format(code=code)))
        except urllib.error.HTTPError as error:
            # A few emoji on the site have no Lottie; they are left out.
            if error.code == 404:
                print(f"no Lottie for {code}")
                return None
            raise
        # xz packs the set a quarter smaller than gzip, and the standard library reads it.
        packed = lzma.compress(json.dumps(data, separators=(",", ":")).encode(), preset=9)
        path.write_bytes(packed)
    return {
        "code": code,
        "name": icon["tags"][0].strip(":").replace("-", " "),
        "tags": [tag.strip(":").replace("-", " ") for tag in icon["tags"][1:]],
        "category": icon["categories"][0],
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icons = json.loads(get(API))["icons"]
    # The site lists the most used first; the panel keeps that order inside each category.
    icons.sort(key=lambda icon: -icon["popularity"])
    with ThreadPoolExecutor(6) as pool:
        catalog = [entry for entry in pool.map(fetch, icons) if entry]
    (OUT / "catalog.json").write_text(json.dumps(catalog, indent=1) + "\n")
    print(f"{len(catalog)} stickers in {OUT}")


if __name__ == "__main__":
    main()
