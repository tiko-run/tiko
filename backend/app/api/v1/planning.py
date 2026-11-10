"""Planning through API v1 (spec 047): the lists a gantt names, and a person's load."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, model_serializer

from app.api import deps
from app.api.v1.boards import boards_of
from app.api.v1.deps import Key, KeyPerson, read_budget
from app.domain.accounts import Person
from app.domain.api_gantt import Named
from app.domain.api_keys import KeyIdentity
from app.domain.boards import drawn_refs, working_ranges
from app.domain.errors import NotFound
from app.domain.planning import MAX_WEEKS, Planning, PlanningPerson, WorkloadWeek

router = APIRouter(prefix="/planning", tags=["planning"], dependencies=[Depends(read_budget)])


class Away(BaseModel):
    start: date
    end: date


class TypeOut(BaseModel):
    id: str
    name: str
    archived: bool


class PersonOut(BaseModel):
    id: str
    name: str
    teams: list[str]
    archived: bool
    off: list[Away]


class FieldOut(BaseModel):
    id: str
    name: str
    archived: bool


class PlanningOut(BaseModel):
    enabled: bool
    types: list[TypeOut] = []
    people: list[PersonOut] = []
    fields: list[FieldOut] = []
    days_off: list[date] = []

    @model_serializer(mode="wrap")
    def _off_says_only_that(self, handler):
        return handler(self) if self.enabled else {"enabled": False}


class StageLoad(BaseModel):
    # Null on a board the key does not reach: only the dates are kept.
    board: str | None
    board_name: str | None
    row: str | None
    type: Named | None
    start: date
    end: date


class WorkloadOut(BaseModel):
    person: Named
    weeks: list[WorkloadWeek]
    stages: list[StageLoad]


def _service(request: Request) -> Planning:
    return request.app.state.planning


def _person_out(person: PlanningPerson, today: date) -> PersonOut:
    return PersonOut(
        id=person.id,
        name=person.name,
        teams=person.teams,
        archived=person.archived,
        off=[Away(start=o.start, end=o.end) for o in person.off if o.end >= today],
    )


def read(person: Person, key: KeyIdentity, request: Request) -> PlanningOut:
    service = _service(request)
    if not service.enabled():
        return PlanningOut(enabled=False)
    today = date.today()
    if deps.api_keys(request).chosen(key) is None:
        found = service.view()
        types, people, fields, days = found.types, found.people, found.fields, found.daysOff
    else:
        type_ids: set[str] = set()
        person_ids: set[str] = set()
        field_ids: set[str] = set()
        ranges: list[tuple[date, date]] = []
        for board in boards_of(person, key, request):
            record = request.app.state.boards.get(board.id)
            if record is None:
                continue
            drawn = drawn_refs(record.doc)
            type_ids |= drawn[0]
            person_ids |= drawn[1]
            field_ids |= drawn[2]
            ranges += working_ranges(record.doc)
        found = service.for_board(type_ids, person_ids, field_ids, tuple(ranges))
        types, people, fields, days = found.types, found.people, found.fields, found.daysOff
    return PlanningOut(
        enabled=True,
        types=[TypeOut(id=t.id, name=t.name, archived=t.archived) for t in types],
        people=[_person_out(p, today) for p in people],
        fields=[FieldOut(id=f.id, name=f.name, archived=f.archived) for f in fields],
        days_off=[d for d in days if d >= today],
    )


@router.get("")
def read_planning(person: KeyPerson, key: Key, request: Request) -> PlanningOut:
    """Stage types, people with their time off, fields and days off. A key for chosen boards
    reads only what those boards' gantts use."""
    return read(person, key, request)


def workload(
    person_id: str,
    person: Person,
    key: KeyIdentity,
    request: Request,
    start: date | None = None,
    weeks: int = 12,
) -> WorkloadOut:
    service = _service(request)
    if not service.enabled():
        raise NotFound("Planning is off.")
    keys, members = deps.api_keys(request), deps.members(request)

    def can_open(board_id: str) -> bool:
        return keys.reaches(key, board_id) and members.role(person, board_id) is not None

    chosen = keys.chosen(key) is not None
    if chosen and not any(can_open(board) for board in service.boards_of(person_id)):
        raise NotFound("No such person on this key's boards.")
    load = service.workload(person_id, start or date.today(), weeks, can_open, only_open=chosen)
    plan = service.view()
    names = {t.id: t.name for t in plan.types}
    # Removed between the two reads: not found, as `workload` says for a missing person.
    who = next((p for p in plan.people if p.id == person_id), None)
    if who is None:
        raise NotFound("No such person.")
    return WorkloadOut(
        person=Named(id=who.id, name=who.name),
        weeks=load.weeks,
        stages=[
            StageLoad(
                board=s.board,
                board_name=s.boardName,
                row=s.row,
                type=Named(id=s.type, name=names.get(s.type)) if s.type else None,
                start=s.start,
                end=s.end,
            )
            for s in load.stages
        ],
    )


@router.get("/people/{person_id}/workload")
def read_workload(
    person_id: str,
    person: KeyPerson,
    key: Key,
    request: Request,
    start: Annotated[date | None, Query(alias="from")] = None,
    weeks: Annotated[int, Query(ge=1, le=MAX_WEEKS)] = 12,
) -> WorkloadOut:
    """A person's stages per week, from the Monday of `from`, as Settings shows them. A stage
    on a board the key does not reach keeps only its dates."""
    return workload(person_id, person, key, request, start, weeks)
