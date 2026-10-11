import pytest
from pydantic import ValidationError

from app.domain.boards import BoardDoc, check_doc, task_refs
from app.domain.errors import ValidationFailed


def card(node_id, key, parent=None):
    node = {"id": node_id, "type": "task_card", "position": {"x": 0, "y": 0}, "data": {"key": key}}
    if parent:
        node["parentId"] = parent
    return node


def frame(node_id, parent=None):
    node = {"id": node_id, "type": "frame", "position": {"x": 0, "y": 0}, "data": {"title": "F"}}
    if parent:
        node["parentId"] = parent
    return node


def doc(nodes, edges=()):
    return BoardDoc.model_validate({"nodes": nodes, "edges": list(edges)})


def test_transient_xyflow_fields_are_dropped():
    node = card("a", "DEV-1") | {"selected": True, "measured": {"width": 1}}
    dumped = doc([node]).model_dump(exclude_none=True)["nodes"][0]
    assert "selected" not in dumped and "measured" not in dumped


def test_valid_doc_passes_and_lists_unique_keys():
    board = doc(
        [frame("f"), card("a", "DEV-2", parent="f"), card("b", "DEV-1"), card("c", "DEV-2")],
        [{"id": "e", "source": "a", "target": "b"}],
    )
    check_doc(board)
    assert task_refs(board, "jira") == ["jira:DEV-1", "jira:DEV-2"]


def test_arrow_can_end_at_an_anchor():
    anchor = {"id": "p", "type": "anchor", "position": {"x": 5, "y": 5}, "data": {}}
    board = doc([card("a", "DEV-1"), anchor], [{"id": "e", "source": "a", "target": "p"}])
    check_doc(board)
    assert task_refs(board, "jira") == ["jira:DEV-1"]


def timer(node_id, parent=None, **data):
    node = {"id": node_id, "type": "timer", "position": {"x": 0, "y": 0}, "data": data}
    if parent:
        node["parentId"] = parent
    return node


def test_timer_attaches_to_an_element_even_inside_a_frame():
    board = doc(
        [
            frame("f"),
            card("a", "DEV-1", parent="f"),
            timer("t", parent="a", note="ping QA", dueAt="2026-10-25T12:00:00Z", repeat="daily"),
            timer(
                "u", parent="f", watch={"key": "DEV-1", "status": "In Review", "changedTo": "Done"}
            ),
            timer("v"),
        ]
    )
    check_doc(board)
    assert task_refs(board, "jira") == ["jira:DEV-1"]


@pytest.mark.parametrize(
    "nodes",
    [
        [timer("t", parent="a"), card("a", "DEV-1")],
        [timer("t"), timer("u", parent="t")],
        [{"id": "p", "type": "anchor", "position": {"x": 0, "y": 0}, "data": {}}, timer("t", "p")],
        [timer("t"), card("a", "DEV-1", parent="t")],
    ],
    ids=["before parent", "on a timer", "on an anchor", "card in a timer"],
)
def test_timer_nesting_rules(nodes):
    with pytest.raises(ValidationFailed):
        check_doc(doc(nodes))


def test_timer_schema_limits():
    with pytest.raises(ValidationError):
        doc([timer("t", note="x" * 501)])
    with pytest.raises(ValidationError):
        doc([timer("t", dueAt="2026-10-25T12:00:00")])
    with pytest.raises(ValidationError):
        doc([timer("t", repeat="hourly")])


@pytest.mark.parametrize(
    ("nodes", "edges"),
    [
        ([card("a", "DEV-1"), card("a", "DEV-2")], []),
        ([card("a", "DEV-1", parent="f"), frame("f")], []),
        ([card("b", "DEV-1"), card("a", "DEV-1", parent="b")], []),
        ([frame("f"), frame("g", parent="f")], []),
        ([card("a", "DEV-1")], [{"id": "e", "source": "a", "target": "zz"}]),
    ],
    ids=["duplicate id", "child before parent", "parent not frame", "nested frame", "dangling"],
)
def test_invalid_docs_are_rejected(nodes, edges):
    with pytest.raises(ValidationFailed):
        check_doc(doc(nodes, edges))


def test_schema_limits():
    with pytest.raises(ValidationError):
        doc([card("a", "not-a-key")])
    with pytest.raises(ValidationError):
        doc(
            [
                {
                    "id": "s",
                    "type": "sticky",
                    "position": {"x": 0, "y": 0},
                    "data": {"text": "x" * 5001},
                }
            ]
        )


def test_a_task_belongs_to_its_source_or_to_the_instance_tracker():
    named = card("a", "DEV-1")
    named["data"]["source"] = "demo"
    board = doc([named, card("b", "DEV-1"), card("c", "DEV-2")])
    assert task_refs(board, "jira") == ["demo:DEV-1", "jira:DEV-1", "jira:DEV-2"]


def test_a_document_without_sources_is_stored_as_it_came():
    board = doc([card("a", "DEV-1")])
    assert "source" not in board.model_dump(exclude_none=True)["nodes"][0]["data"]


def test_a_malformed_source_is_refused():
    bad = card("a", "DEV-1")
    bad["data"]["source"] = "Jira:1"
    with pytest.raises(ValidationError):
        doc([bad])


def test_the_old_name_of_a_card_is_read_as_the_new_one():
    old = card("a", "DEV-1") | {"type": "jira_card"}
    assert doc([old]).nodes[0].type == "task_card"
