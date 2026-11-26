"""A batch of changes to a board from the API (spec 046), planned on the board's stored state.

`plan` is pure: given what the board holds, it returns what it will hold, or raises. The room
writes the result only when the board's own repair would change nothing in it, so a batch is
applied whole or not at all.
"""

import re
from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain import gantt_steps, layout
from app.domain.boards import LABEL_MAX, CodeLanguage, Opacity, ShapeKind, TextSize
from app.domain.errors import (
    Conflict,
    KeepsPeopleWork,
    NotApiElement,
    NotFound,
    TimerLimit,
    ValidationFailed,
    VoteRunning,
)
from app.domain.live import repaired
from app.domain.modules import validate_module

Stored = dict[str, dict[str, Any]]

MAX_ELEMENTS = 200
MAX_CARDS = 50
ID_PATTERN = r"^[A-Za-z0-9-]{1,64}$"
# The browser keeps elements in plain objects, where these names are already taken.
_TAKEN = {
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
}
_PLACE = Field(default=None, ge=-1_000_000, le=1_000_000)
_SIZE = Field(default=None, ge=1, le=20_000)
_TYPES = {
    "card": "task_card",
    "note": "sticky",
    "text": "text",
    "code": "code",
    "shape": "shape",
    "frame": "frame",
    "timer": "timer",
}
# Waiting reminders a board may hold before the API stops adding them; the web app sets none.
MAX_TIMERS = 50
# What a reminder attaches to, and where it sits: left of the top edge (`attach.ts`).
_HOLDERS = {"task_card", "sticky", "shape", "text", "code", "image", "module"}
_BESIDE = {"x": -46.0, "y": 0.0}
Repeat = Literal["daily", "weekdays", "weekly"]
# The data key that holds each stored type's text.
_TEXT = {"sticky": "text", "text": "text", "shape": "text", "frame": "title"}
# The look each stored type takes, as the web app's style bar offers it; a key may set these on
# any element, its person's included.
_STYLES = {
    "sticky": {"color", "bold", "opacity", "rotation"},
    "shape": {"color", "bold", "size", "opacity", "rotation", "stroke", "dash"},
    "text": {"bold", "size", "opacity", "rotation"},
    "frame": {"color", "opacity"},
}
_STYLE_FIELDS = ("bold", "size", "opacity", "rotation", "stroke", "dash")
_SIZED = {"sticky": "wh", "shape": "wh", "frame": "wh", "text": "w", "code": "w"}
# A code block's own fields: how it shows its code, not the code itself, so any element's
# block takes them, as the look of a note does.
_CODE = ("language", "collapsed", "numbered", "marked")
TEXT_MAX = 5000
CODE_MAX = 10_000
Marked = Annotated[list[Annotated[int, Field(ge=1, le=10_000)]], Field(max_length=500)]


def _code_only(kind: str | None, given: set[str], text: str | None) -> None:
    if kind != "code":
        if code := sorted(given & set(_CODE)):
            raise ValueError(f"only a code block takes {code[0]}")
        if text is not None and len(text) > TEXT_MAX:
            raise ValueError(f"text holds up to {TEXT_MAX} characters; a code block {CODE_MAX}")


def _free_name(value: str | None) -> str | None:
    if value is not None and value in _TAKEN:
        raise ValueError(f"{value} cannot be an id")
    return value


class _Styled(BaseModel):
    language: CodeLanguage | None = None
    collapsed: bool | None = None
    numbered: bool | None = None
    marked: Marked | None = None
    bold: bool | None = None
    size: TextSize | None = None
    opacity: Opacity | None = None
    rotation: float | None = Field(default=None, ge=-100_000, le=100_000)
    stroke: Literal[1, 1.5, 3] | None = None
    dash: bool | None = None

    @field_validator("rotation")
    @classmethod
    def _fold(cls, value: float | None) -> int | None:
        # Stored as the web app's rotate handle stores it: whole degrees from -180 to 180.
        return None if value is None else (round(value) + 180) % 360 - 180

    def styles(self, given: set[str]) -> dict[str, Any]:
        return {name: getattr(self, name) for name in _STYLE_FIELDS if name in given}


class NewElement(_Styled):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str | None = Field(default=None, pattern=ID_PATTERN)
    kind: Literal["card", "note", "text", "code", "shape", "frame", "arrow", "timer"]
    x: float | None = _PLACE
    y: float | None = _PLACE
    w: float | None = _SIZE
    h: float | None = _SIZE
    frame: str | None = Field(default=None, max_length=100)
    text: str | None = Field(default=None, max_length=CODE_MAX)
    title: str | None = Field(default=None, max_length=200)
    color: str | None = Field(default=None, max_length=20)
    shape: ShapeKind | None = None
    # A card: a key or a link, as the card tool takes it.
    ref: str | None = Field(default=None, max_length=500)
    from_: str | None = Field(default=None, alias="from", max_length=100)
    to: str | None = Field(default=None, max_length=100)
    # An arrow's words; empty or left out for none.
    label: str | None = Field(default=None, max_length=LABEL_MAX)
    # A reminder: at a moment, or when the task of the card it sits on leaves `status`.
    note: str | None = Field(default=None, max_length=500)
    at: AwareDatetime | None = None
    repeat: Repeat | None = None
    status: str | None = Field(default=None, max_length=200)
    on: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def _fits_its_kind(self) -> "NewElement":
        _free_name(self.id)
        _code_only(self.kind, self.model_fields_set, self.text)
        timed = {"note", "at", "repeat", "status", "on"} & self.model_fields_set
        if self.kind != "timer" and timed:
            raise ValueError(f"only a reminder takes {sorted(timed)[0]}")
        if self.kind == "timer":
            if self.w or self.h:
                raise ValueError("a reminder takes no size")
            placed = self.x is not None or self.frame is not None
            if placed and (self.on or self.ref or self.status):
                raise ValueError("a reminder on an element sits beside it: leave out x and frame")
            if self.at is not None and (self.ref or self.status):
                raise ValueError("a reminder goes off at a moment or on a status change, not both")
            if self.at is None and self.repeat:
                raise ValueError("only a reminder at a moment repeats")
            if self.at is None and not (self.ref or self.on):
                raise ValueError("give at, or a task or card whose status to watch")
        if (self.x is None) != (self.y is None):
            raise ValueError("give x and y together, or neither")
        if self.kind != "arrow" and self.label is not None:
            raise ValueError("only an arrow takes label")
        if self.kind == "arrow":
            if not (self.from_ and self.to):
                raise ValueError("an arrow joins two elements: give from and to")
            if self.from_ == self.to:
                raise ValueError("an arrow cannot join an element to itself")
            if self.x is not None or self.frame is not None or self.w or self.h:
                raise ValueError("an arrow has no place, size or frame of its own")
        if self.kind == "card" and not self.ref:
            raise ValueError("a card needs ref: a key or a link")
        if self.kind == "card" and (self.w or self.h):
            raise ValueError("a card takes no size: the board measures it")
        if self.kind in ("text", "code") and self.h:
            raise ValueError(
                f"{'a code block' if self.kind == 'code' else 'text'} takes a width only"
            )
        if self.kind == "shape" and self.shape is None:
            raise ValueError("a shape needs shape")
        if self.kind == "frame" and self.frame is not None:
            raise ValueError("frames do not go inside frames")
        return self


class Change(_Styled):
    model_config = ConfigDict(extra="forbid")

    # A reminder's own fields; `repeat` null makes it go off once.
    note: str | None = Field(default=None, max_length=500)
    at: AwareDatetime | None = None
    repeat: Repeat | None = None
    # A reminder: the element it moves to sit on; null frees it where it stands.
    on: str | None = Field(default=None, max_length=100)

    id: str = Field(max_length=100)
    x: float | None = _PLACE
    y: float | None = _PLACE
    w: float | None = _SIZE
    h: float | None = _SIZE
    # Null takes the element out of its frame; left out, the frame stays as it is.
    frame: str | None = Field(default=None, max_length=100)
    text: str | None = Field(default=None, max_length=CODE_MAX)
    title: str | None = Field(default=None, max_length=200)
    color: str | None = Field(default=None, max_length=20)
    shape: ShapeKind | None = None
    # An arrow's words; empty takes the label away.
    label: str | None = Field(default=None, max_length=LABEL_MAX)

    @model_validator(mode="after")
    def _together(self) -> "Change":
        if (self.x is None) != (self.y is None):
            raise ValueError("give x and y together, or neither")
        for name in ("x", "y", "w", "h", "note", "at", "label", *_STYLE_FIELDS, *_CODE):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null; leave it out to keep it")
        return self


class CardRef(BaseModel):
    source: str
    key: str


class Arrange(BaseModel):
    cards: list[str] = Field(min_length=1, max_length=MAX_ELEMENTS)
    layout: Literal["grid", "status"] = "grid"
    # Cards a row; left out, as many as fit an existing frame's width, or `layout.PER_ROW`.
    columns: int | None = Field(default=None, ge=1, le=20)
    order: Literal["given", "key", "status"] = "given"
    # The frame takes the size of what it holds, smaller or larger.
    fit: bool = False
    frame_id: str | None = None
    # A new frame below the board, made with this id and title.
    new_frame: tuple[str, str] | None = None
    # Each card's status: its category's rank and name, for the status layout.
    statuses: dict[str, tuple[int, str]] = {}


class Watch(BaseModel):
    """What a status reminder watches: its card's task as the card names it."""

    key: str
    source: str | None = None
    status: str


class NewGantt(BaseModel):
    """An empty Gantt the API puts on the board (spec 056)."""

    id: str
    title: str = Field(default="", max_length=200)
    start: date
    end: date
    scale: Literal["day", "week", "month", "quarter"] = "week"
    x: float | None = _PLACE
    y: float | None = _PLACE


class GanttCall(BaseModel):
    """Steps on one Gantt, with what the route resolved for them."""

    module: str
    steps: list[gantt_steps.Step]
    context: gantt_steps.Context


class Batch(BaseModel):
    """What one API call asks of a board; ids of new elements are set before it is planned."""

    adds: list[NewElement] = []
    cards: dict[str, CardRef] = {}
    # Sent to another process without unset fields, so each change keeps what it set.
    changes: list[Change] = []
    removes: list[str] = []
    arrange: Arrange | None = None
    # Status reminders by id, resolved against their card before the plan.
    watches: dict[str, Watch] = {}
    # Elements the caller's person added through the API: theirs to change and remove.
    mine: list[str] = []
    # A key with full access (spec 055): changes and removes everyone's work, as its person may.
    full: bool = False
    # Who the call is for, named in a copy saved before it.
    by: str | None = None
    # A saved copy of the board to put back instead of any change.
    restore: str | None = None
    # Planned and answered, never written (spec 057).
    dry: bool = False
    new_gantt: NewGantt | None = None
    gantt: GanttCall | None = None


class Applied(BaseModel):
    ids: list[str] = []
    created: list[str] = []
    removed: list[str] = []
    # People's elements and arrows the call changes the words of or removes; a copy comes first.
    overwrote: list[str] = []
    # A dry run's planned board as JSON: the answer is built from it, not from a saved board.
    planned: dict[str, Any] | None = None
    gantt: gantt_steps.Result | None = None


def iso(moment: datetime) -> str:
    """A moment as the web app writes one: UTC with milliseconds and Z."""
    return moment.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _natural(key: str) -> tuple[tuple[int, int | str], ...]:
    """A task key in reading order: DEMO-9 before DEMO-10."""
    parts = re.split(r"(\d+)", key.lower())
    return tuple((0, int(part)) if part.isdigit() else (1, part) for part in parts if part)


def _absolute(nodes: Stored, node_id: str | None) -> tuple[float, float]:
    x = y = 0.0
    for _ in range(4):
        node = nodes.get(node_id) if node_id else None
        if node is None:
            break
        x, y = x + node["place"]["x"], y + node["place"]["y"]
        node_id = node["place"].get("parentId")
    return x, y


class _Plan:
    def __init__(self, nodes: Stored, edges: Stored, batch: Batch, locked: frozenset[str]):
        self.before = nodes
        self.nodes = dict(nodes)
        self.edges = dict(edges)
        self.batch = batch
        self.locked = locked
        self.mine = set(batch.mine)
        self.changed: tuple[set[str], set[str]] = (set(), set())
        self.applied = Applied()
        self.order = max((n["order"] for n in nodes.values()), default=0.0)

    def _put(self, node_id: str, node: dict[str, Any]) -> None:
        self.nodes[node_id] = node
        self.changed[0].add(node_id)

    def _frame(self, frame_id: str) -> dict[str, Any]:
        frame = self.nodes.get(frame_id)
        if frame is None or frame["type"] != "frame":
            raise NotFound(f"frame {frame_id} not found")
        return frame

    def _own(self, element_id: str, what: str) -> None:
        if element_id in self.locked:
            raise VoteRunning(f"{element_id} is in a running vote.")
        if element_id in self.mine:
            return
        if not self.batch.full:
            raise NotApiElement(f"{element_id} was not added through the API; {what} it by hand.")
        if element_id not in self.applied.overwrote:
            self.applied.overwrote.append(element_id)

    # Removal first: a batch may take an element out and put another in its place.
    def remove(self) -> None:
        for element_id in self.batch.removes:
            if element_id in self.edges:
                self._own(element_id, "remove")
                self._drop_edge(element_id)
            elif element_id in self.nodes:
                self._remove_node(element_id)
            else:
                continue
            self.applied.removed.append(element_id)

    def _drop_edge(self, edge_id: str) -> None:
        edge = self.edges.pop(edge_id)
        self.changed[1].add(edge_id)
        for end in (edge["source"], edge["target"]):
            node = self.nodes.get(end)
            used = any(end in (e["source"], e["target"]) for e in self.edges.values())
            if node is not None and node["type"] == "anchor" and not used:
                del self.nodes[end]

    def _remove_node(self, node_id: str) -> None:
        self._own(node_id, "remove")
        for edge_id, edge in list(self.edges.items()):
            if node_id in (edge["source"], edge["target"]):
                if edge_id not in self.mine and not self.batch.full:
                    raise KeepsPeopleWork(
                        f"{node_id} has an arrow someone drew; remove that first."
                    )
                self._own(edge_id, "remove")
                self._drop_edge(edge_id)
                # Said in the answer: a person approving a removal sees the arrows go too.
                self.applied.removed.append(edge_id)
        node = self.nodes[node_id]
        for child_id, child in list(self.nodes.items()):
            if child["place"].get("parentId") != node_id:
                continue
            if child["type"] == "timer" and node["type"] in _HOLDERS:
                if child_id not in self.mine and not self.batch.full:
                    raise KeepsPeopleWork(f"{node_id} has a reminder on it; remove that first.")
                self._own(child_id, "remove")
                # The API's own reminder goes with its element, as its own arrow does.
                del self.nodes[child_id]
                self.applied.removed.append(child_id)
                continue
            x, y = _absolute(self.nodes, child_id)
            self._put(child_id, {**child, "place": {"x": x, "y": y}})
        del self.nodes[node_id]

    def add(self) -> None:
        unplaced: dict[str | None, list[str]] = {}
        for element in self.batch.adds:
            element_id = element.id
            assert element_id is not None
            if element_id in self.nodes or element_id in self.edges:
                if element_id not in self.mine:
                    raise Conflict(f"{element_id} is taken on this board.")
                # A retry of an element this person added: answered as it stands now.
                self.applied.ids.append(element_id)
                continue
            if element.kind == "arrow":
                self._add_arrow(element)
            else:
                self._add_node(element)
                if element.x is None and not (element.kind == "timer" and element.on):
                    unplaced.setdefault(element.frame, []).append(element_id)
            self.applied.ids.append(element_id)
            self.applied.created.append(element_id)
            self.mine.add(element_id)
        for frame_id, ids in unplaced.items():
            self._place(frame_id, ids)
        timers = [n for n in self.nodes.values() if n["type"] == "timer"]
        made = any(self.nodes.get(i, {}).get("type") == "timer" for i in self.applied.created)
        if made and sum(not n["data"].get("done") for n in timers) > MAX_TIMERS:
            raise TimerLimit(f"A board holds at most {MAX_TIMERS} waiting reminders.")

    def _add_arrow(self, element: NewElement) -> None:
        for end in (element.from_, element.to):
            node = self.nodes.get(end or "")
            if node is None or node["type"] == "anchor":
                raise NotFound(f"element {end} not found")
        edge: dict[str, Any] = {"source": element.from_, "target": element.to}
        if element.label and element.label.strip():
            edge["data"] = {"label": {"text": element.label}}
        self.edges[element.id] = edge
        self.changed[1].add(element.id)

    def _data(self, element: NewElement) -> dict[str, Any]:
        styles = element.styles(element.model_fields_set)
        kind = _TYPES.get(element.kind, element.kind)
        looks = [*styles, *(["color"] if element.color is not None else [])]
        for name in looks:
            if name not in _STYLES.get(kind, ()):
                raise ValidationFailed(f"{element.id}: a {element.kind} has no {name}")
        return self._content(element) | {k: v for k, v in styles.items() if v is not None}

    def _content(self, element: NewElement) -> dict[str, Any]:
        if element.kind == "timer":
            return self._timer(element)
        if element.kind == "card":
            card = self.batch.cards.get(element.id)
            if card is None:
                raise ValidationFailed(f"card {element.id}: its task was not found")
            return {"key": card.key, "source": card.source, "collapsed": False}
        if element.kind == "note":
            return {"text": element.text or "", "color": element.color or "yellow"}
        if element.kind == "text":
            return {"text": element.text or ""}
        if element.kind == "code":
            data = {"text": element.text or "", "language": element.language or "plain"}
            shown = {name: getattr(element, name) for name in ("title", *_CODE[1:])}
            return data | {name: value for name, value in shown.items() if value is not None}
        if element.kind == "shape":
            data = {"shape": element.shape, "text": element.text or ""}
            return data | {"color": element.color or "none"}
        data = {"title": element.title or element.text or ""}
        return data | ({"color": element.color} if element.color else {})

    def _timer(self, element: NewElement) -> dict[str, Any]:
        data: dict[str, Any] = {"note": element.note or ""}
        if element.at is not None:
            data["dueAt"] = iso(element.at)
            return data | ({"repeat": element.repeat} if element.repeat else {})
        watch = self.batch.watches.get(element.id or "")
        holder = self.nodes.get(element.on or "")
        if watch is None or holder is None or holder["type"] != "task_card":
            raise ValidationFailed(f"{element.id}: a status reminder sits on its task's card")
        named = watch.model_dump(exclude_none=True)
        return data | {"dueAt": None, "watch": named}

    def _add_node(self, element: NewElement) -> None:
        kind = _TYPES[element.kind]
        place: dict[str, Any] = {"x": 0.0, "y": 0.0}
        if kind == "timer" and element.on:
            holder = self.nodes.get(element.on)
            if holder is None or holder["type"] not in _HOLDERS:
                raise NotFound(f"no element {element.on} a reminder can sit on")
            place = {**_BESIDE, "parentId": element.on}
        elif element.frame is not None:
            self._frame(element.frame)
            place["parentId"] = element.frame
            if element.x is not None:
                fx, fy = _absolute(self.nodes, element.frame)
                place |= {"x": element.x - fx, "y": element.y - fy}
        elif element.x is not None:
            place |= {"x": element.x, "y": element.y}
        width, height = layout.SIZES[kind]
        size: dict[str, float] = {}
        if kind != "task_card":
            size["width"] = element.w or width
        if kind in ("sticky", "shape", "frame", "timer"):
            size["height"] = element.h or height
        self.order += 1
        node = {"type": kind, "place": place, "size": size, "order": self.order}
        self._put(element.id, node | {"data": self._data(element)})

    def _place(self, frame_id: str | None, ids: list[str]) -> None:
        sizes = [layout.size(self.nodes[i]) for i in ids]
        if frame_id is None:
            others = {k: v for k, v in self.nodes.items() if k not in ids}
            places = layout.grid(sizes, 0.0, layout.bottom(others) + layout.GAP)
        else:
            top = layout.inside(self.nodes, frame_id, set(ids))
            places = layout.grid(sizes, layout.FRAME_PAD, top)
            self._put(frame_id, layout.grow(self._frame(frame_id), places, sizes))
        for element_id, (x, y) in zip(ids, places, strict=True):
            node = self.nodes[element_id]
            self._put(element_id, {**node, "place": {**node["place"], "x": x, "y": y}})

    def change(self) -> None:
        for change in self.batch.changes:
            given = change.model_fields_set
            if change.id in self.edges:
                self._relabel(change, given)
                continue
            node = self.nodes.get(change.id)
            if node is None or node["type"] == "anchor":
                raise NotFound(f"element {change.id} not found")
            if "label" in given:
                raise ValidationFailed(f"{change.id}: only an arrow takes label")
            node = self._restyle(change, node, given)
            node = self._retime(change, node, given)
            node = self._resize(change, node, given)
            node = self._reattach(change, node, given)
            self._put(change.id, self._move(change, node, given))
            self.applied.ids.append(change.id)

    def _relabel(self, change: Change, given: set[str]) -> None:
        if given != {"id", "label"}:
            raise ValidationFailed(
                f"{change.id} is an arrow: only its label changes; remove it and draw another."
            )
        # The words are the person's, as a note's text is.
        self._own(change.id, "change")
        edge = dict(self.edges[change.id])
        data = dict(edge.pop("data", None) or {})
        text = change.label or ""
        if text.strip():
            # A new text keeps where the label sits and how it looks.
            data["label"] = {**data.get("label", {}), "text": text}
        else:
            data.pop("label", None)
        self.edges[change.id] = edge | ({"data": data} if data else {})
        self.changed[1].add(change.id)
        self.applied.ids.append(change.id)

    def _restyle(self, change: Change, node: dict[str, Any], given: set[str]) -> dict[str, Any]:
        words = given & {"text", "title", "shape"}
        looks = given & {"color", *_STYLE_FIELDS, *_CODE}
        if not (words or looks):
            return node
        # Words and form are the person's; the look is not, so tidying needs no ownership.
        if words:
            self._own(change.id, "change")
        elif change.id in self.locked:
            raise VoteRunning(f"{change.id} is in a running vote.")
        data = dict(node["data"])
        kind = node["type"]
        try:
            _code_only(kind, given, change.text)
        except ValueError as error:
            raise ValidationFailed(f"{change.id}: {error}") from error
        for name in words | looks:
            value = getattr(change, name)
            if name == "shape":
                key = "shape" if kind == "shape" else None
            elif kind == "code" and name in ("text", "title", *_CODE):
                key = name
            elif name in ("text", "title"):
                key = _TEXT.get(kind)
            else:
                key = name if name in _STYLES.get(kind, ()) else None
            if key is None or value is None:
                raise ValidationFailed(f"{change.id}: a {kind} has no {name} to change")
            data[key] = value
        return {**node, "data": data}

    def _retime(self, change: Change, node: dict[str, Any], given: set[str]) -> dict[str, Any]:
        wanted = given & {"note", "at", "repeat"}
        if not wanted:
            return node
        if node["type"] != "timer":
            raise ValidationFailed(f"{change.id}: only a reminder takes {sorted(wanted)[0]}")
        self._own(change.id, "change")
        data = dict(node["data"])
        if change.note is not None:
            data["note"] = change.note
        if change.at is not None:
            # A new moment, as the editor sets one: no snooze, not done, no status watched.
            for gone in ("snoozedUntil", "done", "watch"):
                data.pop(gone, None)
            data["dueAt"] = iso(change.at)
        if "repeat" in given:
            if change.repeat and data.get("watch"):
                raise ValidationFailed(f"{change.id}: a status reminder does not repeat")
            data.pop("repeat", None)
            data |= {"repeat": change.repeat} if change.repeat else {}
        return {**node, "data": data}

    def _resize(self, change: Change, node: dict[str, Any], given: set[str]) -> dict[str, Any]:
        wanted = given & {"w", "h"}
        if not wanted:
            return node
        allowed = _SIZED.get(node["type"], "")
        if ("w" in wanted and "w" not in allowed) or ("h" in wanted and "h" not in allowed):
            raise ValidationFailed(f"{change.id}: a {node['type']} does not take that size")
        if change.id in self.locked:
            raise VoteRunning(f"{change.id} is in a running vote.")
        size = dict(node["size"])
        if change.w is not None:
            size["width"] = change.w
        if change.h is not None:
            size["height"] = change.h
        return {**node, "size": size}

    def _holder(self, node: dict[str, Any]) -> str | None:
        """The element a reminder sits on; a frame only contains it."""
        parent = node["place"].get("parentId")
        held = parent is not None and self.nodes.get(parent, {}).get("type") in _HOLDERS
        return parent if node["type"] == "timer" and held else None

    def _reattach(self, change: Change, node: dict[str, Any], given: set[str]) -> dict[str, Any]:
        if "on" not in given:
            return node
        if node["type"] != "timer":
            raise ValidationFailed(f"{change.id}: only a reminder takes on")
        if change.x is not None or "frame" in given:
            raise ValidationFailed(f"{change.id}: give on, or a place, not both")
        watch = node["data"].get("watch")
        if change.on is None:
            if self._holder(node) is None:
                return node
            if watch:
                raise ValidationFailed(f"{change.id}: a status reminder stays on its task's card")
            x, y = _absolute(self.nodes, change.id)
            return {**node, "place": {"x": x, "y": y}}
        holder = self.nodes.get(change.on)
        if holder is None or holder["type"] not in _HOLDERS:
            raise NotFound(f"no element {change.on} a reminder can sit on")
        if watch:
            data = holder["data"] if holder["type"] == "task_card" else {}
            if data.get("key") != watch.get("key") or data.get("source") != watch.get("source"):
                raise ValidationFailed(f"{change.id}: a status reminder sits on its task's card")
        return {**node, "place": {**_BESIDE, "parentId": change.on}}

    def _move(self, change: Change, node: dict[str, Any], given: set[str]) -> dict[str, Any]:
        if change.x is None and "frame" not in given:
            return node
        if self._holder(node) is not None:
            # Placed against where its element was before this call moved it, it would land off.
            raise ValidationFailed(
                f"{change.id}: a reminder on an element moves with it; give on to put it on "
                "another one, or on null to free it"
            )
        x, y = (change.x, change.y) if change.x is not None else _absolute(self.nodes, change.id)
        parent = node["place"].get("parentId")
        if "frame" in given:
            parent = change.frame
            if parent is not None:
                self._frame(parent)
                if node["type"] in ("frame", "module"):
                    raise ValidationFailed(f"{change.id}: a {node['type']} cannot go in a frame")
        px, py = _absolute(self.nodes, parent)
        place: dict[str, Any] = {"x": x - px, "y": y - py}
        if parent is not None:
            place["parentId"] = parent
        return {**node, "place": place}

    def arrange(self) -> None:
        request = self.batch.arrange
        if request is None:
            return
        for card_id in request.cards:
            node = self.nodes.get(card_id)
            if node is None or node["type"] != "task_card":
                raise NotFound(f"card {card_id} not found")
        cards = list(dict.fromkeys(request.cards))
        frame_id = request.frame_id
        if request.new_frame is not None:
            frame_id, title = request.new_frame
            others = {k: v for k, v in self.nodes.items() if k not in cards}
            self.order += 1
            frame = {
                "type": "frame",
                "place": {"x": 0.0, "y": layout.bottom(others) + layout.GAP},
                "size": dict(zip(("width", "height"), layout.SIZES["frame"], strict=True)),
                "order": self.order,
                "data": {"title": title},
            }
            self._put(frame_id, frame)
            self.applied.created.append(frame_id)
            self.applied.ids.append(frame_id)
            self.mine.add(frame_id)
        elif frame_id is not None:
            self._frame(frame_id)
        if request.fit and frame_id is None:
            raise ValidationFailed("fit needs a frame: give one or a title for a new one")
        groups = self._groups(cards, request)
        flat = [card for group in groups for card in group]
        sizes = [layout.SIZES["task_card"] for _ in flat]
        per_row = request.columns or layout.PER_ROW
        if request.columns is None and frame_id is not None and request.new_frame is None:
            per_row = layout.fitting(self.nodes[frame_id], sizes[0][0])
        if frame_id is None:
            others = {k: v for k, v in self.nodes.items() if k not in flat}
            x, y = 0.0, layout.bottom(others) + layout.GAP
        elif request.new_frame is not None:
            x, y = layout.FRAME_PAD, layout.FRAME_TOP
        else:
            x, y = layout.FRAME_PAD, layout.inside(self.nodes, frame_id, set(flat))
        if request.layout == "status":
            places = layout.columns([[sizes[0]] * len(group) for group in groups], x, y)
        else:
            places = layout.grid(sizes, x, y, per_row)
        for card_id, (cx, cy) in zip(flat, places, strict=True):
            node = self.nodes[card_id]
            place: dict[str, Any] = {"x": cx, "y": cy}
            if frame_id is not None:
                place["parentId"] = frame_id
            self._put(card_id, {**node, "place": place})
            self.applied.ids.append(card_id)
        if frame_id is not None and request.fit:
            self._put(frame_id, layout.fit(self.nodes, frame_id))
        elif frame_id is not None:
            self._put(frame_id, layout.grow(self.nodes[frame_id], places, sizes))
        if frame_id is not None and frame_id not in self.applied.ids:
            # Its size changes with what it holds, and a layout needs to know it.
            self.applied.ids.append(frame_id)

    def _groups(self, cards: list[str], request: Arrange) -> list[list[str]]:
        def status(card_id: str) -> tuple[int, str]:
            rank, name = request.statuses.get(card_id, (9, ""))
            return rank, name.lower()

        def key(card_id: str) -> tuple[tuple[int, int | str], ...]:
            return _natural(self.nodes[card_id]["data"].get("key", ""))

        if request.order == "key":
            cards = sorted(cards, key=key)
        elif request.order == "status":
            cards = sorted(cards, key=lambda card_id: (status(card_id), key(card_id)))
        if request.layout == "grid":
            return [cards]
        groups: dict[tuple[int, str], list[str]] = {}
        for card_id in cards:
            groups.setdefault(status(card_id), []).append(card_id)
        return [groups[name] for name in sorted(groups)]

    def gantt(self) -> None:
        new = self.batch.new_gantt
        if new is not None:
            self._new_gantt(new)
        call = self.batch.gantt
        if call is None:
            return
        node = self.nodes.get(call.module)
        if node is None or node["type"] != "module" or node["data"].get("kind") != "gantt":
            raise NotFound(f"gantt {call.module} not found")
        self._own(call.module, "change")
        # A plan collects people's edits even when a key made it: every change keeps a way back.
        if call.module not in self.applied.overwrote:
            self.applied.overwrote.append(call.module)
        result = gantt_steps.apply(node["data"]["content"], call.steps, call.context)
        self._put(call.module, {**node, "data": {**node["data"], "content": result.content}})
        self.applied.ids.append(call.module)
        self.applied.gantt = result

    def _new_gantt(self, new: NewGantt) -> None:
        if new.id in self.nodes or new.id in self.edges:
            if new.id not in self.mine:
                raise Conflict(f"{new.id} is taken on this board.")
            self.applied.ids.append(new.id)
            return
        try:
            content = validate_module(
                "gantt",
                {"start": new.start.isoformat(), "end": new.end.isoformat(), "scale": new.scale},
            )
        except ValueError as invalid:
            raise ValidationFailed(str(invalid)) from None
        width, height = layout.SIZES["module"]
        self.order += 1
        self._put(
            new.id,
            {
                "type": "module",
                "place": {"x": new.x or 0.0, "y": new.y or 0.0},
                "size": {"width": width, "height": height},
                "order": self.order,
                "data": {"kind": "gantt", "title": new.title, "content": content},
            },
        )
        if new.x is None:
            self._place(None, [new.id])
        self.applied.ids.append(new.id)
        self.applied.created.append(new.id)
        self.mine.add(new.id)

    def check(self) -> None:
        """Refuses a board the repair would still change: the batch must stand as planned."""
        good, kept, notes = repaired(self.nodes, self.edges, self.before, self.changed, self.locked)
        if notes or good != self.nodes or kept != self.edges:
            reason = notes[0].replace("_", " ") if notes else "board rules"
            broken = sorted(
                {i for i in self.changed[0] if good.get(i) != self.nodes.get(i)}
                | {i for i in self.changed[1] if kept.get(i) != self.edges.get(i)}
            )
            which = f" ({', '.join(broken[:5])})" if broken else ""
            raise ValidationFailed(f"This change would break the board: {reason}{which}.")


def plan(
    nodes: Stored, edges: Stored, batch: Batch, locked: frozenset[str] = frozenset()
) -> tuple[Stored, Stored, Applied]:
    """The board after `batch`, and what to answer with. Raises when the batch cannot stand."""
    steps = len(batch.gantt.steps) if batch.gantt else 0
    count = len(batch.adds) + len(batch.changes) + len(batch.removes) + steps
    if count > MAX_ELEMENTS:
        raise ValidationFailed(f"At most {MAX_ELEMENTS} elements a call.")
    # A node the document could not read stays out; the board's repair would drop it anyway.
    work = _Plan({k: v for k, v in nodes.items() if v is not None}, edges, batch, locked)
    work.remove()
    work.add()
    work.change()
    work.arrange()
    work.gantt()
    work.check()
    return work.nodes, work.edges, work.applied
