"""A gantt module in the public shape of API v1 (spec 047): the plan as the web app draws it,
with following rows on their tasks' current dates and Planning ids named."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_serializer

from app.domain.api_view import TaskOut, public_task
from app.domain.errors import NotFound
from app.domain.modules.gantt import GanttContent, Row
from app.domain.tasks import Task, task_ref

# A side the tracker has no date for is drawn this many days from the other (follow.ts).
GUESS_DAYS = 6
# The most rows an MCP answer holds; more are folded to their top level.
CAP = 100

Side = Literal["start", "end"]
Source = Literal["tracker", "stored", "own"]


def _without_none(data: dict[str, Any], keep: tuple[str, ...] = ()) -> dict[str, Any]:
    return {k: v for k, v in data.items() if v is not None or k in keep}


class Named(BaseModel):
    id: str
    name: str | None


class Span(BaseModel):
    start: date
    end: date


class Tracked(BaseModel):
    start: date
    end: date
    guessed: Side | None = None

    @model_serializer(mode="wrap")
    def _absent(self, handler):
        return _without_none(handler(self))


class StageOut(BaseModel):
    id: str
    type: Named
    start: date
    end: date
    people: list[Named]


class ValueOut(BaseModel):
    field: Named
    value: str
    inherited: bool


class RowOut(BaseModel):
    id: str
    parent: str | None = None
    depth: int
    key: str | None = None
    source: str | None = None
    title: str | None = None
    task: TaskOut | None = None
    start: date
    end: date
    dates: Source
    guessed: Side | None = None
    tracker: Tracked | None = None
    span: Span | None = None
    stages: list[StageOut] | None = None
    values: list[ValueOut] | None = None
    # Rows under this one, only in an answer folded to its top level.
    holds: int | None = None

    @model_serializer(mode="wrap")
    def _absent(self, handler):
        # A task row says `task: null` when the person cannot read it; elsewhere absent.
        return _without_none(handler(self), ("task",) if self.key else ())


class MilestoneOut(BaseModel):
    id: str
    date: date
    title: str


class LinkOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    from_: str = Field(alias="from")
    to: str


class GanttOut(BaseModel):
    start: date
    end: date
    scale: str
    rows: list[RowOut]
    milestones: list[MilestoneOut]
    links: list[LinkOut]


@dataclass
class Names:
    """Planning ids to names; archived ones too, so old stages keep theirs."""

    types: dict[str, str] = field(default_factory=dict)
    people: dict[str, str] = field(default_factory=dict)
    fields: dict[str, str] = field(default_factory=dict)


def tracker_span(task: Task | None) -> Tracked | None:
    """The task's dates with a missing side guessed; None when the tracker has none."""
    if task is None or task.state != "ok":
        return None
    week = timedelta(days=GUESS_DAYS)
    if task.start and task.due:
        return Tracked(start=task.start, end=task.due)
    if task.due:
        return Tracked(start=task.due - week, end=task.due, guessed="start")
    if task.start:
        return Tracked(start=task.start, end=task.start + week, guessed="end")
    return None


def follows(row: Row, parent: bool) -> bool:
    """A parent spans its children and a row with stages keeps them: neither follows."""
    return bool(row.follow) and not parent and not row.stages


def drift(task: Task | None, shown: Span) -> Tracked | None:
    """The tracker's dates where they differ from what the row shows; a guessed side is not
    compared."""
    tracked = tracker_span(task)
    if tracked is None:
        return None
    start = tracked.guessed != "start" and tracked.start != shown.start
    end = tracked.guessed != "end" and tracked.end != shown.end
    return tracked if start or end else None


def _subtree_end(depths: list[int], index: int) -> int:
    end = index + 1
    while end < len(depths) and depths[end] > depths[index]:
        end += 1
    return end


def gantt_view(
    content: Mapping[str, Any],
    tasks: Mapping[str, Task],
    default_source: str,
    names: Names | None,
) -> GanttOut:
    """`names` is None with Planning off: rows then carry no stages and no values."""
    gantt = GanttContent.model_validate(content)
    rows = gantt.rows
    parents = {row.parent for row in rows if row.parent}
    by_id = {row.id: row for row in rows}

    def task_of(row: Row) -> Task | None:
        if row.key is None:
            return None
        return tasks.get(task_ref(row.source or default_source, row.key))

    depths: list[int] = []
    depth_of: dict[str, int] = {}
    for row in rows:
        depth_of[row.id] = depth_of[row.parent] + 1 if row.parent in depth_of else 0
        depths.append(depth_of[row.id])

    shown: list[tuple[date, date, Source, Side | None]] = []
    for row in rows:
        parent = row.id in parents
        if not follows(row, parent):
            shown.append((row.start, row.end, "own", None))
            continue
        tracked = tracker_span(task_of(row))
        if tracked is None:
            shown.append((row.start, row.end, "stored", None))
        else:
            shown.append((tracked.start, tracked.end, "tracker", tracked.guessed))

    def value(row: Row, field_id: str) -> tuple[str, bool] | None:
        at: Row | None = row
        while at is not None:
            found = (at.values or {}).get(field_id)
            if found:
                return found, at is not row
            at = by_id.get(at.parent) if at.parent else None
        return None

    def named(table: dict[str, str], item: str) -> Named:
        return Named(id=item, name=table.get(item))

    out: list[RowOut] = []
    for index, row in enumerate(rows):
        start, end, source, guessed = shown[index]
        parent = row.id in parents
        task = task_of(row)
        span = None
        if parent:
            branch = shown[index : _subtree_end(depths, index)]
            span = Span(start=min(s[0] for s in branch), end=max(s[1] for s in branch))
        off = None
        if row.key and not follows(row, parent):
            off = drift(task, span or Span(start=start, end=end))
        stages = values = None
        if names is not None:
            if not parent:
                stages = [
                    StageOut(
                        id=stage.id,
                        type=named(names.types, stage.type),
                        start=stage.start,
                        end=stage.end,
                        people=[named(names.people, person) for person in stage.people],
                    )
                    for stage in row.stages or []
                ]
            values = []
            for field_id in gantt.columns or []:
                found = value(row, field_id)
                if found:
                    values.append(
                        ValueOut(
                            field=named(names.fields, field_id),
                            value=found[0],
                            inherited=found[1],
                        )
                    )
        out.append(
            RowOut(
                id=row.id,
                parent=row.parent,
                depth=depths[index],
                key=row.key,
                source=(row.source or default_source) if row.key else None,
                title=None if row.key else row.title,
                task=public_task(task) if row.key else None,
                start=start,
                end=end,
                dates=source,
                guessed=guessed,
                tracker=off,
                span=span,
                stages=stages,
                values=values or None,
            )
        )
    return GanttOut(
        start=gantt.start,
        end=gantt.end,
        scale=gantt.scale,
        rows=out,
        milestones=[MilestoneOut(id=m.id, date=m.date, title=m.title) for m in gantt.milestones],
        links=[LinkOut(from_=link.from_, to=link.to) for link in gantt.links],
    )


def _bar(row: RowOut) -> Span:
    return row.span or Span(start=row.start, end=row.end)


def narrow(
    rows: list[RowOut],
    branch: str | None = None,
    start: date | None = None,
    end: date | None = None,
    cap: int = CAP,
) -> tuple[list[RowOut], str | None]:
    """Rows of one branch, or whose bars touch a window (with their ancestors); folded to the
    top level of what remains when that is more than `cap`, with a note on how to narrow."""
    kept = rows
    if branch is not None:
        index = next((i for i, row in enumerate(kept) if row.id == branch), None)
        if index is None:
            raise NotFound("row not found")
        kept = kept[index : _subtree_end([row.depth for row in kept], index)]
    if start is not None or end is not None:
        low, high = start or date.min, end or date.max
        by_id = {row.id: row for row in kept}
        wanted: set[str] = set()
        for row in kept:
            bar = _bar(row)
            if bar.start <= high and bar.end >= low:
                at: RowOut | None = row
                while at is not None and at.id not in wanted:
                    wanted.add(at.id)
                    at = by_id.get(at.parent) if at.parent else None
        kept = [row for row in kept if row.id in wanted]
    if len(kept) <= cap:
        return kept, None
    top = min(row.depth for row in kept)
    depths = [row.depth for row in kept]
    folded = [
        row.model_copy(update={"holds": _subtree_end(depths, i) - i - 1})
        for i, row in enumerate(kept)
        if row.depth == top
    ]
    note = (
        f"{len(kept)} rows are too many for one answer; these are the top ones. Pass branch "
        "with a row id, or start and end dates, to read the rows under them."
    )
    return folded, note
