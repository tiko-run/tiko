"""Planning API batches on a board's stored state (spec 046)."""

import re
from pathlib import Path

import pytest

from app.domain import boards, layout
from app.domain.batch import _STYLES, Batch, Change, NewElement, plan
from app.domain.errors import KeepsPeopleWork, ValidationFailed, VoteRunning

FRONTEND = Path(__file__).parents[2] / "frontend/src/canvas"


def node(kind: str, x: float, y: float, parent: str | None = None, **data) -> dict:
    place = {"x": x, "y": y} | ({"parentId": parent} if parent else {})
    size = {"width": 480, "height": 320} if kind == "frame" else {"width": 200, "height": 200}
    defaults = {
        "frame": {"title": "F"},
        "sticky": {"text": "", "color": "yellow"},
        "timer": {"note": "", "done": False},
    }
    return {"type": kind, "place": place, "size": size, "order": 1, "data": defaults[kind] | data}


def test_sizes_match_what_the_web_app_makes():
    shown = (FRONTEND / "Canvas.tsx").read_text()
    for kind, name in (("frame", "frame"), ("sticky", "sticky")):
        match = re.search(rf"{name}: {{ width: (\d+), height: (\d+)", shown)
        assert match, name
        assert layout.SIZES[kind] == (int(match.group(1)), int(match.group(2)))
    assert re.search(r"text: { width: (\d+)", shown).group(1) == str(int(layout.SIZES["text"][0]))
    pattern = r"CARD_GUESS: Size = { width: (\d+), height: (\d+)"
    card = re.search(pattern, (FRONTEND / "layout.ts").read_text())
    assert layout.SIZES["task_card"] == (int(card.group(1)), int(card.group(2)))
    pattern = r"SHAPE_SIZE = { width: (\d+), height: (\d+)"
    shape = re.search(pattern, (FRONTEND / "shapes.ts").read_text())
    assert layout.SIZES["shape"] == (int(shape.group(1)), int(shape.group(2)))


def test_removing_a_frame_leaves_its_content_where_it_was():
    nodes = {"f": node("frame", 100, 100), "n": node("sticky", 10, 20, "f")}
    planned, _, applied = plan(nodes, {}, Batch(removes=["f"], mine=["f"]))
    assert applied.removed == ["f"]
    assert planned["n"]["place"] == {"x": 110, "y": 120}


def test_a_reminder_on_an_element_keeps_it_from_going():
    nodes = {"n": node("sticky", 0, 0), "t": node("timer", 0, 0, "n")}
    with pytest.raises(KeepsPeopleWork):
        plan(nodes, {}, Batch(removes=["n"], mine=["n"]))


def test_an_api_arrow_goes_with_its_element():
    nodes = {"a": node("sticky", 0, 0), "b": node("sticky", 300, 0)}
    edges = {"e": {"source": "a", "target": "b"}}
    planned, kept, _ = plan(nodes, edges, Batch(removes=["a"], mine=["a", "e"]))
    assert "a" not in planned and kept == {}


def test_a_frame_grows_to_hold_what_is_placed_in_it():
    nodes = {"f": node("frame", 0, 0)}
    adds = [NewElement(id=f"n{i}", kind="note", frame="f") for i in range(6)]
    planned, _, _ = plan(nodes, {}, Batch(adds=adds))
    frame = planned["f"]["size"]
    for i in range(6):
        place = planned[f"n{i}"]["place"]
        assert place["parentId"] == "f"
        assert place["x"] + 200 <= frame["width"] and place["y"] + 200 <= frame["height"]


def test_a_card_takes_no_size_and_text_takes_a_width_only():
    with pytest.raises(ValueError):
        NewElement(kind="card", ref="DEMO-1", w=100)
    with pytest.raises(ValueError):
        NewElement(kind="text", h=50)
    nodes = {"n": node("sticky", 0, 0)}
    with pytest.raises(ValidationFailed):
        plan(nodes, {}, Batch(changes=[Change(id="n", shape="ellipse")], mine=["n"]))


def test_names_the_browser_holds_are_not_ids():
    with pytest.raises(ValueError):
        NewElement(id="constructor", kind="note")


def test_every_style_is_a_field_of_the_stored_element():
    models = {
        "sticky": boards.StickyData,
        "shape": boards.ShapeData,
        "text": boards.TextData,
        "frame": boards.FrameData,
    }
    for kind, styles in _STYLES.items():
        assert styles <= set(models[kind].model_fields), kind


@pytest.mark.parametrize(("given", "stored"), [(270, -90), (180, -180), (-190.6, 169), (725, 5)])
def test_rotation_is_folded_as_the_rotate_handle_stores_it(given, stored):
    assert Change(id="n", rotation=given).rotation == stored


def test_a_running_vote_keeps_the_look_too():
    nodes = {"n": node("sticky", 0, 0)}
    with pytest.raises(VoteRunning):
        plan(nodes, {}, Batch(changes=[Change(id="n", bold=True)]), frozenset({"n"}))
