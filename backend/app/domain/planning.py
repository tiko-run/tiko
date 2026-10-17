import json
import secrets
from collections.abc import Callable
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.domain.errors import NotFound, ValidationFailed
from app.domain.ports import (
    PlanningFieldRepo,
    PlanningPeopleRepo,
    PlanningTypeRepo,
    PlanningViewRepo,
    SettingsRepo,
)

ENABLED_KEY = "planning_enabled"
DAYS_OFF_KEY = "planning_days_off"

Hue = Literal[25, 60, 75, 150, 200, 250, 300, 340]
TypeName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
FieldName = TypeName
PersonName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Team = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
Teams = Annotated[list[Team], Field(max_length=10)]
Source = Literal["manual", "tracker"]

MAX_OFF = 100
MAX_FIELDS = 50
MAX_VIEWS = 100
MAX_DAYS_OFF = 400
# Mirror MAX_FILTERS and MAX_FILTER_VALUES in modules/gantt.py: a view is a Gantt's filters.
MAX_FILTERS = 20
MAX_FILTER_VALUES = 20
FilterKey = Annotated[str, Field(min_length=1, max_length=40)]
FilterValue = Annotated[str, Field(min_length=1, max_length=100)]
FilterValues = Annotated[list[FilterValue], Field(min_length=1, max_length=MAX_FILTER_VALUES)]
Filters = Annotated[dict[FilterKey, FilterValues], Field(max_length=MAX_FILTERS)]

DEFAULT_TYPES: tuple[tuple[str, Hue], ...] = (
    ("Discovery", 75),
    ("Design", 150),
    ("Build", 250),
    ("Review", 300),
    ("On hold", 25),
)


class StageType(BaseModel):
    id: str
    name: str
    hue: Hue
    archived: bool = False


class TimeOff(BaseModel):
    """Days a person is away; a reason is never kept, it could be health data."""

    id: str
    start: date
    end: date


class PlanningPerson(BaseModel):
    id: str
    name: str
    teams: list[str] = []
    source: Source
    archived: bool = False
    off: list[TimeOff] = []


class PlanningField(BaseModel):
    """A column a Gantt can show; Priority, Size and Team are standard and stay."""

    id: str
    name: str
    standard: bool = False
    archived: bool = False


class SavedView(BaseModel):
    """A named set of Gantt filters: field id or `person` to the values that match."""

    id: str
    name: str
    filters: dict[str, list[str]]


class PlanningView(BaseModel):
    enabled: bool
    types: list[StageType] = []
    people: list[PlanningPerson] = []
    fields: list[PlanningField] = []
    views: list[SavedView] = []
    daysOff: list[date] = []  # noqa: N815 - mirrors the contract


class BoardPlanning(BaseModel):
    """The types and people a board's Gantts use, for a guest who cannot read the directory."""

    types: list[StageType]
    people: list[PlanningPerson]
    fields: list[PlanningField]
    daysOff: list[date] = []  # noqa: N815 - mirrors the contract


class PlanningChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class TypeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: TypeName
    hue: Hue


class TypeChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: TypeName | None = None
    hue: Hue | None = None
    archived: bool | None = None


class PersonIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: PersonName
    teams: Teams = []
    source: Source = "manual"


class PersonChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: PersonName | None = None
    teams: Teams | None = None
    archived: bool | None = None


class TimeOffIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: date
    end: date

    @model_validator(mode="after")
    def _ordered(self) -> "TimeOffIn":
        if self.end < self.start:
            raise ValueError("Time off cannot end before it starts.")
        return self


class FieldIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: FieldName


class FieldChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: FieldName | None = None
    archived: bool | None = None


class ViewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: FieldName
    filters: Filters


class DaysOff(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dates: Annotated[list[date], Field(max_length=MAX_DAYS_OFF)]


class Planning:
    """Planning mode: the instance switch and what every Gantt on the instance shares."""

    def __init__(
        self,
        settings: SettingsRepo,
        types: PlanningTypeRepo,
        people: PlanningPeopleRepo,
        fields: PlanningFieldRepo,
        views: PlanningViewRepo,
        on_change: Callable[[], None] = lambda: None,
        new_id: Callable[[], str] = lambda: secrets.token_hex(6),
    ) -> None:
        self._settings = settings
        self._types = types
        self._people = people
        self._fields = fields
        self._views = views
        # Told after every write, so open Gantts reread the lists.
        self._on_change = on_change
        self._new_id = new_id

    def enabled(self) -> bool:
        return self._settings.get_all().get(ENABLED_KEY) == "1"

    def view(self) -> PlanningView:
        if not self.enabled():
            return PlanningView(enabled=False)
        return PlanningView(
            enabled=True,
            types=self._types.all(),
            people=self._people.all(),
            fields=self._fields.all(),
            views=self._views.all(),
            daysOff=self._days_off(),
        )

    def for_board(
        self,
        type_ids: set[str],
        person_ids: set[str],
        field_ids: set[str],
        ranges: tuple[tuple[date, date], ...] = (),
    ) -> BoardPlanning | None:
        if not self.enabled():
            return None
        return BoardPlanning(
            types=[t for t in self._types.all() if t.id in type_ids],
            people=[p for p in self._people.all() if p.id in person_ids],
            fields=[f for f in self._fields.all() if f.id in field_ids],
            daysOff=[d for d in self._days_off() if any(s <= d <= e for s, e in ranges)],
        )

    def set_enabled(self, on: bool) -> PlanningView:
        # The library starts with neutral defaults the first time; a team renames them.
        if on and not self._types.all():
            for name, hue in DEFAULT_TYPES:
                self._types.add(StageType(id=self._new_id(), name=name, hue=hue))
        self._settings.set_many({ENABLED_KEY: "1" if on else None})
        self._on_change()
        return self.view()

    def add_type(self, body: TypeIn) -> StageType:
        self._require_enabled()
        self._check_name(body.name, None)
        stage_type = StageType(id=self._new_id(), name=body.name, hue=body.hue)
        self._types.add(stage_type)
        self._on_change()
        return stage_type

    def change_type(self, type_id: str, body: TypeChange) -> StageType:
        self._require_enabled()
        current = next((t for t in self._types.all() if t.id == type_id), None)
        if current is None:
            raise NotFound("No such stage type.")
        changed = current.model_copy(update=body.model_dump(exclude_none=True))
        if not changed.archived:
            self._check_name(changed.name, type_id)
        self._types.update(changed)
        self._on_change()
        return changed

    def add_person(self, body: PersonIn) -> PlanningPerson:
        self._require_enabled()
        person = PlanningPerson(id=self._new_id(), **body.model_dump())
        person.teams = _unique(person.teams)
        self._people.add(person)
        self._on_change()
        return person

    def change_person(self, person_id: str, body: PersonChange) -> PlanningPerson:
        self._require_enabled()
        changed = self._person(person_id).model_copy(update=body.model_dump(exclude_none=True))
        changed.teams = _unique(changed.teams)
        self._people.update(changed)
        self._on_change()
        return changed

    def add_off(self, person_id: str, body: TimeOffIn) -> PlanningPerson:
        self._require_enabled()
        self._person(person_id)
        off = TimeOff(id=self._new_id(), **body.model_dump())
        if not self._people.add_off(person_id, off, MAX_OFF):
            raise ValidationFailed(f"A person can have up to {MAX_OFF} time off ranges.")
        self._on_change()
        return self._person(person_id)

    def remove_off(self, person_id: str, off_id: str) -> PlanningPerson:
        self._require_enabled()
        if not any(o.id == off_id for o in self._person(person_id).off):
            raise NotFound("No such time off.")
        self._people.remove_off(person_id, off_id)
        self._on_change()
        return self._person(person_id)

    def add_field(self, body: FieldIn) -> PlanningField:
        self._require_enabled()
        self._check_field_name(body.name, None)
        field = PlanningField(id=self._new_id(), name=body.name)
        if not self._fields.add(field, MAX_FIELDS):
            raise ValidationFailed(f"Planning can have up to {MAX_FIELDS} fields of your own.")
        self._on_change()
        return field

    def change_field(self, field_id: str, body: FieldChange) -> PlanningField:
        self._require_enabled()
        current = next((f for f in self._fields.all() if f.id == field_id), None)
        if current is None:
            raise NotFound("No such field.")
        if current.standard and body.archived:
            raise ValidationFailed(f"{current.name} is a standard field and stays.")
        changed = current.model_copy(update=body.model_dump(exclude_none=True))
        if not changed.archived:
            self._check_field_name(changed.name, field_id)
        self._fields.update(changed)
        self._on_change()
        return changed

    def add_view(self, body: ViewIn) -> SavedView:
        self._require_enabled()
        if body.name.casefold() in {v.name.casefold() for v in self._views.all()}:
            raise ValidationFailed(f"A view named {body.name} already exists.")
        view = SavedView(id=self._new_id(), name=body.name, filters=body.filters)
        if not self._views.add(view, MAX_VIEWS):
            if body.name.casefold() in {v.name.casefold() for v in self._views.all()}:
                raise ValidationFailed(f"A view named {body.name} already exists.")
            raise ValidationFailed(f"Planning can have up to {MAX_VIEWS} views.")
        self._on_change()
        return view

    def remove_view(self, view_id: str) -> None:
        self._require_enabled()
        if not self._views.remove(view_id):
            raise NotFound("No such view.")
        self._on_change()

    def set_days_off(self, body: DaysOff) -> DaysOff:
        self._require_enabled()
        dates = sorted(set(body.dates))
        self._settings.set_many({DAYS_OFF_KEY: json.dumps([d.isoformat() for d in dates])})
        self._on_change()
        return DaysOff(dates=dates)

    def _days_off(self) -> list[date]:
        stored = self._settings.get_all().get(DAYS_OFF_KEY)
        return [date.fromisoformat(d) for d in json.loads(stored)] if stored else []

    def _check_field_name(self, name: str, own_id: str | None) -> None:
        taken = {f.name.casefold() for f in self._fields.all() if not f.archived and f.id != own_id}
        if name.casefold() in taken:
            raise ValidationFailed(f"A field named {name} already exists.")

    def _person(self, person_id: str) -> PlanningPerson:
        person = next((p for p in self._people.all() if p.id == person_id), None)
        if person is None:
            raise NotFound("No such person.")
        return person

    def _require_enabled(self) -> None:
        if not self.enabled():
            raise ValidationFailed("Planning is off.")

    def _check_name(self, name: str, own_id: str | None) -> None:
        taken = {t.name.casefold() for t in self._types.all() if not t.archived and t.id != own_id}
        if name.casefold() in taken:
            raise ValidationFailed(f"A stage type named {name} already exists.")


def _unique(teams: list[str]) -> list[str]:
    seen: dict[str, str] = {}
    for team in teams:
        seen.setdefault(team.casefold(), team)
    return list(seen.values())
