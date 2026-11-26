"""Copies of a board saved before a key with full access changes people's work (spec 055)."""

from typing import Any, Literal

from pydantic import BaseModel, TypeAdapter, ValidationError

from app.domain.boards import BoardDoc, Edge, Node
from app.domain.live import from_board, json_node, stored_node

KEEP = 20
KEEP_DAYS = 14
Reason = Literal["key", "restore"]
Stored = dict[str, dict[str, Any]]


class CopyInfo(BaseModel):
    id: str
    saved_at: str
    by_user_id: str | None
    by_name: str | None
    reason: Reason
    elements: int


class Copy(BaseModel):
    info: CopyInfo
    doc: BoardDoc


class Written(BaseModel):
    """People's elements and arrows as keys last wrote them since the newest copy: unchanged
    since, they need no copy of their own."""

    nodes: dict[str, Any] = {}
    edges: dict[str, Any] = {}


class Latest(BaseModel):
    id: str
    doc: BoardDoc
    written: Written = Written()


_NODE = TypeAdapter(Node)
_EDGE = TypeAdapter(Edge)


def _plain(node: dict[str, Any] | None) -> dict[str, Any] | None:
    # Stacking order is renumbered on every save; it is no part of what a person made.
    return None if node is None else {k: v for k, v in node.items() if k != "order"}


def _shape(node_id: str, node: dict[str, Any] | None) -> dict[str, Any] | None:
    """A node as a copy keeps it: a tab writes a module's content as it is, a copy parsed, so
    the two compare only once both are parsed the same way."""
    if node is None:
        return None
    try:
        parsed = _NODE.validate_python(json_node(node_id, node))
    except (ValidationError, ValueError):
        return _plain(node)
    return _plain(stored_node(parsed.model_dump(mode="json", exclude_none=True), 0))


def _edge(edge_id: str, edge: dict[str, Any] | None) -> dict[str, Any] | None:
    if edge is None:
        return None
    try:
        parsed = _EDGE.validate_python({"id": edge_id, **edge})
    except (ValidationError, ValueError):
        return edge
    return parsed.model_dump(mode="json", exclude_none=True, exclude={"id"})


def holds(latest: Latest | None, nodes: Stored, edges: Stored, ids: list[str]) -> bool:
    """Whether each of these elements and arrows stands now as the newest copy has it, or as a
    key wrote it after that copy: then no work of people's is missing from every copy."""
    if latest is None:
        return False
    kept, kept_edges = from_board(latest.doc)
    kept_nodes = {i: _shape(i, node) for i, node in kept.items()}
    written = latest.written
    for element_id in ids:
        if element_id in edges:
            now = _edge(element_id, edges[element_id])
            if now not in (
                _edge(element_id, kept_edges.get(element_id)),
                written.edges.get(element_id),
            ):
                return False
            continue
        now = _shape(element_id, nodes.get(element_id))
        if now not in (kept_nodes.get(element_id), written.nodes.get(element_id)):
            return False
    return True


def written(nodes: Stored, edges: Stored, ids: list[str]) -> Written:
    """What a call left of the people's work it overwrote; removed ones are absent."""
    return Written(
        nodes={i: _shape(i, nodes[i]) for i in ids if nodes.get(i) is not None},
        edges={i: _edge(i, edges[i]) for i in ids if i in edges},
    )


def same(latest: Latest | None, nodes: Stored, edges: Stored) -> bool:
    """Whether the newest copy is the board as it stands now."""
    if latest is None:
        return False
    kept_nodes, kept_edges = from_board(latest.doc)
    now = {k: _shape(k, v) for k, v in nodes.items() if v is not None}
    return {k: _shape(k, v) for k, v in kept_nodes.items()} == now and kept_edges == edges
