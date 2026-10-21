"""A small SVG picture of a board, drawn from its document alone.

Nothing outside the document is read, so no task title or tracker name can get in. The picture
is shown through `<img>` on both themes, so it uses colors that read on light and dark alike.
"""

import re
from datetime import date
from xml.sax.saxutils import escape

from app.domain.boards import (
    BoardDoc,
    FrameNode,
    ModuleNode,
    Node,
    ShapeNode,
    StickyNode,
    TaskCardNode,
    TextNode,
)
from app.domain.errors import NotFound
from app.domain.ports import BoardRepo

WIDTH, HEIGHT = 320, 200
# Board units around the content, so nothing touches the card's edge.
MARGIN = 40
# The largest elements win past this: a huge board stays small and quick to draw (SC-005).
MAX_DRAWN = 400
MAX_BYTES = 48_000
MAX_LINES, MAX_CHARS = 4, 40
# Text smaller than this on the picture is noise and bytes: elements are drawn without it.
MIN_TEXT_PX = 2
GANTT_HEADER, GANTT_ROW = 48, 34

LINE = "#81878f"
INK = "#1c1f24"
ACCENT = "#3280dd"
STICKY = {
    "yellow": "#f5ecc6",
    "orange": "#ffe4ca",
    "pink": "#ffdeea",
    "violet": "#f0e4ff",
    "blue": "#cef1ff",
    "green": "#d5f5da",
}
FONT = "system-ui, sans-serif"
SLANT, CAP = 0.2, 0.12
# Sizes the web app gives an element that has none stored.
SIZE = {
    "task_card": (240, 72),
    "sticky": (200, 200),
    "frame": (480, 320),
    "shape": (160, 100),
    "text": (240, 0),
    "module": (960, 320),
}
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")

Box = tuple[float, float, float, float]


def _text(value: str) -> str:
    return escape(_CONTROL.sub("", value))


def _lines(text: str) -> list[str]:
    out: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if line:
            out.append(line[:MAX_CHARS])
        if len(out) == MAX_LINES:
            break
    return out


def _n(value: float) -> str:
    return str(round(value))


def _size(node: Node) -> tuple[float, float]:
    width, height = SIZE.get(node.type, (0, 0))
    width = node.width or width
    if node.height:
        return width, node.height
    if isinstance(node, TextNode):
        return width, 20 * max(1, len(_lines(node.data.text)))
    return width, height


def _boxes(doc: BoardDoc) -> dict[str, Box]:
    """Each node's box on the board; a child's position is relative to its parent."""
    boxes: dict[str, Box] = {}
    for node in doc.nodes:
        x, y = node.position.x, node.position.y
        if node.parentId in boxes:
            x, y = x + boxes[node.parentId][0], y + boxes[node.parentId][1]
        boxes[node.id] = (x, y, *_size(node))
    return boxes


def _shape_path(kind: str, x: float, y: float, w: float, h: float) -> str:
    def p(px: float, py: float) -> str:
        return f"{_n(x + px)} {_n(y + py)}"

    s, mx, my = w * SLANT, w / 2, h / 2
    if kind == "ellipse":
        return f"<ellipse cx='{_n(x + mx)}' cy='{_n(y + my)}' rx='{_n(mx)}' ry='{_n(my)}'"
    if kind in ("rectangle", "rounded"):
        radius = min(w, h) * 0.2 if kind == "rounded" else 0
        return f"<rect x='{_n(x)}' y='{_n(y)}' width='{_n(w)}' height='{_n(h)}' rx='{_n(radius)}'"
    if kind == "cylinder":
        ry = h * CAP
        return (
            f"<path d='M{p(0, ry)}A{_n(mx)} {_n(ry)} 0 0 1 {p(w, ry)}V{_n(y + h - ry)}"
            f"A{_n(mx)} {_n(ry)} 0 0 1 {p(0, h - ry)}Z"
            f"M{p(0, ry)}A{_n(mx)} {_n(ry)} 0 0 0 {p(w, ry)}'"
        )
    points = {
        "rhombus": [(mx, 0), (w, my), (mx, h), (0, my)],
        "triangle": [(mx, 0), (w, h), (0, h)],
        "parallelogram": [(s, 0), (w, 0), (w - s, h), (0, h)],
        "hexagon": [(s, 0), (w - s, 0), (w, my), (w - s, h), (s, h), (0, my)],
    }[kind]
    return "<path d='M" + "L".join(p(px, py) for px, py in points) + "Z'"


def _gantt(node: ModuleNode, x: float, y: float, w: float, h: float) -> list[str]:
    content = node.data.content
    out = [
        f"<rect x='{_n(x)}' y='{_n(y)}' width='{_n(w)}' height='{_n(h)}' rx='6'"
        f" fill='{LINE}' fill-opacity='.08' stroke='{LINE}'/>"
    ]
    try:
        start = date.fromisoformat(content["start"])
        days = max(1, (date.fromisoformat(content["end"]) - start).days + 1)
    except (KeyError, TypeError, ValueError):
        return out
    left = x + content.get("labelWidth", 160)
    span = x + w - left
    parents = {row.get("parent") for row in content.get("rows", [])}
    for i, row in enumerate(content.get("rows", [])):
        top = y + GANTT_HEADER + i * GANTT_ROW + 8
        if top + 18 > y + h or span <= 0:
            break
        try:
            first = (date.fromisoformat(row["start"]) - start).days
            last = (date.fromisoformat(row["end"]) - start).days + 1
        except (KeyError, TypeError, ValueError):
            continue
        first, last = max(0, first), min(days, last)
        if last <= first:
            continue
        opacity = ".35" if row.get("id") in parents else ".7"
        out.append(
            f"<rect x='{_n(left + span * first / days)}' y='{_n(top)}'"
            f" width='{_n(span * (last - first) / days)}' height='18' rx='4'"
            f" fill='{ACCENT}' fill-opacity='{opacity}'/>"
        )
    return out


def _lines_svg(lines: list[str], x: float, y: float, size: int, color: str) -> str:
    if not lines:
        return ""
    spans = "".join(
        f"<tspan x='{_n(x)}' dy='{0 if i == 0 else round(size * 1.3)}'>{_text(line)}</tspan>"
        for i, line in enumerate(lines)
    )
    return f"<text x='{_n(x)}' y='{_n(y + size)}' font-size='{size}' fill='{color}'>{spans}</text>"


def _node(node: Node, box: Box, words: bool) -> list[str]:
    x, y, w, h = box
    if w <= 0 or h <= 0:
        return []
    if isinstance(node, FrameNode):
        color = STICKY.get(node.data.color or "")
        fill = f"fill='{color}' fill-opacity='.6'" if color else f"fill='{LINE}' fill-opacity='.08'"
        out = [
            f"<rect x='{_n(x)}' y='{_n(y)}' width='{_n(w)}' height='{_n(h)}' rx='6'"
            f" {fill} stroke='{LINE}'/>"
        ]
        if words and node.data.title.strip():
            out.append(
                f"<text x='{_n(x)}' y='{_n(y - 8)}' font-size='13' fill='{LINE}'>"
                f"{_text(node.data.title.strip()[:MAX_CHARS])}</text>"
            )
        return out
    if isinstance(node, StickyNode):
        color = STICKY.get(node.data.color, STICKY["yellow"])
        return [
            f"<rect x='{_n(x)}' y='{_n(y)}' width='{_n(w)}' height='{_n(h)}' rx='4'"
            f" fill='{color}'/>",
            _lines_svg(_lines(node.data.text), x + 12, y + 10, 14, INK) if words else "",
        ]
    if isinstance(node, ShapeNode):
        color = STICKY.get(node.data.color)
        if color:
            fill = f"fill='{color}'"
        elif node.data.color == "surface":
            fill = f"fill='{LINE}' fill-opacity='.08'"
        else:
            fill = "fill='none'"
        text = _lines(node.data.text)[:1] if words else []
        label = ""
        if text:
            label = (
                f"<text x='{_n(x + w / 2)}' y='{_n(y + h / 2 + 5)}' font-size='14'"
                f" text-anchor='middle' fill='{INK if color else LINE}'>{_text(text[0])}</text>"
            )
        stroke = INK if color else LINE
        return [f"{_shape_path(node.data.shape, x, y, w, h)} {fill} stroke='{stroke}'/>", label]
    if isinstance(node, TextNode):
        if words:
            return [_lines_svg(_lines(node.data.text), x, y, 16, LINE)]
        return [
            f"<rect x='{_n(x)}' y='{_n(y)}' width='{_n(w)}' height='{_n(h)}'"
            f" fill='{LINE}' fill-opacity='.3'/>"
        ]
    if isinstance(node, TaskCardNode):
        card = (
            f"<rect x='{_n(x)}' y='{_n(y)}' width='{_n(w)}' height='{_n(h)}' rx='6'"
            f" fill='{LINE}' fill-opacity='.08' stroke='{LINE}'/>"
        )
        if not words:
            return [card]
        return [
            card,
            f"<text x='{_n(x + 10)}' y='{_n(y + 22)}' font-size='13' font-family='monospace'"
            f" fill='{ACCENT}'>{_text(node.data.key)}</text>",
        ]
    if isinstance(node, ModuleNode) and node.data.kind == "gantt":
        return _gantt(node, x, y, w, h)
    if isinstance(node, ModuleNode):
        return [
            f"<rect x='{_n(x)}' y='{_n(y)}' width='{_n(w)}' height='{_n(h)}' rx='6'"
            f" fill='{LINE}' fill-opacity='.12'/>"
        ]
    # Anchors are arrow ends and timers sit on other elements: neither is drawn.
    return []


def draw(doc: BoardDoc) -> str | None:
    """The board as a WIDTH by HEIGHT SVG; None when there is nothing to draw."""
    boxes = _boxes(doc)
    cap, text = MAX_DRAWN, True
    while True:
        svg = _draw(doc, boxes, cap, text)
        if svg is None or len(svg.encode()) <= MAX_BYTES or cap == 1:
            return svg
        # Too heavy: text goes first, then half of the smallest elements at a time.
        cap, text = (cap, False) if text else (max(1, cap // 2), False)


def _draw(doc: BoardDoc, boxes: dict[str, Box], cap: int, text: bool) -> str | None:
    shown = [n for n in doc.nodes if n.type not in ("anchor", "timer")]
    if len(shown) > cap:
        by_area = sorted(shown, key=lambda n: boxes[n.id][2] * boxes[n.id][3], reverse=True)
        keep = {n.id for n in by_area[:cap]}
        shown = [n for n in shown if n.id in keep]
    if not shown:
        return None
    left = min(boxes[n.id][0] for n in shown) - MARGIN
    # A frame's title sits above it.
    top = min(boxes[n.id][1] - (24 if n.type == "frame" else 0) for n in shown) - MARGIN
    right = max(boxes[n.id][0] + boxes[n.id][2] for n in shown) + MARGIN
    bottom = max(boxes[n.id][1] + boxes[n.id][3] for n in shown) + MARGIN
    scale = min(WIDTH / (right - left), HEIGHT / (bottom - top))
    words = text and 13 * scale >= MIN_TEXT_PX

    drawn = {n.id for n in shown} | {n.id for n in doc.nodes if n.type == "anchor"}
    edges = []
    for edge in doc.edges:
        if len(edges) < cap and edge.source in drawn and edge.target in drawn:
            (sx, sy, sw, sh), (tx, ty, tw, th) = boxes[edge.source], boxes[edge.target]
            edges.append(
                f"<line x1='{_n(sx + sw / 2)}' y1='{_n(sy + sh / 2)}'"
                f" x2='{_n(tx + tw / 2)}' y2='{_n(ty + th / 2)}'/>"
            )
    frames = [part for n in shown if n.type == "frame" for part in _node(n, boxes[n.id], words)]
    rest = [part for n in shown if n.type != "frame" for part in _node(n, boxes[n.id], words)]
    edge_group = f"<g stroke='{LINE}' stroke-width='1.5'>{''.join(edges)}</g>" if edges else ""
    view = f"{_n(left)} {_n(top)} {_n(right - left)} {_n(bottom - top)}"
    return (
        f"<svg xmlns='http://www.w3.org/2000/svg' width='{WIDTH}' height='{HEIGHT}'"
        f" viewBox='{view}' preserveAspectRatio='xMidYMid meet' font-family='{FONT}'>"
        f"<style>*{{vector-effect:non-scaling-stroke}}</style>"
        f"{''.join(frames)}{edge_group}{''.join(rest)}</svg>"
    )


def board_preview(board_id: str, boards: BoardRepo, seen: set[int]) -> tuple[int, str | None]:
    """The version the board's preview follows and the preview, or no preview when the caller
    has `seen` that version. Drawn here, not on save, so a save is never held up."""
    found = boards.preview(board_id)
    if found is None:
        raise NotFound("board not found")
    version, svg = found
    if version in seen:
        return version, None
    if svg is None:
        record = boards.get(board_id)
        if record is None:
            raise NotFound("board not found")
        svg = draw(record.doc)
        if svg is None:
            raise NotFound("board has nothing to preview")
        version = record.version
        boards.keep_preview(board_id, version, svg)
    return version, svg
