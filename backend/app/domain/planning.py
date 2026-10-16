import secrets
from collections.abc import Callable
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.domain.errors import NotFound, ValidationFailed
from app.domain.ports import PlanningTypeRepo, SettingsRepo

ENABLED_KEY = "planning_enabled"

Hue = Literal[25, 60, 75, 150, 200, 250, 300, 340]
TypeName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]

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


class PlanningView(BaseModel):
    enabled: bool
    types: list[StageType] = []


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


class Planning:
    """Planning mode: the instance switch and what every Gantt on the instance shares."""

    def __init__(
        self,
        settings: SettingsRepo,
        types: PlanningTypeRepo,
        new_id: Callable[[], str] = lambda: secrets.token_hex(6),
    ) -> None:
        self._settings = settings
        self._types = types
        self._new_id = new_id

    def enabled(self) -> bool:
        return self._settings.get_all().get(ENABLED_KEY) == "1"

    def view(self) -> PlanningView:
        if not self.enabled():
            return PlanningView(enabled=False)
        return PlanningView(enabled=True, types=self._types.all())

    def set_enabled(self, on: bool) -> PlanningView:
        # The library starts with neutral defaults the first time; a team renames them.
        if on and not self._types.all():
            for name, hue in DEFAULT_TYPES:
                self._types.add(StageType(id=self._new_id(), name=name, hue=hue))
        self._settings.set_many({ENABLED_KEY: "1" if on else None})
        return self.view()

    def add_type(self, body: TypeIn) -> StageType:
        self._require_enabled()
        self._check_name(body.name, None)
        stage_type = StageType(id=self._new_id(), name=body.name, hue=body.hue)
        self._types.add(stage_type)
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
        return changed

    def _require_enabled(self) -> None:
        if not self.enabled():
            raise ValidationFailed("Planning is off.")

    def _check_name(self, name: str, own_id: str | None) -> None:
        taken = {t.name.casefold() for t in self._types.all() if not t.archived and t.id != own_id}
        if name.casefold() in taken:
            raise ValidationFailed(f"A stage type named {name} already exists.")
