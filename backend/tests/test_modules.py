import pytest
from pydantic import ValidationError

from app.domain.boards import BoardDoc, check_doc, task_refs
from app.domain.errors import ValidationFailed
from app.domain.modules import validate_module

GANTT = {"start": "2026-10-01", "end": "2026-12-31", "scale": "week"}


def module(node_id, kind="gantt", content=None, parent=None):
    node = {
        "id": node_id,
        "type": "module",
        "position": {"x": 0, "y": 0},
        "data": {"kind": kind, "content": GANTT if content is None else content},
    }
    if parent:
        node["parentId"] = parent
    return node


def doc(nodes):
    return BoardDoc.model_validate({"nodes": nodes})


def test_known_kind_is_normalized():
    content = validate_module("gantt", GANTT | {"extra": 1})
    assert content == GANTT | {"labelWidth": 160, "rows": [], "milestones": [], "links": []}


def test_unknown_kind_passes_through():
    content = {"anything": [1, 2, {"deep": True}]}
    assert validate_module("future_thing", content) == content


def test_content_size_is_limited():
    with pytest.raises(ValueError, match="over 256 KB"):
        validate_module("future_thing", {"blob": "x" * 300_000})


def test_invalid_kind_name_rejected():
    with pytest.raises(ValidationError):
        doc([module("m", kind="Gantt")])


def test_invalid_content_names_the_kind():
    with pytest.raises(ValidationError, match="gantt: end before start"):
        doc([module("m", content=GANTT | {"end": "2026-09-01"})])


def test_module_round_trips_through_doc():
    board = doc([module("m"), module("u", kind="future_thing", content={"a": 1})])
    check_doc(board)
    nodes = board.model_dump(exclude_none=True)["nodes"]
    assert nodes[0]["data"]["content"]["start"] == "2026-10-01"
    assert nodes[1]["data"] == {"kind": "future_thing", "content": {"a": 1}}


def test_module_cannot_be_nested_or_a_parent():
    frame = {"id": "f", "type": "frame", "position": {"x": 0, "y": 0}, "data": {}}
    with pytest.raises(ValidationFailed, match="modules cannot be nested"):
        check_doc(doc([frame, module("m", parent="f")]))
    card = {
        "id": "c",
        "type": "task_card",
        "position": {"x": 0, "y": 0},
        "data": {"key": "DEV-1"},
        "parentId": "m",
    }
    with pytest.raises(ValidationFailed, match="must follow its parent frame"):
        check_doc(doc([module("m"), card]))


def test_task_refs_include_module_rows():
    rows = [
        {"id": "r1", "key": "DEV-3", "start": "2026-10-01", "end": "2026-10-02"},
        {"id": "r2", "title": "Plain", "start": "2026-10-01", "end": "2026-10-02"},
    ]
    card = {"id": "c", "type": "task_card", "position": {"x": 0, "y": 0}, "data": {"key": "DEV-1"}}
    board = doc([card, module("m", content=GANTT | {"rows": rows}), module("u", "x", {"rows": 1})])
    assert task_refs(board, "jira") == ["jira:DEV-1", "jira:DEV-3"]
