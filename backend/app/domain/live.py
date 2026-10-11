"""The shared document of a live board: its shape, its JSON projection and the repair of merges.

A node is stored as {type, place: {x, y, parentId?}, size: {width?, height?}, order, data: {...}},
an edge as {source, target, sourceHandle?, targetHandle?}. Every leaf is one value, so the last
writer wins per key (specs/009-realtime/data-model.md).
"""

from typing import Any

from pycrdt import Doc, Map
from pydantic import TypeAdapter, ValidationError

from app.domain.boards import CARD, LEGACY_CARD, MAX_NODES, BoardDoc, Edge, Node, check_doc

# Origin of the server's own writes (repairs, REST saves); never in anyone's undo history.
SERVER = "server"
MAX_EDGES = MAX_NODES * 2
MAX_CONNECTIONS = 30
# Guests of a public link have places of their own and never take a person's.
MAX_GUESTS = 200
MAX_MESSAGE_BYTES = 1024 * 1024

# Close codes of the live socket (specs/009-realtime/contracts/live.md).
POLICY = 1008
TOO_BIG = 1009
GOING_AWAY = 1012
TOO_SLOW = 1013
SESSION_ENDED = 4401
ACCESS_CHANGED = 4403
ROOM_FULL = 4429

Stored = dict[str, dict[str, Any]]

_NODE = TypeAdapter(Node)
_EDGE = TypeAdapter(Edge)


def stored_node(node: dict[str, Any], order: float) -> dict[str, Any]:
    """A node of the JSON doc in the shape the shared document keeps."""
    place = {"x": node["position"]["x"], "y": node["position"]["y"]}
    if node.get("parentId") is not None:
        place["parentId"] = node["parentId"]
    size = {key: node[key] for key in ("width", "height") if node.get(key) is not None}
    return {
        "type": node["type"],
        "place": place,
        "size": size,
        "order": order,
        "data": dict(node.get("data") or {}),
    }


def json_node(node_id: str, node: dict[str, Any]) -> dict[str, Any]:
    place = node["place"]
    out: dict[str, Any] = {
        "id": node_id,
        "type": node["type"],
        "position": {"x": place.get("x"), "y": place.get("y")},
        "data": node["data"],
    }
    if place.get("parentId") is not None:
        out["parentId"] = place["parentId"]
    out.update({key: node["size"][key] for key in ("width", "height") if key in node["size"]})
    return out


def from_board(board: BoardDoc) -> tuple[Stored, Stored]:
    doc = board.model_dump(mode="json", exclude_none=True)
    nodes = {node["id"]: stored_node(node, index) for index, node in enumerate(doc["nodes"])}
    edges = {edge["id"]: {k: v for k, v in edge.items() if k != "id"} for edge in doc["edges"]}
    return nodes, edges


def _well_formed(node: Any) -> bool:
    return (
        isinstance(node, dict)
        and isinstance(node.get("type"), str)
        and isinstance(node.get("place"), dict)
        and isinstance(node.get("size"), dict)
        and isinstance(node.get("order"), int | float)
        and isinstance(node.get("data"), dict)
    )


def to_json(nodes: Stored, edges: Stored) -> dict[str, Any]:
    """Nodes by stacking order with every child right after its parent, as xyflow needs.

    A node whose parent is missing is left out; the repair brings it back as a top-level node.
    """
    children: dict[str | None, list[str]] = {}
    for node_id, node in nodes.items():
        children.setdefault(node["place"].get("parentId"), []).append(node_id)
    for ids in children.values():
        ids.sort(key=lambda node_id: (nodes[node_id]["order"], node_id))
    out: list[dict[str, Any]] = []
    # A stack, not recursion: a forged chain of parents must not hit the recursion limit.
    stack = list(reversed(children.get(None, [])))
    while stack:
        node_id = stack.pop()
        out.append(json_node(node_id, nodes[node_id]))
        stack.extend(reversed(children.get(node_id, [])))
    return {
        "nodes": out,
        "edges": [{"id": edge_id, **edges[edge_id]} for edge_id in sorted(edges)],
    }


def _valid(adapter: TypeAdapter, value: dict[str, Any]) -> bool:
    try:
        adapter.validate_python(value)
    except (ValidationError, ValueError):
        return False
    return True


def _origin(node_id: str | None, *sources: Stored) -> tuple[float, float]:
    """Absolute position of a node, read from the first source that still has it."""
    x = y = 0.0
    for _ in range(4):
        node = next((source[node_id] for source in sources if node_id in source), None)
        if node is None:
            break
        x, y = x + node["place"]["x"], y + node["place"]["y"]
        node_id = node["place"].get("parentId")
    return x, y


def repaired(
    nodes: dict[str, Any], edges: dict[str, Any], previous: Stored
) -> tuple[Stored, Stored, list[str]]:
    """The same board with every rule of `BoardDoc` and `check_doc` holding again.

    `previous` is the last valid state: where a broken node is restored from and where the
    place of an already deleted parent is read from.
    """
    notes: list[str] = []
    good: Stored = {}
    for node_id, node in nodes.items():
        if _well_formed(node) and node["type"] == LEGACY_CARD:
            node = {**node, "type": CARD}
        if _well_formed(node) and _valid(_NODE, json_node(node_id, node)):
            good[node_id] = node
        elif node_id in previous:
            order = node.get("order") if isinstance(node, dict) else None
            keep = order if isinstance(order, int | float) else previous[node_id]["order"]
            good[node_id] = {**previous[node_id], "order": keep}
            notes.append("node_restored")
        else:
            notes.append("node_dropped")

    if len(good) > MAX_NODES:
        # What the update added goes first, the topmost of it before the rest.
        newest = sorted(good, key=lambda n: (n not in previous, good[n]["order"]), reverse=True)
        for node_id in newest[: len(good) - MAX_NODES]:
            del good[node_id]
            notes.append("over_node_limit")

    def detach(node_id: str) -> None:
        node = good[node_id]
        parent_x, parent_y = _origin(node["place"]["parentId"], good, previous)
        place = {"x": node["place"]["x"] + parent_x, "y": node["place"]["y"] + parent_y}
        good[node_id] = {**node, "place": place}
        notes.append("node_detached")

    def parent_type(node_id: str) -> str | None:
        parent = good.get(good[node_id]["place"].get("parentId"))
        return parent["type"] if parent else None

    # Frames and modules first: a card inside a frame that was itself nested stays in it.
    for node_id in [n for n, node in good.items() if node["type"] in ("frame", "module")]:
        if good[node_id]["place"].get("parentId") is not None:
            detach(node_id)
    for node_id in [n for n, node in good.items() if node["type"] not in ("frame", "module")]:
        node = good[node_id]
        if node["place"].get("parentId") is None:
            continue
        if node["type"] == "timer":
            if parent_type(node_id) in (None, "anchor", "timer"):
                del good[node_id]
                notes.append("timer_dropped")
        elif parent_type(node_id) != "frame":
            detach(node_id)

    kept: Stored = {}
    for edge_id, edge in edges.items():
        ok = isinstance(edge, dict) and _valid(_EDGE, {"id": edge_id, **edge})
        if ok and edge["source"] in good and edge["target"] in good and len(kept) < MAX_EDGES:
            kept[edge_id] = edge
        else:
            notes.append("edge_dropped")

    ends = {end for edge in kept.values() for end in (edge["source"], edge["target"])}
    for node_id in [n for n, node in good.items() if node["type"] == "anchor" and n not in ends]:
        del good[node_id]
        notes.append("anchor_dropped")
    return good, kept, notes


class LiveDoc:
    """One board as a CRDT document."""

    def __init__(self, state: bytes | None = None) -> None:
        self.doc = Doc()
        if state:
            self.doc.apply_update(state)
        self.doc["nodes"] = self._nodes = Map()
        self.doc["edges"] = self._edges = Map()

    def state(self) -> bytes:
        return self.doc.get_update()

    def read(self) -> tuple[dict[str, Any], dict[str, Any]]:
        """Nodes and edges as plain values; a node that is not a map of the right shape is None."""
        nodes: dict[str, Any] = {}
        for node_id, node in self._nodes.items():
            shaped = isinstance(node, Map) and isinstance(node.get("data"), Map)
            nodes[node_id] = node.to_py() if shaped else None
        return nodes, self._edges.to_py() or {}

    def write(self, nodes: Stored, edges: Stored, origin: Any = SERVER) -> bool:
        """Makes the document equal to the given state, touching only what differs."""
        current, current_edges = self.read()
        ops: list[Any] = []
        for node_id in current.keys() - nodes.keys():
            ops.append(lambda node_id=node_id: self._nodes.pop(node_id))
        for node_id, node in nodes.items():
            have = current.get(node_id)
            if have is None:
                ops.append(lambda node_id=node_id, node=node: self._put_node(node_id, node))
                continue
            for key in ("type", "place", "size", "order"):
                if have.get(key) != node[key]:
                    ops.append(lambda n=node_id, k=key, v=node[key]: self._nodes[n].update({k: v}))
            for key in have["data"].keys() - node["data"].keys():
                ops.append(lambda n=node_id, k=key: self._nodes[n]["data"].pop(k))
            for key, value in node["data"].items():
                if key not in have["data"] or have["data"][key] != value:
                    ops.append(
                        lambda n=node_id, k=key, v=value: self._nodes[n]["data"].update({k: v})
                    )
        for edge_id in current_edges.keys() - edges.keys():
            ops.append(lambda edge_id=edge_id: self._edges.pop(edge_id))
        for edge_id, edge in edges.items():
            if current_edges.get(edge_id) != edge:
                ops.append(lambda edge_id=edge_id, edge=edge: self._edges.update({edge_id: edge}))
        if not ops:
            return False
        with self.doc.transaction(origin=origin):
            for op in ops:
                op()
        return True

    def _put_node(self, node_id: str, node: dict[str, Any]) -> None:
        self._nodes[node_id] = Map({**node, "data": Map(node["data"])})

    def rename_type(self, old: str, new: str) -> bool:
        """Gives every node of the type `old` the type `new`, whatever else the node holds."""
        stale = [n for n in self._nodes.values() if isinstance(n, Map) and n.get("type") == old]
        if stale:
            with self.doc.transaction(origin=SERVER):
                for node in stale:
                    node.update({"type": new})
        return bool(stale)

    def apply_json(self, board: BoardDoc, origin: Any = SERVER) -> None:
        self.write(*from_board(board), origin=origin)

    def repair(self, last: BoardDoc) -> tuple[BoardDoc, list[str]]:
        """Fixes what a merge broke and returns the board as it now stands, valid."""
        nodes, edges, notes = repaired(*self.read(), from_board(last)[0])
        self.write(nodes, edges)
        board = BoardDoc.model_validate(
            {**to_json(nodes, edges), "viewport": last.viewport.model_dump()}
        )
        check_doc(board)
        return board, notes
