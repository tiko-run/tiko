"""Where the API puts what a caller did not place itself (spec 046): sizes as the web app makes
them, rows below what is on the board, frames that grow to hold what lands in them."""

from typing import Any

# As the web app makes them (frontend/src/canvas/layout.ts, Canvas.tsx, shapes.ts); a test keeps
# them equal. A card has no stored size: the browser measures it, so this is its usual one.
SIZES: dict[str, tuple[float, float]] = {
    "task_card": (320, 50),
    "sticky": (200, 200),
    "text": (240, 40),
    "frame": (480, 320),
    "shape": (160, 100),
}
GAP = 40
PER_ROW = 4
# Room inside a frame: its title on top, a margin around what it holds.
FRAME_TOP = 56
FRAME_PAD = 24

Stored = dict[str, dict[str, Any]]


def size(node: dict[str, Any]) -> tuple[float, float]:
    guess = SIZES.get(node["type"], (200, 100))
    stored = node.get("size", {})
    return stored.get("width") or guess[0], stored.get("height") or guess[1]


def bottom(nodes: Stored) -> float:
    """The lowest edge of what lies on the board itself, outside frames."""
    edges = [
        node["place"]["y"] + size(node)[1]
        for node in nodes.values()
        if node and node["place"].get("parentId") is None and node["type"] != "anchor"
    ]
    return max(edges, default=0.0)


def grid(sizes: list[tuple[float, float]], x: float, y: float) -> list[tuple[float, float]]:
    """Top-left corners in rows of `PER_ROW`, each row as tall as its tallest element."""
    places: list[tuple[float, float]] = []
    widest = max((w for w, _ in sizes), default=0.0)
    for start in range(0, len(sizes), PER_ROW):
        row = sizes[start : start + PER_ROW]
        places += [(x + i * (widest + GAP), y) for i in range(len(row))]
        y += max(h for _, h in row) + GAP
    return places


def columns(
    groups: list[list[tuple[float, float]]], x: float, y: float
) -> list[tuple[float, float]]:
    """Top-left corners of groups set side by side, each group stacked downwards."""
    places: list[tuple[float, float]] = []
    for group in groups:
        top = y
        for _, h in group:
            places.append((x, top))
            top += h + GAP / 2
        x += max((w for w, _ in group), default=0.0) + GAP
    return places


def inside(nodes: Stored, frame_id: str, leaving: set[str] = frozenset()) -> float:
    """Where new content of a frame starts, relative to the frame: below what it holds."""
    held = [
        node["place"]["y"] + size(node)[1]
        for node_id, node in nodes.items()
        if node and node["place"].get("parentId") == frame_id and node_id not in leaving
    ]
    return max(held, default=FRAME_TOP - GAP) + GAP


def grow(frame: dict[str, Any], places: list[tuple[float, float]], sizes) -> dict[str, Any]:
    """The frame made big enough for elements at these places inside it."""
    width, height = size(frame)
    for (x, y), (w, h) in zip(places, sizes, strict=True):
        width, height = max(width, x + w + FRAME_PAD), max(height, y + h + FRAME_PAD)
    return {**frame, "size": {**frame.get("size", {}), "width": width, "height": height}}
