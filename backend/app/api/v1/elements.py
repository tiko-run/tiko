import re
import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field, model_validator

from app.api import deps
from app.api.v1 import planning
from app.api.v1.boards import Board, boards_of, shape
from app.api.v1.deps import (
    Key,
    KeyPerson,
    Writable,
    full,
    full_budget,
    search_budget,
    write_budget,
)
from app.domain.api_gantt import Names, RowOut, gantt_view, tracker_span
from app.domain.api_view import Element
from app.domain.batch import (
    MAX_CARDS,
    MAX_ELEMENTS,
    Applied,
    Arrange,
    Batch,
    CardRef,
    Change,
    GanttCall,
    NewElement,
    NewGantt,
    Watch,
)
from app.domain.boards import BoardName, create_board, rename_board
from app.domain.copies import Reason
from app.domain.demo import board_limit
from app.domain.errors import InvalidRef, NotApiElement, NotFound, TaskNotFound, ValidationFailed
from app.domain.gantt_steps import MAX_STEPS, Context, Resolved, Step
from app.domain.sources import SOURCES, route_ref, valid_key
from app.domain.tasks import Task, task_ref

router = APIRouter(prefix="/boards", tags=["writing"], dependencies=[Depends(write_budget)])

# A card named by its tracker outright: CalDAV tasks have neither a short key nor a link.
_EXPLICIT = re.compile(rf"^({'|'.join(SOURCES)}):(.+)$")
_RANK = {"new": 0, "indeterminate": 1, "done": 2}


class NewBoard(BaseModel):
    name: BoardName


class AddIn(BaseModel):
    elements: list[NewElement] = Field(min_length=1, max_length=MAX_ELEMENTS)


class ChangeIn(BaseModel):
    changes: list[Change] = Field(min_length=1, max_length=MAX_ELEMENTS)


class RemoveIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=MAX_ELEMENTS)


class FrameRef(BaseModel):
    """An existing frame by `id`, or a new one below the board by `title`."""

    id: str | None = Field(default=None, max_length=100)
    title: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _one(self) -> "FrameRef":
        if (self.id is None) == (self.title is None):
            raise ValueError("give the frame's id or a title for a new one")
        return self


class ArrangeIn(BaseModel):
    cards: list[str] = Field(min_length=1, max_length=MAX_ELEMENTS)
    layout: Literal["grid", "status"] = "grid"
    frame: FrameRef | None = None
    # Cards a row; left out, as many as fit an existing frame's width, or 4.
    columns: int | None = Field(default=None, ge=1, le=20)
    order: Literal["given", "key", "status"] = "given"
    # The frame takes the size of what it holds, smaller or larger.
    fit: bool = False


class CopyOut(BaseModel):
    id: str
    saved_at: str
    # Whose call it came before: the person's name, or null once they are gone.
    by: str | None
    # `key`: before an API key changed people's work; `restore`: before a restore.
    reason: Reason
    elements: int


class CopyList(BaseModel):
    copies: list[CopyOut]


class GanttIn(BaseModel):
    id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9-]{1,64}$")
    title: str = Field(default="", max_length=200)
    start: date
    end: date
    scale: Literal["day", "week", "month", "quarter"] = "week"
    x: float | None = Field(default=None, ge=-1_000_000, le=1_000_000)
    y: float | None = Field(default=None, ge=-1_000_000, le=1_000_000)


class StepsIn(BaseModel):
    steps: list[Step] = Field(min_length=1, max_length=MAX_STEPS)


class Made(BaseModel):
    step: int
    id: str


class GanttWritten(BaseModel):
    # The rows the steps touched, as read_gantt reads them, in plan order.
    rows: list[RowOut]
    created: list[Made]
    # Rows that follow their task and stayed on its dates when their branch shifted.
    kept: list[str]


class Written(BaseModel):
    elements: list[Element]
    # Ids among them that this call made; the others were there already.
    created: list[str]


@router.post("", status_code=201)
def make_board(body: NewBoard, person: KeyPerson, key: Key, request: Request) -> Board:
    """A new empty board owned by the key's person. A retry after a lost answer may make a
    second board."""
    made = create_board(
        person,
        body.name,
        request.app.state.boards,
        board_limit(
            person.model_copy(update={"role": request.state.workspace_role}),
            request.app.state.board_limit,
        ),
    )
    key = request.app.state.api_keys.add_board(key, made.id)
    return boards_of(person, key, request, made.id)[0]


@router.patch("/{board_id}")
def rename(
    board_id: str, body: NewBoard, _: Writable, person: KeyPerson, key: Key, request: Request
) -> Board:
    """Renames a board the key may change; an editor may, as in the web app."""
    state = request.app.state
    rename_board(person, board_id, body.name, state.boards, state.live)
    return boards_of(person, key, request, board_id)[0]


@router.post("/{board_id}/elements")
def add_elements(board_id: str, body: AddIn, _: Writable, request: Request) -> Written:
    """Adds notes, text, shapes, frames, cards and arrows, all of them or none."""
    adds = [e if e.id else e.model_copy(update={"id": uuid.uuid4().hex}) for e in body.elements]
    cards = _cards(adds, request)
    adds, watches = _reminders(board_id, adds, cards, request)
    return _write(board_id, Batch(adds=adds, cards=cards, watches=watches), request)


@router.patch("/{board_id}/elements")
def change_elements(board_id: str, body: ChangeIn, _: Writable, request: Request) -> Written:
    """Moves, resizes and restyles any element; changes text and reminders the API added."""
    _not_past([c.at for c in body.changes])
    return _write(board_id, Batch(changes=body.changes), request)


@router.post("/{board_id}/elements/remove", status_code=204)
def remove_elements(board_id: str, body: RemoveIn, _: Writable, request: Request) -> Response:
    """Removes elements the API added. One that is gone already counts as removed."""
    _write(board_id, Batch(removes=body.ids), request, answer=False)
    return Response(status_code=204)


@router.post("/{board_id}/arrange")
def arrange(board_id: str, body: ArrangeIn, _: Writable, request: Request) -> Written:
    """Lays the named cards out as a grid or in columns by status, below what is on the board
    or in a frame that grows to hold them, or takes their size with `fit`. Nothing else
    moves."""
    frame_id = body.frame.id if body.frame else None
    new_frame = (uuid.uuid4().hex, body.frame.title) if body.frame and body.frame.title else None
    plan = Arrange(
        cards=body.cards,
        layout=body.layout,
        frame_id=frame_id,
        new_frame=new_frame,
        columns=body.columns,
        order=body.order,
        fit=body.fit,
        statuses=(
            _statuses(board_id, body.cards, request)
            if "status" in (body.layout, body.order)
            else {}
        ),
    )
    return _write(board_id, Batch(arrange=plan), request)


@router.get("/{board_id}/copies")
def list_copies(board_id: str, _: Writable, request: Request) -> CopyList:
    """Copies of the board tiko saved before a key with full access changed people's work, and
    before each restore, newest first."""
    return copy_list(board_id, request)


@router.post(
    "/{board_id}/copies/{copy_id}/restore",
    status_code=204,
    dependencies=[Depends(full_budget)],
)
def restore_copy(board_id: str, copy_id: str, _: Writable, request: Request) -> Response:
    """Puts the board back as the copy has it, for everyone at once. The board as it is now is
    saved first, so a restore can be undone the same way. Needs a key with full access."""
    restore(board_id, copy_id, request)
    return Response(status_code=204)


@router.post("/{board_id}/modules", status_code=201)
def add_gantt(board_id: str, body: GanttIn, _: Writable, request: Request) -> Written:
    """An empty Gantt on the board, at x/y or below what is there, as the web app adds one."""
    new = NewGantt(id=body.id or uuid.uuid4().hex, **body.model_dump(exclude={"id"}))
    return _write(board_id, Batch(new_gantt=new), request)


@router.patch("/{board_id}/modules/{module_id}")
def change_gantt(
    board_id: str,
    module_id: str,
    body: StepsIn,
    _: Writable,
    person: KeyPerson,
    key: Key,
    request: Request,
) -> GanttWritten:
    """Steps on a Gantt, applied one after another and all or none. A Gantt a key added is its
    own; a person's needs full access. tiko saves the board before every change to a plan."""
    for step in body.steps:
        if step.op == "add_row" and step.id is None:
            step.id = uuid.uuid4().hex
    asked = [(i, s.task) for i, s in enumerate(body.steps) if s.task is not None]
    found = _tasks([ref for _, ref in asked], request) if asked else []
    tasks = {
        index: Resolved(key=card.key, source=card.source, span=_span(task))
        for (index, _), (card, task) in zip(asked, found, strict=True)
    }
    plan = planning.read(person, key, request)
    fields = {f.id for f in plan.fields if not f.archived} if plan.enabled else None
    context = Context(today=date.today(), tasks=tasks, fields=fields)
    batch = Batch(gantt=GanttCall(module=module_id, steps=body.steps, context=context))
    applied = _applied(board_id, batch, request)
    result = applied.gantt
    assert result is not None
    return GanttWritten(
        rows=_rows(result.content, result.touched, request),
        created=[Made(step=i, id=made) for i, made in sorted(result.created.items())],
        kept=result.kept,
    )


def _span(task: Task) -> tuple[date, date] | None:
    tracked = tracker_span(task)
    return (tracked.start, tracked.end) if tracked else None


def _rows(content: dict, touched: list[str], request: Request) -> list[RowOut]:
    tracker = deps.tracker(request)
    refs = [task_ref(r.get("source") or tracker, r["key"]) for r in content["rows"] if r.get("key")]
    tasks = deps.snapshots(request).get_many(refs)
    view = request.app.state.planning.view()
    names = None
    if view.enabled:
        names = Names(
            types={t.id: t.name for t in view.types},
            people={p.id: p.name for p in view.people},
            fields={f.id: f.name for f in view.fields},
        )
    wanted = set(touched)
    return [r for r in gantt_view(content, tasks, tracker, names).rows if r.id in wanted]


def copy_list(board_id: str, request: Request) -> CopyList:
    found = request.app.state.copies.list(board_id)
    return CopyList(
        copies=[
            CopyOut(
                id=c.id, saved_at=c.saved_at, by=c.by_name, reason=c.reason, elements=c.elements
            )
            for c in found
        ]
    )


def restore(board_id: str, copy_id: str, request: Request) -> None:
    if request.app.state.copies.get(board_id, copy_id) is None:
        raise NotFound("copy not found")
    person = deps.current_person(request)
    request.app.state.live.apply(board_id, Batch(restore=copy_id, by=person.id))


def _write(board_id: str, batch: Batch, request: Request, answer: bool = True) -> Written:
    applied = _applied(board_id, batch, request)
    if not answer:
        return Written(elements=[], created=[])
    return _answer(board_id, applied, request)


def _applied(board_id: str, batch: Batch, request: Request) -> Applied:
    state = request.app.state
    person = deps.current_person(request)
    elements = state.api_elements
    made = elements.of_board(board_id)
    batch.mine = [element_id for element_id, owner in made.items() if owner == person.id]
    batch.full, batch.by = full(request), person.id
    try:
        applied = state.live.apply(board_id, batch)
    except NotApiElement as error:
        if deps_key_full(request):
            raise NotApiElement(
                f"{error.message} Your admin does not let keys change everyone's work now."
            ) from error
        raise
    # Rows only for what the board took: a row written ahead would make an element the caller's
    # for a moment, even a person's. A crash between leaves an element counted as a person's.
    now = datetime.now(UTC).isoformat(timespec="seconds")
    elements.add(board_id, applied.created, person.id, now)
    elements.remove(board_id, applied.removed)
    return applied


def deps_key_full(request: Request) -> bool:
    """A key made with full access that the workspace no longer allows."""
    return request.state.api_key.scope == "full" and not full(request)


def _answer(board_id: str, applied: Applied, request: Request) -> Written:
    found = {e.id: e for e in shape(board_id, request, refresh=False).elements()}
    ids = list(dict.fromkeys(applied.ids))
    return Written(elements=[found[i] for i in ids if i in found], created=applied.created)


def _cards(adds: list[NewElement], request: Request) -> dict[str, CardRef]:
    """Each card's task, asked of its tracker once per tracker; a task that is not there
    stops the whole call."""
    wanted = [(e.id, e.ref) for e in adds if e.kind == "card"]
    if not wanted:
        return {}
    found = _tasks([ref or "" for _, ref in wanted], request)
    return {element_id: card for (element_id, _), (card, _) in zip(wanted, found, strict=True)}


def _tasks(refs: list[str], request: Request) -> list[tuple[CardRef, Task]]:
    """Each ref's task, asked of its tracker once per tracker and kept as a snapshot; a task
    that is not there stops the whole call."""
    if len(refs) > MAX_CARDS:
        raise ValidationFailed(f"At most {MAX_CARDS} cards a call.")
    search_budget(request)
    providers = deps.providers(request)
    tracker = deps.tracker(request)
    cards = [
        CardRef(source=source, key=key)
        for source, key in (
            _parse(ref, providers, tracker, deps.prefix_choice(request)) for ref in refs
        )
    ]
    snapshots = deps.snapshots(request)
    polled: dict[tuple[str, str], Task] = {}
    for source in {card.source for card in cards}:
        keys = sorted({c.key for c in cards if c.source == source})
        tasks = {task.key: task for task in providers[source].poll(keys)}
        missing = [k for k in keys if k not in tasks or tasks[k].state == "not_found"]
        if missing:
            raise TaskNotFound(f"{source} has no task {missing[0]} that you can see.")
        snapshots.put_many(list(tasks.values()))
        polled |= {(source, k): t for k, t in tasks.items()}
    return [(card, polled[(card.source, card.key)]) for card in cards]


def _not_past(moments: list[datetime | None]) -> None:
    now = datetime.now(UTC)
    if any(at is not None and at <= now for at in moments):
        raise ValidationFailed("A reminder cannot go off in the past.")


def _reminders(
    board_id: str, adds: list[NewElement], cards: dict[str, CardRef], request: Request
) -> tuple[list[NewElement], dict[str, Watch]]:
    """Status reminders find their card, on the board or added in this call, and the status
    to wait on: given, or the task's status now."""
    timers = [e for e in adds if e.kind == "timer"]
    _not_past([e.at for e in timers])
    watching = [e for e in timers if e.at is None]
    if not watching:
        return adds, {}
    tracker = deps.tracker(request)
    record = request.app.state.boards.get(board_id)
    shown = {
        node.id: (node.data.source, node.data.key)
        for node in (record.doc.nodes if record else [])
        if node.type == "task_card"
    }
    shown |= {element_id: (card.source, card.key) for element_id, card in cards.items()}
    placed: dict[str, NewElement] = {}
    watches: dict[str, Watch] = {}
    for element in watching:
        card_id = element.on
        if card_id is None:
            source, key = _parse(
                element.ref or "", deps.providers(request), tracker, deps.prefix_choice(request)
            )
            matches = [i for i, (s, k) in shown.items() if (s or tracker, k) == (source, key)]
            if len(matches) != 1:
                which = "no card" if not matches else "several cards"
                raise ValidationFailed(f"{element.id}: {which} of {key} on the board; give on.")
            card_id = matches[0]
        if card_id not in shown:
            raise ValidationFailed(f"{element.id}: a status reminder sits on a task card.")
        source, key = shown[card_id]
        if element.ref and element.on is not None:
            wanted = _parse(
                element.ref, deps.providers(request), tracker, deps.prefix_choice(request)
            )
            if wanted != (source or tracker, key):
                raise ValidationFailed(f"{element.id}: card {card_id} does not show {element.ref}.")
        status = element.status or _status_now(source or tracker, key, request)
        watches[element.id or ""] = Watch(key=key, source=source, status=status)
        placed[element.id or ""] = element.model_copy(update={"on": card_id})
    return [placed.get(e.id or "", e) for e in adds], watches


def _status_now(source: str, key: str, request: Request) -> str:
    search_budget(request)
    provider = deps.providers(request).get(source)
    if provider is None:
        raise InvalidRef(f"This tiko does not read {source}; give status.")
    found = [t for t in provider.poll([key]) if t.state == "ok"]
    if not found:
        raise TaskNotFound(f"{source} has no task {key} that you can read.")
    deps.snapshots(request).put_many(found)
    return found[0].status_name


def _parse(
    ref: str,
    providers: dict,
    tracker: str,
    chosen: Callable[[str], str | None] | None = None,
) -> tuple[str, str]:
    if match := _EXPLICIT.match(ref.strip()):
        source, key = match.group(1), match.group(2)
        # `linear:ENG-12` names the tracker of a bare key; the workspace is the person's own.
        if source in providers and not valid_key(source, key):
            source, key = route_ref(key, providers, tracker, source=source)
    else:
        source, key = route_ref(ref, providers, tracker, chosen)
    if source not in providers:
        raise InvalidRef(f"This tiko does not read {source}.")
    if not valid_key(source, key):
        raise InvalidRef(f"{ref} is not a {source} task.")
    return source, key


def _statuses(board_id: str, cards: list[str], request: Request) -> dict[str, tuple[int, str]]:
    record = request.app.state.boards.get(board_id)
    if record is None:
        return {}
    tracker = deps.tracker(request)
    refs = {
        node.id: task_ref(node.data.source or tracker, node.data.key)
        for node in record.doc.nodes
        if node.id in cards and node.type == "task_card"
    }
    tasks = deps.snapshots(request).get_many(list(refs.values()))
    return {
        card_id: (_RANK.get(tasks[ref].status_category, 9), tasks[ref].status_name)
        for card_id, ref in refs.items()
        if ref in tasks
    }
