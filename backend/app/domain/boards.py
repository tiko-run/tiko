from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.domain.accounts import Person
from app.domain.errors import BoardLimit, NotFound, ValidationFailed
from app.domain.members import BoardRole, ShareRole, effective_role, granted_role
from app.domain.modules import KIND_PATTERN, module_keys, validate_module
from app.domain.ports import BoardRepo, LiveBoards, SnapshotRepo
from app.domain.tasks import SOURCE_PATTERN, Task, task_ref, valid_key
from app.domain.welcome import WELCOME_NAME, welcome_doc

MAX_NODES = 2000
CARD = "task_card"
# What a card was called before trackers could be mixed. A tab left open over the upgrade and
# a script written for the old API still send it.
LEGACY_CARD = "jira_card"

BoardName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class _Strict(BaseModel):
    # xyflow adds transient fields (selected, dragging, measured); they are not part of the doc.
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)


class Position(_Strict):
    x: float
    y: float


class TaskCardData(_Strict):
    key: str
    # The tracker of `key`; absent on cards saved before trackers could be mixed.
    source: str | None = Field(default=None, pattern=SOURCE_PATTERN)
    collapsed: bool = False

    @model_validator(mode="after")
    def _key(self) -> "TaskCardData":
        if not valid_key(self.source, self.key):
            raise ValueError("invalid issue key")
        return self


def _not_null(value: Any) -> Any:
    # A default is not validated, so only an explicit null lands here.
    if value is None:
        raise ValueError("leave the field out instead of sending null")
    return value


def absent_or(kind: Any) -> Any:
    """A field a doc may leave out, never null: a board saved before the field stays as it was."""
    return Annotated[kind | None, BeforeValidator(_not_null, json_schema_input_type=kind)]


FrameFill = Literal["none", "yellow", "orange", "pink", "violet", "blue", "green"]
Opacity = Annotated[int, Field(ge=10, le=100, multiple_of=5)]
TextSize = Literal["small", "medium", "large"]


class FrameData(_Strict):
    title: str = Field(default="", max_length=200)
    color: absent_or(FrameFill) = None
    opacity: absent_or(Opacity) = None


class StickyData(_Strict):
    text: str = Field(default="", max_length=5000)
    color: str = Field(default="yellow", max_length=20)
    opacity: absent_or(Opacity) = None
    bold: absent_or(bool) = None


ShapeKind = Literal[
    "rectangle",
    "rounded",
    "ellipse",
    "rhombus",
    "triangle",
    "parallelogram",
    "hexagon",
    "cylinder",
]


class ShapeData(_Strict):
    shape: ShapeKind
    text: str = Field(default="", max_length=500)
    color: Literal["none", "surface", "yellow", "orange", "pink", "violet", "blue", "green"] = (
        "none"
    )
    opacity: absent_or(Opacity) = None
    stroke: absent_or(Literal[1, 1.5, 3]) = None
    dash: absent_or(bool) = None
    bold: absent_or(bool) = None
    size: absent_or(TextSize) = None


class TextData(_Strict):
    text: str = Field(default="", max_length=5000)
    opacity: absent_or(Opacity) = None
    bold: absent_or(bool) = None
    size: absent_or(TextSize) = None


class ModuleData(_Strict):
    kind: str = Field(pattern=KIND_PATTERN)
    title: str | None = Field(default=None, max_length=200)
    content: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _content(self) -> "ModuleData":
        self.content = validate_module(self.kind, self.content)
        return self


class _NodeBase(_Strict):
    id: str = Field(min_length=1, max_length=100)
    position: Position
    width: float | None = None
    height: float | None = None
    parentId: str | None = Field(default=None, max_length=100)  # noqa: N815 - mirrors xyflow


class TaskCardNode(_NodeBase):
    type: Literal["task_card"]
    data: TaskCardData


class FrameNode(_NodeBase):
    type: Literal["frame"]
    data: FrameData


class StickyNode(_NodeBase):
    type: Literal["sticky"]
    data: StickyData


class ShapeNode(_NodeBase):
    type: Literal["shape"]
    data: ShapeData


class TextNode(_NodeBase):
    type: Literal["text"]
    data: TextData


class ModuleNode(_NodeBase):
    type: Literal["module"]
    data: ModuleData


class AnchorData(_Strict):
    pass


class AnchorNode(_NodeBase):
    """The free end of an arrow that points somewhere instead of at an element."""

    type: Literal["anchor"]
    data: AnchorData = Field(default_factory=AnchorData)


class TimerWatch(_Strict):
    key: str
    source: str | None = Field(default=None, pattern=SOURCE_PATTERN)
    status: str = Field(max_length=200)
    changedTo: str | None = Field(default=None, max_length=200)  # noqa: N815

    @model_validator(mode="after")
    def _key(self) -> "TimerWatch":
        if not valid_key(self.source, self.key):
            raise ValueError("invalid issue key")
        return self


class TimerData(_Strict):
    note: str = Field(default="", max_length=500)
    dueAt: AwareDatetime | None = None  # noqa: N815 - mirrors the frontend
    snoozedUntil: AwareDatetime | None = None  # noqa: N815
    repeat: Literal["daily", "weekdays", "weekly"] | None = None
    watch: TimerWatch | None = None
    done: bool = False


class TimerNode(_NodeBase):
    """A reminder; its parent, when set, is the element it is attached to."""

    type: Literal["timer"]
    data: TimerData


Node = Annotated[
    TaskCardNode
    | FrameNode
    | StickyNode
    | ShapeNode
    | TextNode
    | ModuleNode
    | AnchorNode
    | TimerNode,
    Field(discriminator="type"),
]


class Edge(_Strict):
    id: str = Field(min_length=1, max_length=100)
    source: str = Field(max_length=100)
    target: str = Field(max_length=100)
    sourceHandle: str | None = Field(default=None, max_length=100)  # noqa: N815
    targetHandle: str | None = Field(default=None, max_length=100)  # noqa: N815


class Viewport(_Strict):
    x: float = 0
    y: float = 0
    zoom: float = 1


class BoardDoc(_Strict):
    nodes: list[Node] = Field(default_factory=list, max_length=MAX_NODES)
    edges: list[Edge] = Field(default_factory=list, max_length=MAX_NODES * 2)
    viewport: Viewport = Field(default_factory=Viewport)

    @model_validator(mode="before")
    @classmethod
    def _legacy_cards(cls, value: Any) -> Any:
        if not isinstance(value, dict) or not isinstance(value.get("nodes"), list):
            return value
        nodes = [
            {**node, "type": CARD}
            if isinstance(node, dict) and node.get("type") == LEGACY_CARD
            else node
            for node in value["nodes"]
        ]
        return {**value, "nodes": nodes}


class BoardOwner(BaseModel):
    id: str
    name: str


class BoardSummary(BaseModel):
    id: str
    name: str
    updated_at: str
    my_role: BoardRole
    owner: BoardOwner | None
    # Anyone with the board's public link can view it.
    public: bool = False


class BoardRow(BaseModel):
    """A board as storage sees it for one person, before roles are worked out."""

    id: str
    name: str
    updated_at: str
    member_role: BoardRole | None
    everyone_role: ShareRole | None
    owner_id: str | None
    owner_name: str | None
    public: bool = False


class BoardRecord(BaseModel):
    id: str
    name: str
    updated_at: str
    version: int
    doc: BoardDoc


class BoardView(BoardSummary):
    version: int
    # Plain dict so optional xyflow fields stay absent instead of coming back as null.
    doc: dict[str, Any]
    # By ref, `source:key`.
    tasks: dict[str, Task]
    # The tracker of a card that names none.
    default_source: str


def check_doc(doc: BoardDoc) -> None:
    """Rules the schema cannot express: references and xyflow's parent-before-child order."""
    seen: dict[str, str] = {}
    for node in doc.nodes:
        if node.id in seen:
            raise ValidationFailed(f"duplicate node id {node.id}")
        if node.parentId is not None and node.type == "timer":
            if seen.get(node.parentId) in (None, "anchor", "timer"):
                raise ValidationFailed(f"timer {node.id} must follow the element it is attached to")
        elif node.parentId is not None:
            if node.type in ("frame", "module"):
                raise ValidationFailed(f"{node.type}s cannot be nested")
            if seen.get(node.parentId) != "frame":
                raise ValidationFailed(f"node {node.id} must follow its parent frame")
        seen[node.id] = node.type
    edge_ids: set[str] = set()
    for edge in doc.edges:
        if edge.id in edge_ids:
            raise ValidationFailed(f"duplicate edge id {edge.id}")
        edge_ids.add(edge.id)
        if edge.source not in seen or edge.target not in seen:
            raise ValidationFailed(f"edge {edge.id} points at a missing node")


def task_refs(doc: BoardDoc, default_source: str) -> list[str]:
    """Refs of every live task on the board: cards and tasks inside modules. A task that
    names no source belongs to `default_source`, the tracker the instance is set to."""
    tasks: set[tuple[str | None, str]] = set()
    for node in doc.nodes:
        if isinstance(node, TaskCardNode):
            tasks.add((node.data.source, node.data.key))
        elif isinstance(node, ModuleNode):
            tasks |= module_keys(node.data.kind, node.data.content)
    return sorted({task_ref(source or default_source, key) for source, key in tasks})


def stage_refs(doc: BoardDoc) -> tuple[set[str], set[str], set[str]]:
    """Stage type, person and field ids the board's Gantts use in stages, columns and filters."""
    types: set[str] = set()
    people: set[str] = set()
    fields: set[str] = set()
    for node in doc.nodes:
        if isinstance(node, ModuleNode) and node.data.kind == "gantt":
            content = node.data.content
            fields.update(content.get("columns") or [])
            # A guest sees the names in the filter chips too.
            for key, values in (content.get("filters") or {}).items():
                if key == "person":
                    people.update(values)
                else:
                    fields.add(key)
            for row in node.data.content.get("rows", []):
                for stage in row.get("stages") or []:
                    types.add(stage["type"])
                    people.update(stage.get("people", []))
    return types, people, fields


def working_ranges(doc: BoardDoc) -> tuple[tuple[date, date], ...]:
    """Date ranges of the board's Gantts that count working days, for the days off a guest needs."""
    return tuple(
        (
            date.fromisoformat(node.data.content["start"]),
            date.fromisoformat(node.data.content["end"]),
        )
        for node in doc.nodes
        if isinstance(node, ModuleNode)
        and node.data.kind == "gantt"
        and node.data.content.get("workingDays")
    )


def _summary(row: BoardRow, role: BoardRole) -> BoardSummary:
    owner = BoardOwner(id=row.owner_id, name=row.owner_name or "") if row.owner_id else None
    return BoardSummary(
        id=row.id,
        name=row.name,
        updated_at=row.updated_at,
        my_role=role,
        owner=owner,
        public=row.public,
    )


def list_boards(
    person: Person, boards: BoardRepo, now: datetime
) -> tuple[list[BoardSummary], list[BoardSummary]]:
    """The person's boards by last change, and for admins every other board.

    A person gets their own welcome board on their first read.
    """
    doc = BoardDoc.model_validate(welcome_doc(now, person.demo_expires_at is not None))
    boards.create_welcome(person.id, WELCOME_NAME, doc)
    mine: list[BoardSummary] = []
    others: list[BoardSummary] = []
    for row in boards.listing(person.id, others=person.role == "admin"):
        role = effective_role(person, row.member_role, row.everyone_role)
        if role is None:
            continue
        # Admins act as owner everywhere; boards nobody shared with them sit apart.
        shared = granted_role(row.member_role, row.everyone_role) is not None
        (mine if shared else others).append(_summary(row, role))
    return mine, others


def summary(person: Person, board_id: str, boards: BoardRepo) -> BoardSummary:
    rows = boards.listing(person.id, board_id)
    if not rows:
        raise NotFound("board not found")
    row = rows[0]
    role = effective_role(person, row.member_role, row.everyone_role)
    if role is None:
        raise NotFound("board not found")
    return _summary(row, role)


def create_board(
    person: Person, name: str, boards: BoardRepo, limit: int | None = None
) -> BoardSummary:
    """Raises BoardLimit when the person already owns `limit` boards."""
    board_id = boards.create(name, BoardDoc(), person.id, limit)
    if board_id is None:
        raise BoardLimit(f"An account here holds {limit} boards. Delete one to make another.")
    return summary(person, board_id, boards)


def get_board(
    person: Person,
    role: BoardRole,
    board_id: str,
    boards: BoardRepo,
    snapshots: SnapshotRepo,
    default_source: str,
) -> BoardView:
    record = boards.get(board_id)
    if record is None:
        raise NotFound("board not found")
    tasks = snapshots.get_many(task_refs(record.doc, default_source))
    info = summary(person, board_id, boards)
    return BoardView(
        **info.model_dump(exclude={"my_role"}),
        my_role=role,
        version=record.version,
        doc=record.doc.model_dump(exclude_none=True),
        tasks=tasks,
        default_source=default_source,
    )


def rename_board(
    person: Person, board_id: str, name: str, boards: BoardRepo, live: LiveBoards
) -> BoardSummary:
    boards.rename(board_id, name)
    # The name is not in the live document: guests read it again when their socket closes.
    live.end_public(board_id)
    return summary(person, board_id, boards)


def delete_board(board_id: str, boards: BoardRepo, live: LiveBoards) -> None:
    boards.delete(board_id)
    live.recheck_board(board_id)
    live.end_public(board_id)


def save_board(board_id: str, version: int, doc: BoardDoc, live: LiveBoards) -> int:
    check_doc(doc)
    return live.put(board_id, version, doc)
