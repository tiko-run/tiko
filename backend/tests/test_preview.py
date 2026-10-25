import time
import xml.etree.ElementTree as ET
from datetime import UTC, datetime

from app.domain.boards import BoardDoc
from app.domain.preview import draw
from app.domain.welcome import welcome_doc

SVG = "{http://www.w3.org/2000/svg}"


def board(nodes, edges=()):
    return BoardDoc.model_validate({"nodes": nodes, "edges": list(edges)})


def node(node_id, kind, data, x=0, y=0, **extra):
    return {"id": node_id, "type": kind, "position": {"x": x, "y": y}, "data": data} | extra


def parsed(doc):
    svg = draw(doc)
    assert svg is not None
    return svg, ET.fromstring(svg)


def texts(root):
    return ["".join(el.itertext()) for el in root.iter(f"{SVG}text")]


GANTT = {
    "start": "2026-10-01",
    "end": "2026-10-31",
    "rows": [
        {"id": "a", "title": "Secret plan", "start": "2026-10-05", "end": "2026-10-09"},
        {"id": "b", "key": "DEV-2", "start": "2026-10-12", "end": "2026-10-20"},
    ],
}


def test_every_kind_of_element_is_drawn_in_its_place():
    svg, root = parsed(
        board(
            [
                node(
                    "f",
                    "frame",
                    {"title": "Sprint", "color": "blue"},
                    100,
                    100,
                    width=480,
                    height=320,
                ),
                node("c", "task_card", {"key": "DEV-1"}, 20, 30, parentId="f"),
                node("s", "sticky", {"text": "Ship it\non Friday", "color": "pink"}, 700, 100),
                node(
                    "sh",
                    "shape",
                    {"shape": "hexagon", "text": "Idea"},
                    700,
                    400,
                    width=160,
                    height=100,
                ),
                node("t", "text", {"text": "Notes"}, 0, 600),
                node("g", "module", {"kind": "gantt", "content": GANTT}, 0, 800),
                node("x", "module", {"kind": "future_kind", "content": {}}, 1000, 800),
                node("end", "anchor", {}, 1200, 0),
            ],
            [{"id": "e", "source": "s", "target": "end"}],
        )
    )
    assert texts(root) == ["Sprint", "DEV-1", "Ship iton Friday", "Idea", "Notes"]
    card = next(el for el in root.iter(f"{SVG}text") if el.text == "DEV-1")
    # Inside the frame: its own offset plus the frame's.
    assert (card.get("x"), card.get("y")) == ("130", "152")
    assert len(root.findall(f".//{SVG}line")) == 1
    gantt_bars = [el for el in root.iter(f"{SVG}rect") if el.get("height") == "18"]
    assert len(gantt_bars) == 2
    assert "#ffdeea" in svg and "#cef1ff" in svg


def test_no_task_title_gets_in():
    svg = draw(board([node("g", "module", {"kind": "gantt", "content": GANTT})]))
    assert svg is not None and "Secret" not in svg and "DEV-2" not in svg


def test_text_is_escaped():
    hostile = "<script>alert(1)</script> & \x07 ]]>"
    svg, root = parsed(board([node("s", "sticky", {"text": hostile})]))
    assert "<script" not in svg
    assert not list(root.iter(f"{SVG}script"))
    assert texts(root) == ["<script>alert(1)</script> &  ]]>"]


def test_an_empty_board_has_no_preview():
    assert draw(BoardDoc()) is None
    assert draw(board([node("a", "anchor", {})])) is None


def test_the_welcome_board_draws():
    svg, _ = parsed(BoardDoc.model_validate(welcome_doc(datetime.now(UTC))))
    assert len(svg) < 50_000


def test_a_huge_board_stays_small_and_quick():
    nodes = [
        node(
            f"n{i}",
            "sticky",
            {"text": f"Sticky note number {i}\nwith a second line\nand a third"},
            (i % 50) * 220,
            (i // 50) * 220,
        )
        for i in range(2000)
    ]
    raw = BoardDoc.model_validate({"nodes": nodes}).model_dump_json(exclude_none=True)
    started = time.perf_counter()
    svg = draw(BoardDoc.model_validate_json(raw))
    elapsed = time.perf_counter() - started
    assert svg is not None
    # SC-005: under 50 KB and 200 ms; the margin leaves room for slow CI runners.
    assert len(svg.encode()) < 50_000
    assert elapsed < 0.2


def test_a_heavy_board_drops_text_then_elements_to_fit():
    text = "\n".join(["W" * 40] * 4)
    nodes = [
        node(f"n{i}", "sticky", {"text": text}, (i % 20) * 40, (i // 20) * 40) for i in range(400)
    ]
    edges = [{"id": f"e{i}", "source": f"n{i}", "target": f"n{i + 1}"} for i in range(399)]
    svg = draw(board(nodes, edges))
    assert svg is not None and len(svg.encode()) <= 50_000


def test_a_note_without_a_size_takes_the_size_of_its_text():
    _, root = parsed(board([node("s", "sticky", {"text": "Idea 0", "color": "green"})]))
    note = next(el for el in root.iter(f"{SVG}rect"))
    assert (note.get("width"), note.get("height")) == ("58", "28")


def test_a_frame_or_shape_without_a_size_is_not_drawn_as_on_the_board():
    doc = board(
        [
            node("t", "text", {"text": "Kept"}),
            node("f", "frame", {"title": "Ghost"}, 900, 900),
            node("sh", "shape", {"shape": "ellipse", "text": "Mood"}, 300, 0),
        ]
    )
    svg, root = parsed(doc)
    assert texts(root) == ["Kept"] and "ellipse" not in svg
    # Nor does it stretch the picture: the view box ends near the text.
    assert int(root.get("viewBox").split()[2]) < 400


def test_an_arrow_to_a_bare_end_stays_in_the_picture():
    doc = board(
        [
            node("s", "sticky", {"text": "Go"}, width=100, height=100),
            node("end", "anchor", {}, 900, 50),
        ],
        [{"id": "e", "source": "s", "target": "end"}],
    )
    _, root = parsed(doc)
    x, _, width, _ = (int(v) for v in root.get("viewBox").split())
    assert x + width >= 900 + 40
