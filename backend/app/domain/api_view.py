"""A board in the public shape of API v1 (spec 046): stable kind names, places on the board
rather than inside a frame, and the free ends of arrows hidden."""

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_serializer

from app.domain.boards import (
    AnchorNode,
    BoardDoc,
    Edge,
    FrameNode,
    ImageNode,
    ModuleNode,
    Node,
    ShapeNode,
    StickyNode,
    TaskCardNode,
    TextNode,
    TimerNode,
)
from app.domain.errors import NotFound
from app.domain.tasks import Task, task_ref

PAGE = 500

Kind = Literal["card", "note", "text", "shape", "frame", "arrow", "image", "module", "timer"]

_PLACED = ("id", "kind", "x", "y", "w", "h", "frame", "editable")
# What each kind answers with; a field of its kind stays even when it is null.
FIELDS: dict[str, tuple[str, ...]] = {
    "card": (*_PLACED, "source", "key", "task"),
    "note": (*_PLACED, "text", "color", "bold", "opacity", "rotation"),
    "text": (*_PLACED, "text", "bold", "size", "opacity", "rotation"),
    "shape": (
        *_PLACED,
        "shape",
        "text",
        "color",
        "bold",
        "size",
        "opacity",
        "rotation",
        "stroke",
        "dash",
    ),
    "frame": ("id", "kind", "x", "y", "w", "h", "editable", "title", "color", "opacity"),
    "arrow": ("id", "kind", "editable", "from", "to"),
    "image": (*_PLACED,),
    "module": (*_PLACED, "module", "title"),
    "timer": (
        "id",
        "kind",
        "x",
        "y",
        "w",
        "h",
        "editable",
        "note",
        "due_at",
        "repeat",
        "watch",
        "done",
        "attached_to",
    ),
}


class TaskOut(BaseModel):
    title: str
    status: str
    assignee: str | None
    due: date | None
    url: str
    fetched_at: str


class Element(BaseModel):
    """One element; fields that do not belong to its kind are left out of the answer."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    kind: Kind
    x: float | None = None
    y: float | None = None
    w: float | None = None
    h: float | None = None
    frame: str | None = None
    # True for an element the key's person added through the API: only those take changes of
    # text and removal. The look of any element can change.
    editable: bool = False
    text: str | None = None
    title: str | None = None
    color: str | None = None
    bold: bool | None = None
    size: str | None = None
    opacity: int | None = None
    rotation: int | None = None
    stroke: float | None = None
    dash: bool | None = None
    shape: str | None = None
    module: str | None = None
    source: str | None = None
    key: str | None = None
    task: TaskOut | None = None
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None
    note: str | None = None
    due_at: str | None = None
    repeat: str | None = None
    # A status reminder: the task it watches, the status it waits to leave, and where it went.
    watch: dict[str, str | None] | None = None
    done: bool | None = None
    attached_to: str | None = None

    @model_serializer(mode="wrap")
    def _kind_fields(self, handler):
        data = handler(self)
        return {name: data.get(name, data.get(f"{name}_")) for name in FIELDS[self.kind]}


_LOOK = ("color", "bold", "size", "opacity", "rotation", "stroke", "dash")


def _look(data: BaseModel) -> dict[str, Any]:
    return {name: getattr(data, name) for name in _LOOK if hasattr(data, name)}


class Counts(BaseModel):
    counts: dict[str, int]


class FrameOutline(BaseModel):
    id: str
    title: str
    x: float
    y: float
    w: float | None
    h: float | None
    counts: dict[str, int]


class ModuleOutline(BaseModel):
    id: str
    module: str
    title: str | None
    # How many rows a gantt holds; absent for another kind.
    rows: int | None = None

    @model_serializer(mode="wrap")
    def _rows_of_gantts(self, handler):
        data = handler(self)
        if self.rows is None:
            data.pop("rows", None)
        return data


class Outline(BaseModel):
    frames: list[FrameOutline]
    outside: Counts
    modules: list[ModuleOutline]


class Page(BaseModel):
    elements: list[Element]
    more: bool


def public_task(task: Task | None) -> TaskOut | None:
    if task is None or task.state != "ok":
        return None
    return TaskOut(
        title=task.summary,
        status=task.status_name,
        assignee=task.assignee_name,
        due=task.due,
        url=task.url,
        fetched_at=task.fetched_at,
    )


class BoardShape:
    """One board read once: elements by id with their places on the board."""

    def __init__(
        self,
        doc: BoardDoc,
        tasks: dict[str, Task],
        default_source: str,
        editable: set[str] = frozenset(),
    ) -> None:
        self._editable = editable
        self._nodes = {node.id: node for node in doc.nodes}
        self._edges = doc.edges
        self._tasks = tasks
        self._default_source = default_source

    def _place(self, node: Node) -> tuple[float, float]:
        x, y = node.position.x, node.position.y
        parent = self._nodes.get(node.parentId) if node.parentId else None
        # Frames do not nest and a timer hangs on a top-level element or one in a frame.
        for _ in range(3):
            if parent is None:
                break
            x, y = x + parent.position.x, y + parent.position.y
            parent = self._nodes.get(parent.parentId) if parent.parentId else None
        return x, y

    def _element(self, node: Node) -> Element | None:
        x, y = self._place(node)
        parent = self._nodes.get(node.parentId) if node.parentId else None
        frame = parent.id if isinstance(parent, FrameNode) else None
        base = {
            "id": node.id,
            "x": x,
            "y": y,
            "w": node.width,
            "h": node.height,
            "editable": node.id in self._editable,
        }
        if isinstance(node, TaskCardNode):
            source = node.data.source or self._default_source
            task = self._tasks.get(task_ref(source, node.data.key))
            return Element(
                **base,
                kind="card",
                frame=frame,
                source=source,
                key=node.data.key,
                task=public_task(task),
            )
        if isinstance(node, StickyNode):
            return Element(
                **base, **_look(node.data), kind="note", frame=frame, text=node.data.text
            )
        if isinstance(node, TextNode):
            return Element(
                **base, **_look(node.data), kind="text", frame=frame, text=node.data.text
            )
        if isinstance(node, ShapeNode):
            data = node.data
            return Element(
                **base, **_look(data), kind="shape", frame=frame, shape=data.shape, text=data.text
            )
        if isinstance(node, FrameNode):
            return Element(**base, **_look(node.data), kind="frame", title=node.data.title)
        if isinstance(node, ModuleNode):
            return Element(
                **base, kind="module", frame=frame, module=node.data.kind, title=node.data.title
            )
        if isinstance(node, ImageNode):
            return Element(**base, kind="image", frame=frame)
        if isinstance(node, TimerNode):
            due = node.data.dueAt.isoformat() if node.data.dueAt else None
            attached = node.parentId if parent is not None else None
            watch = node.data.watch
            watched = None
            if watch is not None:
                watched = {
                    "key": watch.key,
                    "source": watch.source or self._default_source,
                    "status": watch.status,
                    "changed_to": watch.changedTo,
                }
            return Element(
                **base,
                kind="timer",
                note=node.data.note,
                due_at=due,
                repeat=node.data.repeat,
                watch=watched,
                done=node.data.done,
                attached_to=attached,
            )
        # A kind v1 does not name yet is left out rather than failing the whole read.
        return None

    def _end(self, node_id: str) -> str | None:
        return None if isinstance(self._nodes.get(node_id), AnchorNode) else node_id

    def _arrow(self, edge: Edge) -> Element:
        return Element(
            id=edge.id,
            kind="arrow",
            from_=self._end(edge.source),
            to=self._end(edge.target),
            editable=edge.id in self._editable,
        )

    def _shown(self, nodes: list[Node]) -> list[Element]:
        made = (self._element(node) for node in nodes if not isinstance(node, AnchorNode))
        return [element for element in made if element is not None]

    def elements(self) -> list[Element]:
        return self._shown(list(self._nodes.values())) + [self._arrow(e) for e in self._edges]

    def in_frame(self, frame_id: str) -> list[Element]:
        """The frame's elements, and arrows with at least one end among them."""
        if not isinstance(self._nodes.get(frame_id), FrameNode):
            raise NotFound("frame not found")
        members = [n for n in self._nodes.values() if n.parentId == frame_id]
        inside = {n.id for n in members}
        nodes = self._shown(members)
        arrows = [
            self._arrow(edge)
            for edge in self._edges
            if edge.source in inside or edge.target in inside
        ]
        return nodes + arrows

    def outline(self) -> Outline:
        frames: list[FrameOutline] = []
        outside: dict[str, int] = {}
        counts: dict[str, dict[str, int]] = {}
        for element in self.elements():
            if element.kind == "frame":
                continue
            bucket = counts.setdefault(element.frame, {}) if element.frame else outside
            bucket[element.kind] = bucket.get(element.kind, 0) + 1
        modules: list[ModuleOutline] = []
        for node in self._nodes.values():
            # Modules never sit in a frame (`check_doc`).
            if isinstance(node, ModuleNode):
                gantt = node.data.kind == "gantt"
                modules.append(
                    ModuleOutline(
                        id=node.id,
                        module=node.data.kind,
                        title=node.data.title,
                        rows=len(node.data.content.get("rows") or []) if gantt else None,
                    )
                )
            if isinstance(node, FrameNode):
                x, y = self._place(node)
                frames.append(
                    FrameOutline(
                        id=node.id,
                        title=node.data.title,
                        x=x,
                        y=y,
                        w=node.width,
                        h=node.height,
                        counts=counts.get(node.id, {}),
                    )
                )
        return Outline(frames=frames, outside=Counts(counts=outside), modules=modules)


def page(elements: list[Element], after: str | None) -> Page:
    """Elements by id, `PAGE` at a time after the id `after`: a boundary that stays valid
    while people edit the board."""
    ordered = sorted(elements, key=lambda element: element.id)
    if after is not None:
        ordered = [element for element in ordered if element.id > after]
    return Page(elements=ordered[:PAGE], more=len(ordered) > PAGE)
