import re
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field, model_validator

from app.api import deps
from app.api.v1.boards import Board, boards_of, shape
from app.api.v1.deps import Key, KeyPerson, Writable, search_budget, write_budget
from app.domain.api_view import Element
from app.domain.batch import (
    MAX_CARDS,
    MAX_ELEMENTS,
    Applied,
    Arrange,
    Batch,
    CardRef,
    Change,
    NewElement,
    Watch,
)
from app.domain.boards import BoardName, create_board, rename_board
from app.domain.demo import board_limit
from app.domain.errors import InvalidRef, TaskNotFound, ValidationFailed
from app.domain.tasks import GITHUB, github_key, parse_ref, task_ref, valid_key

router = APIRouter(prefix="/boards", tags=["writing"], dependencies=[Depends(write_budget)])

# A card named by its tracker outright: CalDAV tasks have neither a short key nor a link.
_EXPLICIT = re.compile(r"^(jira|github|caldav|demo):(.+)$")
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
    or in a frame that grows to hold them. Nothing else moves."""
    frame_id = body.frame.id if body.frame else None
    new_frame = (uuid.uuid4().hex, body.frame.title) if body.frame and body.frame.title else None
    plan = Arrange(
        cards=body.cards,
        layout=body.layout,
        frame_id=frame_id,
        new_frame=new_frame,
        statuses=_statuses(board_id, body.cards, request) if body.layout == "status" else {},
    )
    return _write(board_id, Batch(arrange=plan), request)


def _write(board_id: str, batch: Batch, request: Request, answer: bool = True) -> Written:
    state = request.app.state
    person = deps.current_person(request)
    elements = state.api_elements
    made = elements.of_board(board_id)
    batch.mine = [element_id for element_id, owner in made.items() if owner == person.id]
    applied = state.live.apply(board_id, batch)
    # Rows only for what the board took: a row written ahead would make an element the caller's
    # for a moment, even a person's. A crash between leaves an element counted as a person's.
    now = datetime.now(UTC).isoformat(timespec="seconds")
    elements.add(board_id, applied.created, person.id, now)
    elements.remove(board_id, applied.removed)
    if not answer:
        return Written(elements=[], created=[])
    return _answer(board_id, applied, request)


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
    if len(wanted) > MAX_CARDS:
        raise ValidationFailed(f"At most {MAX_CARDS} cards a call.")
    search_budget(request)
    providers = deps.providers(request)
    tracker = deps.tracker(request)
    found: dict[str, CardRef] = {}
    for element_id, ref in wanted:
        source, key = _parse(ref or "", providers, tracker)
        found[element_id] = CardRef(source=source, key=key)
    snapshots = deps.snapshots(request)
    for source in {card.source for card in found.values()}:
        keys = sorted({c.key for c in found.values() if c.source == source})
        tasks = {task.key: task for task in providers[source].poll(keys)}
        missing = [k for k in keys if k not in tasks or tasks[k].state == "not_found"]
        if missing:
            raise TaskNotFound(f"{source} has no task {missing[0]} that you can see.")
        snapshots.put_many(list(tasks.values()))
    return found


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
            source, key = _parse(element.ref or "", deps.providers(request), tracker)
            matches = [i for i, (s, k) in shown.items() if (s or tracker, k) == (source, key)]
            if len(matches) != 1:
                which = "no card" if not matches else "several cards"
                raise ValidationFailed(f"{element.id}: {which} of {key} on the board; give on.")
            card_id = matches[0]
        if card_id not in shown:
            raise ValidationFailed(f"{element.id}: a status reminder sits on a task card.")
        source, key = shown[card_id]
        if element.ref and element.on is not None:
            wanted = _parse(element.ref, deps.providers(request), tracker)
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


def _parse(ref: str, providers: dict, tracker: str) -> tuple[str, str]:
    if match := _EXPLICIT.match(ref.strip()):
        source, key = match.group(1), match.group(2)
    elif key := github_key(ref):
        source = GITHUB
    else:
        source = tracker
        if source not in providers:
            raise InvalidRef(f"This tiko does not read {source}.")
        key = parse_ref(ref, providers[source].base_host)
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
