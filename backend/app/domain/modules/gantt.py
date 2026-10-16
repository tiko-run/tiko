from datetime import date
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.tasks import SOURCE_PATTERN, valid_key

MAX_RANGE_DAYS = 1096
MAX_DEPTH = 5
# Mirrors MAX_STAGES in frontend/src/modules/gantt/stages.ts.
MAX_STAGES = 20
MAX_STAGE_PEOPLE = 10
MAX_VALUES = 20
MAX_COLUMNS = 6
MAX_FILTERS = 20
MAX_FILTER_VALUES = 20

ItemId = Annotated[str, Field(min_length=1, max_length=40)]
Title = Annotated[str, Field(max_length=200)]
FieldId = Annotated[str, Field(min_length=1, max_length=40)]
# An empty value is not stored: the row then shows its parent's.
Value = Annotated[str, Field(min_length=1, max_length=100)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Stage(_Strict):
    id: ItemId
    # Ids from /api/planning; one the instance does not know is kept, so a copied board opens.
    type: str = Field(max_length=40)
    start: date
    end: date
    people: list[Annotated[str, Field(max_length=40)]] = Field(
        default_factory=list, max_length=MAX_STAGE_PEOPLE
    )

    @model_validator(mode="after")
    def _rules(self) -> Self:
        if self.end < self.start:
            raise ValueError(f"stage {self.id} ends before it starts")
        if len(set(self.people)) != len(self.people):
            raise ValueError(f"stage {self.id} lists a person twice")
        return self


class Row(_Strict):
    id: ItemId
    key: str | None = None
    # The tracker of `key`; absent on rows saved before trackers could be mixed.
    source: str | None = Field(default=None, pattern=SOURCE_PATTERN)
    title: Title = ""
    start: date
    end: date
    parent: str | None = Field(default=None, max_length=40)
    collapsed: bool = False
    # Absent, not empty, on a row without stages, so content saved before them stays the same.
    stages: list[Stage] | None = Field(default=None, max_length=MAX_STAGES)
    # Field id to its value on this row; ids come from /api/planning.
    values: dict[FieldId, Value] | None = Field(default=None, max_length=MAX_VALUES)

    @model_validator(mode="after")
    def _dates(self) -> Self:
        if self.key is not None and not valid_key(self.source, self.key):
            raise ValueError("invalid issue key")
        if self.end < self.start:
            raise ValueError(f"row {self.id} ends before it starts")
        stages = self.stages or []
        for before, after in zip(stages, stages[1:], strict=False):
            if after.start <= before.end:
                raise ValueError(f"stages {before.id} and {after.id} overlap or are out of order")
        return self


class Milestone(_Strict):
    id: ItemId
    date: date
    title: Title = ""


class Link(_Strict):
    id: ItemId
    from_: str = Field(alias="from", max_length=40)
    to: str = Field(max_length=40)

    model_config = ConfigDict(extra="ignore", populate_by_name=True, serialize_by_alias=True)


class GanttContent(_Strict):
    start: date
    end: date
    scale: Literal["day", "week", "month", "quarter"] = "week"
    labelWidth: int = Field(default=160, ge=120, le=480)  # noqa: N815 - mirrors the frontend
    rows: list[Row] = Field(default_factory=list, max_length=200)
    milestones: list[Milestone] = Field(default_factory=list, max_length=100)
    links: list[Link] = Field(default_factory=list, max_length=400)
    # Where stage people show; absent means inline, so older content stays the same.
    people: Literal["inline", "below"] | None = None
    # Field ids shown as columns, in order.
    columns: list[FieldId] | None = Field(default=None, max_length=MAX_COLUMNS)
    # Field id or "person" to the values a row must match; a key with no values is not kept.
    filters: (
        dict[FieldId, Annotated[list[Value], Field(min_length=1, max_length=MAX_FILTER_VALUES)]]
        | None
    ) = Field(default=None, max_length=MAX_FILTERS)

    @model_validator(mode="after")
    def _rules(self) -> Self:
        if self.end < self.start:
            raise ValueError("end before start")
        if (self.end - self.start).days > MAX_RANGE_DAYS:
            raise ValueError("range over 3 years")
        for label, items in (("row", self.rows), ("milestone", self.milestones)):
            _unique(label, [item.id for item in items])
        _unique("stage", [stage.id for row in self.rows for stage in row.stages or []])
        _unique("link", [link.id for link in self.links])
        _unique("column", self.columns or [])
        _check_tree(self.rows)
        # A leaf's own dates are what links and Planning off draw, so they follow its stages.
        # A parent's stretch past its children, so its hidden stages are left as they were.
        parents = {row.parent for row in self.rows}
        for row in self.rows:
            if not row.stages or row.id in parents:
                continue
            if (row.start, row.end) != (row.stages[0].start, row.stages[-1].end):
                raise ValueError(f"row {row.id} must span its stages")
        rows = {row.id for row in self.rows}
        pairs: set[tuple[str, str]] = set()
        for link in self.links:
            if link.from_ not in rows or link.to not in rows:
                raise ValueError(f"link {link.id} points at a missing row")
            if link.from_ == link.to:
                raise ValueError(f"link {link.id} connects a row to itself")
            if (link.from_, link.to) in pairs:
                raise ValueError(f"link {link.id} duplicates another link")
            pairs.add((link.from_, link.to))
        return self


def _check_tree(rows: list[Row]) -> None:
    # Rows are in display order, so a parent is the row above or one of its ancestors.
    ancestors: list[str] = []
    for row in rows:
        if row.parent is None:
            ancestors = []
        elif row.parent in ancestors:
            ancestors = ancestors[: ancestors.index(row.parent) + 1]
        else:
            raise ValueError(f"row {row.id} must follow its parent {row.parent}")
        if len(ancestors) >= MAX_DEPTH:
            raise ValueError(f"row {row.id} is nested deeper than {MAX_DEPTH} levels")
        ancestors.append(row.id)


def _unique(label: str, ids: list[str]) -> None:
    seen: set[str] = set()
    for item_id in ids:
        if item_id in seen:
            raise ValueError(f"duplicate {label} id {item_id}")
        seen.add(item_id)


def task_keys(content: GanttContent) -> set[tuple[str | None, str]]:
    return {(row.source, row.key) for row in content.rows if row.key}
