import json
import random
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.domain.boards import MAX_NODES, BoardDoc, check_doc
from app.domain.live import LiveDoc, from_board, repaired, stored_node, to_json
from app.domain.tasks import now_iso  # noqa: F401 - keeps the import graph as the app has it
from app.domain.welcome import welcome_doc

FIXTURES = json.loads(
    (Path(__file__).parents[2] / "frontend/src/live/projection.fixtures.json").read_text()
)


def board(nodes: list[dict], edges: list[dict] | None = None) -> BoardDoc:
    return BoardDoc.model_validate({"nodes": nodes, "edges": edges or []})


def sticky(node_id: str, **extra) -> dict:
    return {
        "id": node_id,
        "type": "sticky",
        "position": {"x": 10, "y": 20},
        "data": {"text": node_id, "color": "yellow"},
        **extra,
    }


def frame(node_id: str, x: float = 100, y: float = 200) -> dict:
    return {"id": node_id, "type": "frame", "position": {"x": x, "y": y}, "data": {"title": ""}}


EVERY_TYPE = board(
    [
        frame("frame"),
        {
            "id": "card",
            "type": "task_card",
            "parentId": "frame",
            "position": {"x": 1, "y": 2},
            "data": {"key": "DEV-1", "collapsed": True},
        },
        {
            "id": "timer",
            "type": "timer",
            "parentId": "card",
            "position": {"x": 3, "y": 4},
            "data": {"note": "ping", "dueAt": "2030-01-01T10:00:00Z", "repeat": "daily"},
        },
        sticky("sticky", width=200, height=120),
        {"id": "text", "type": "text", "position": {"x": 0, "y": 0}, "data": {"text": "hello"}},
        {
            "id": "gantt",
            "type": "module",
            "position": {"x": 5, "y": 5},
            "data": {"kind": "future_kind", "content": {"rows": [1, 2, {"a": None}]}},
        },
        {"id": "free", "type": "anchor", "position": {"x": 9, "y": 9}, "data": {}},
    ],
    [{"id": "e1", "source": "sticky", "target": "free", "sourceHandle": "right"}],
)


def as_json(doc: BoardDoc) -> dict:
    """The board as REST returns it; edges by id, the one order the shared document keeps."""
    out = doc.model_dump(mode="json", exclude_none=True)
    out["edges"].sort(key=lambda edge: edge["id"])
    return out


@pytest.mark.parametrize("case", FIXTURES, ids=lambda case: case["name"])
def test_projection_fixtures(case):
    assert to_json(case["nodes"], case["edges"]) == case["json"]


@pytest.mark.parametrize(
    "doc",
    [EVERY_TYPE, BoardDoc.model_validate(welcome_doc(datetime.now(UTC)))],
    ids=["every type", "welcome board"],
)
def test_a_board_survives_the_shared_document_and_a_restart(doc):
    live = LiveDoc()
    live.apply_json(doc)
    again = LiveDoc(live.state())
    restored, notes = again.repair(doc)
    assert notes == []
    assert as_json(restored) == as_json(doc)


def test_apply_json_touches_only_what_differs():
    live = LiveDoc()
    live.apply_json(EVERY_TYPE)
    updates: list[bytes] = []
    live.doc.observe(lambda event: updates.append(event.update))
    live.apply_json(EVERY_TYPE)
    assert updates == []

    moved = as_json(EVERY_TYPE)
    moved["nodes"][3]["position"]["x"] = 500
    live.apply_json(BoardDoc.model_validate(moved))
    assert len(updates) == 1 and len(updates[0]) < 80
    assert live.read()[0]["sticky"]["place"]["x"] == 500


def test_apply_json_removes_what_is_gone():
    live = LiveDoc()
    live.apply_json(EVERY_TYPE)
    live.apply_json(board([sticky("sticky")]))
    nodes, edges = live.read()
    assert list(nodes) == ["sticky"] and edges == {}


def fix(nodes: dict, edges: dict | None = None, previous: BoardDoc | None = None):
    good, kept, notes = repaired(nodes, edges or {}, from_board(previous or board([]))[0])
    doc = BoardDoc.model_validate(to_json(good, kept))
    check_doc(doc)
    return good, kept, notes


def test_a_card_dropped_into_a_deleted_frame_stays_where_it_was_dropped():
    before = board([frame("frame", 100, 200), sticky("other")])
    nodes = {
        "other": stored_node(sticky("other"), 1),
        "card": stored_node({**sticky("card"), "parentId": "frame"}, 2),
    }
    good, _, notes = fix(nodes, previous=before)
    assert good["card"]["place"] == {"x": 110, "y": 220}
    assert notes == ["node_detached"]


def test_frames_and_modules_cannot_be_nested():
    nodes = {
        "outer": stored_node(frame("outer", 100, 100), 0),
        "inner": stored_node({**frame("inner", 5, 5), "parentId": "outer"}, 1),
        "card": stored_node({**sticky("card"), "parentId": "inner"}, 2),
    }
    good, _, _ = fix(nodes)
    assert good["inner"]["place"] == {"x": 105, "y": 105}
    assert good["card"]["place"]["parentId"] == "inner"


def test_a_child_of_a_non_frame_is_detached_and_a_parent_loop_is_broken():
    nodes = {
        "a": stored_node({**sticky("a"), "parentId": "b"}, 0),
        "b": stored_node({**sticky("b"), "parentId": "a"}, 1),
    }
    good, _, _ = fix(nodes)
    assert all("parentId" not in node["place"] for node in good.values())


def test_a_timer_goes_with_its_holder():
    timer = {"id": "t", "type": "timer", "position": {"x": 0, "y": 0}, "data": {}}
    nodes = {
        "kept": stored_node({**timer, "id": "kept", "parentId": "card"}, 0),
        "card": stored_node(sticky("card"), 1),
        "lost": stored_node({**timer, "id": "lost", "parentId": "gone"}, 2),
        "free": stored_node({**timer, "id": "free"}, 3),
    }
    good, _, notes = fix(nodes)
    assert set(good) == {"kept", "card", "free"} and notes == ["timer_dropped"]


def test_an_arrow_to_a_missing_node_disappears_with_its_anchor():
    nodes = {
        "a": stored_node(sticky("a"), 0),
        "free": stored_node({"id": "free", "type": "anchor", "position": {"x": 1, "y": 1}}, 1),
    }
    edges = {"e1": {"source": "gone", "target": "free"}, "e2": {"source": "a", "target": "a"}}
    good, kept, notes = fix(nodes, edges)
    assert set(good) == {"a"} and set(kept) == {"e2"}
    assert notes == ["edge_dropped", "anchor_dropped"]


@pytest.mark.parametrize(
    "broken",
    [
        None,
        "text",
        {"type": "sticky"},
        {**stored_node(sticky("x"), 0), "data": {"text": "x" * 5001}},
        {**stored_node(sticky("x"), 0), "type": "hologram"},
        {**stored_node(sticky("x"), 0), "place": {"x": "left", "y": 0}},
        {**stored_node(sticky("x"), 0), "order": "top"},
        stored_node(
            {
                "id": "x",
                "type": "task_card",
                "position": {"x": 0, "y": 0},
                "data": {"key": "not a key"},
            },
            0,
        ),
    ],
)
def test_a_broken_node_is_restored_or_removed(broken):
    known = board([sticky("x")])
    good, _, notes = fix({"x": broken}, previous=known)
    assert good["x"]["data"] == {"text": "x", "color": "yellow"} and notes == ["node_restored"]
    good, _, notes = fix({"x": broken})
    assert good == {} and notes == ["node_dropped"]


def test_nodes_over_the_limit_are_the_ones_just_added():
    before = board([sticky(f"old{i}") for i in range(MAX_NODES - 1)])
    nodes = from_board(before)[0]
    nodes["new1"] = stored_node(sticky("new1"), -5)
    nodes["new2"] = stored_node(sticky("new2"), 9999)
    good, _, notes = fix(nodes, previous=before)
    assert len(good) == MAX_NODES and "new2" not in good and "new1" in good
    assert notes == ["over_node_limit"]


def test_concurrent_edits_always_merge_into_a_valid_board():
    """Two people edit offline in every way the canvas allows, then merge."""
    rng = random.Random(9)
    for _ in range(40):
        start = EVERY_TYPE
        server = LiveDoc()
        server.apply_json(start)
        tabs = [LiveDoc(server.state()), LiveDoc(server.state())]
        for tab in tabs:
            nodes, edges = tab.read()
            for _ in range(6):
                ids = list(nodes)
                move = rng.choice(["delete", "reparent", "add", "edge", "text"])
                if move == "delete" and ids:
                    nodes.pop(rng.choice(ids))
                elif move == "reparent" and ids:
                    nodes[rng.choice(ids)]["place"]["parentId"] = rng.choice(ids + ["nowhere"])
                elif move == "add":
                    new = f"n{rng.random()}"
                    nodes[new] = stored_node(sticky(new), rng.random() * 10)
                    if ids and rng.random() < 0.5:
                        nodes[new]["place"]["parentId"] = rng.choice(ids)
                elif move == "edge" and ids:
                    edges[f"e{rng.random()}"] = {"source": rng.choice(ids), "target": "free"}
                elif move == "text" and "sticky" in nodes:
                    nodes["sticky"]["data"]["text"] = "x" * rng.choice([3, 6000])
            tab.write(nodes, edges, origin="tab")
        for tab in tabs:
            server.doc.apply_update(tab.state())
        merged, _ = server.repair(start)
        check_doc(merged)
        again, notes = server.repair(merged)
        assert notes == [] and as_json(again) == as_json(merged)


def test_a_card_under_its_old_type_name_is_kept_and_renamed():
    old = {
        "id": "card",
        "type": "jira_card",
        "position": {"x": 1, "y": 2},
        "data": {"key": "DEMO-1"},
    }
    live = LiveDoc()
    live.write({"card": stored_node(old, 0)}, {})
    repaired_board, notes = live.repair(board([]))
    assert (repaired_board.nodes[0].type, notes) == ("task_card", [])
    assert live.read()[0]["card"]["type"] == "task_card"
