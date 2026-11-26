"""Steps an API key takes on a Gantt plan (spec 056), applied to its content one by one.

`apply` is pure: given the plan and what the route resolved (tasks, Planning ids, today), it
returns the plan the steps leave, or raises naming the step. After every step it runs the clean-up
the web app runs on every change (`GanttModule.tsx`: detachEdited, fitLeaves, syncDone), and the
module's own validation.
"""

from datetime import date, timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.domain.errors import ValidationFailed
from app.domain.modules import validate_module
from app.domain.modules.gantt import MAX_VALUES, FieldId, ItemId, Title, Value

MAX_STEPS = 200
MAX_ROWS = 200
NEW_DAYS = 6

Op = Literal["add_row", "update_row", "move_row", "remove_row", "set_range"]
_FIELDS: dict[str, set[str]] = {
    "add_row": {"id", "title", "task", "parent", "after", "start", "end", "follow", "done"},
    "update_row": {"id", "title", "task", "start", "end", "shift", "follow", "done", "values"},
    "move_row": {"id", "parent", "after"},
    "remove_row": {"id", "branch"},
    "set_range": {"start", "end", "scale"},
}
_NEEDS: dict[str, set[str]] = {
    "add_row": set(),
    "update_row": {"id"},
    "move_row": {"id"},
    "remove_row": {"id"},
    "set_range": set(),
}


class Step(BaseModel):
    """One step: an `op` and the fields that op takes."""

    op: Op
    id: ItemId | None = None
    title: Title | None = None
    # A task by key or link; the route resolves it to `Resolved` before the plan.
    task: str | None = Field(default=None, max_length=500)
    parent: str | None = Field(default=None, max_length=40)
    # A sibling to land after; null for first under the parent, left out for last.
    after: str | None = Field(default=None, max_length=40)
    start: date | None = None
    end: date | None = None
    shift: int | None = Field(default=None, ge=-1096, le=1096)
    follow: bool | None = None
    done: bool | None = None
    # Field id to its value; null clears it.
    values: dict[FieldId, Value | None] | None = Field(default=None, max_length=MAX_VALUES)
    branch: bool | None = None
    scale: Literal["day", "week", "month", "quarter"] | None = None

    @model_validator(mode="after")
    def _fits(self) -> "Step":
        given = self.model_fields_set - {"op"}
        extra = given - _FIELDS[self.op]
        if extra:
            raise ValueError(f"{self.op} takes no {', '.join(sorted(extra))}")
        missing = _NEEDS[self.op] - given
        if missing:
            raise ValueError(f"{self.op} needs {', '.join(sorted(missing))}")
        if self.op == "add_row" and (self.title is None) == (self.task is None):
            raise ValueError("add_row takes a title or a task")
        if self.op == "set_range" and not given:
            raise ValueError("set_range needs start, end or scale")
        return self


class Resolved(BaseModel):
    """A step's task as the tracker answered: its key, tracker and dates, if it has any."""

    key: str
    source: str
    span: tuple[date, date] | None = None


class Context(BaseModel):
    """What the route resolved for the steps; it crosses to the room's process with them."""

    today: date
    # By step index.
    tasks: dict[int, Resolved] = {}
    # Field ids this key may set values of; None when Planning is off.
    fields: set[str] | None = None


class Result(BaseModel):
    # Normalized as the board stores it.
    content: dict[str, Any]
    # Rows the steps touched, in plan order at the end.
    touched: list[str]
    # Step index to the id it made.
    created: dict[int, str]
    # Following rows a shift left on their tracker.
    kept: list[str]


class _Failed(Exception):
    pass


def _days(value: str) -> date:
    return date.fromisoformat(value)


def _iso(value: date) -> str:
    return value.isoformat()


class _Plan:
    def __init__(self, content: dict[str, Any], context: Context):
        self.content = {**content, "rows": [dict(r) for r in content.get("rows", [])]}
        self.content["links"] = list(content.get("links", []))
        self.context = context
        self.touched: set[str] = set()
        self.created: dict[int, str] = {}
        self.kept: list[str] = []

    @property
    def rows(self) -> list[dict[str, Any]]:
        return self.content["rows"]

    def _index(self, row_id: str, what: str = "row") -> int:
        for i, row in enumerate(self.rows):
            if row["id"] == row_id:
                return i
        raise _Failed(f"{what} {row_id} not found")

    def _depths(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for row in self.rows:
            parent = row.get("parent")
            out[row["id"]] = out.get(parent, -1) + 1 if parent else 0
        return out

    def _end(self, index: int) -> int:
        """Index just past the last descendant of rows[index]."""
        depth = self._depths()
        base = depth[self.rows[index]["id"]]
        end = index + 1
        while end < len(self.rows) and depth[self.rows[end]["id"]] > base:
            end += 1
        return end

    def _parents(self) -> set[str]:
        return {r["parent"] for r in self.rows if r.get("parent")}

    def _place(self, block: list[dict[str, Any]], parent: str | None, after: Any) -> None:
        """Puts a block (a row and its subtree) under `parent`: after a sibling, first (None) or
        last (...); a collapsed parent opens, as in the web app."""
        head = dict(block[0])
        head.pop("parent", None)
        if parent is not None:
            head["parent"] = parent
            at_parent = self._index(parent, "parent")
            if self.rows[at_parent].get("collapsed"):
                self.rows[at_parent] = {**self.rows[at_parent], "collapsed": False}
        block = [head, *block[1:]]
        if after is ...:
            at = self._end(self._index(parent, "parent")) if parent else len(self.rows)
        elif after is None:
            at = self._index(parent, "parent") + 1 if parent else 0
        else:
            sibling = self._index(after, "sibling")
            if self.rows[sibling].get("parent") != parent:
                raise _Failed(f"row {after} is not under {parent or 'the top level'}")
            at = self._end(sibling)
        self.rows[at:at] = block

    def _block(self, row_id: str) -> list[dict[str, Any]]:
        start = self._index(row_id)
        end = self._end(start)
        block = self.rows[start:end]
        del self.rows[start:end]
        return block

    def _planned(self, key: str, source: str) -> str | None:
        for row in self.rows:
            if row.get("key") == key and (not row.get("source") or row["source"] == source):
                return row["id"]
        return None

    def _new_span(self) -> tuple[date, date]:
        start, end = _days(self.content["start"]), _days(self.content["end"])
        today = self.context.today
        first = today if start <= today <= end else start
        return first, first + timedelta(days=NEW_DAYS)

    def add_row(self, index: int, step: Step) -> None:
        if len(self.rows) >= MAX_ROWS:
            raise _Failed(f"a plan holds at most {MAX_ROWS} rows")
        if step.id is None:
            raise _Failed("add_row needs an id")
        if any(r["id"] == step.id for r in self.rows):
            raise _Failed(f"row {step.id} already exists")
        row: dict[str, Any] = {"id": step.id, "title": step.title or ""}
        task = self.context.tasks.get(index) if step.task is not None else None
        if step.task is not None:
            if task is None:
                raise _Failed(f"task {step.task} not found")
            existing = self._planned(task.key, task.source)
            if existing:
                raise _Failed(f"{task.key} is already in this plan as row {existing}")
            if step.done is not None:
                raise _Failed("a task row takes done from its tracker")
            row.update(key=task.key, source=task.source)
            follow = step.follow is not False
            if follow and (step.start or step.end):
                raise _Failed("a task row follows its tracker's dates; set follow: false first")
            if follow:
                row["follow"] = True
        elif step.follow:
            raise _Failed("only a task row follows a tracker")
        span = task.span if task and row.get("follow") and task.span else self._new_span()
        start, end = step.start or span[0], step.end or span[1]
        row.update(start=_iso(start), end=_iso(end))
        if step.done:
            row["done"] = True
        self._place([row], step.parent, step.after if "after" in step.model_fields_set else ...)
        self.created[index] = step.id
        self.touched.add(step.id)

    def update_row(self, index: int, step: Step) -> None:
        assert step.id is not None
        at = self._index(step.id)
        row = dict(self.rows[at])
        parent = row["id"] in self._parents()
        leaf_stages = bool(row.get("stages")) and not parent
        following = bool(row.get("follow")) and not parent
        given = step.model_fields_set
        if "title" in given:
            if row.get("key"):
                raise _Failed("a task row reads its title from the tracker")
            row["title"] = step.title or ""
        if "task" in given:
            task = self.context.tasks.get(index)
            if row.get("key"):
                raise _Failed(f"row {step.id} already plans {row['key']}")
            if task is None:
                raise _Failed(f"task {step.task} not found")
            existing = self._planned(task.key, task.source)
            if existing:
                raise _Failed(f"{task.key} is already in this plan as row {existing}")
            row.update(key=task.key, source=task.source, follow=True)
            row.pop("done", None)
            following = not parent
            if task.span and following and not row.get("stages"):
                row.update(start=_iso(task.span[0]), end=_iso(task.span[1]))
        if "follow" in given:
            if not row.get("key"):
                raise _Failed("only a task row follows a tracker")
            if step.follow and row.get("stages"):
                raise _Failed("a row cut into stages keeps its own dates")
            if step.follow:
                row["follow"] = True
            else:
                row.pop("follow", None)
            following = bool(step.follow) and not parent
        if "done" in given:
            if row.get("key"):
                raise _Failed("a task row takes done from its tracker")
            if parent:
                raise _Failed("a parent's progress comes from its rows; tick them instead")
            if row.get("stages"):
                raise _Failed("a row with stages is done when its stages are")
            if step.done:
                row["done"] = True
            else:
                row.pop("done", None)
        if step.start is not None or step.end is not None:
            if following:
                raise _Failed("this row follows its tracker's dates; set follow: false first")
            if leaf_stages:
                raise _Failed("this row spans its stages; use shift or change the stages")
            start = step.start or _days(row["start"])
            end = step.end or _days(row["end"])
            if parent:
                inner = self.rows[at + 1 : self._end(at)]
                start = min([start, *(_days(r["start"]) for r in inner)])
                end = max([end, *(_days(r["end"]) for r in inner)])
            row.update(start=_iso(start), end=_iso(end))
        if "values" in given and step.values:
            self._values(row, step.values)
        self.rows[at] = row
        self.touched.add(row["id"])
        if step.shift:
            self._shift(at, step.shift)

    def _values(self, row: dict[str, Any], values: dict[str, str | None]) -> None:
        known = self.context.fields
        if known is None:
            raise _Failed("Planning is off, so rows have no fields")
        shown = set(self.content.get("columns") or [])
        out = dict(row.get("values") or {})
        for field_id, value in values.items():
            if field_id not in known:
                raise _Failed(f"field {field_id} not found")
            if field_id not in shown:
                raise _Failed(f"field {field_id} is not a column of this plan")
            if value is None:
                out.pop(field_id, None)
            else:
                out[field_id] = value
        if out:
            row["values"] = out
        else:
            row.pop("values", None)

    def _shift(self, at: int, days: int) -> None:
        parents = self._parents()
        moved = timedelta(days=days)
        for i in range(at, self._end(at)):
            row = dict(self.rows[i])
            if row.get("follow") and row["id"] not in parents:
                self.kept.append(row["id"])
                continue
            row["start"] = _iso(_days(row["start"]) + moved)
            row["end"] = _iso(_days(row["end"]) + moved)
            if row.get("stages"):
                row["stages"] = [
                    {
                        **s,
                        "start": _iso(_days(s["start"]) + moved),
                        "end": _iso(_days(s["end"]) + moved),
                    }
                    for s in row["stages"]
                ]
            self.rows[i] = row
            self.touched.add(row["id"])

    def move_row(self, _: int, step: Step) -> None:
        assert step.id is not None
        given = step.model_fields_set
        current = self.rows[self._index(step.id)].get("parent")
        parent = step.parent if "parent" in given else current
        block = self._block(step.id)
        if parent is not None and any(r["id"] == parent for r in block):
            raise _Failed(f"row {step.id} cannot go under its own branch")
        if step.after is not None and any(r["id"] == step.after for r in block):
            raise _Failed(f"row {step.id} cannot go after its own branch")
        self._place(block, parent, step.after if "after" in given else ...)
        self.touched.update(r["id"] for r in block)

    def remove_row(self, _: int, step: Step) -> None:
        assert step.id is not None
        at = self._index(step.id)
        row = self.rows[at]
        if step.branch:
            gone = {r["id"] for r in self._block(step.id)}
        else:
            gone = {row["id"]}
            del self.rows[at]
            for i, other in enumerate(self.rows):
                if other.get("parent") != row["id"]:
                    continue
                lifted = {k: v for k, v in other.items() if k != "parent"}
                if row.get("parent"):
                    lifted["parent"] = row["parent"]
                self.rows[i] = lifted
                self.touched.add(other["id"])
        self.content["links"] = [
            link
            for link in self.content["links"]
            if link["from"] not in gone and link["to"] not in gone
        ]
        self.touched -= gone

    def set_range(self, _: int, step: Step) -> None:
        if step.start is not None:
            self.content["start"] = _iso(step.start)
        if step.end is not None:
            self.content["end"] = _iso(step.end)
        if step.scale is not None:
            self.content["scale"] = step.scale

    def clean(self) -> None:
        """The web app's clean-up after every change: a row cut into stages stops following,
        a leaf spans its stages, a plain leaf with stages is done when they all are."""
        parents = self._parents()
        for i, row in enumerate(self.rows):
            if not row.get("stages"):
                continue
            row = dict(row)
            if row.get("follow"):
                row.pop("follow")
            if row["id"] not in parents:
                stages = row["stages"]
                row["start"], row["end"] = stages[0]["start"], stages[-1]["end"]
                if not row.get("key"):
                    if all(s.get("done") for s in stages):
                        row["done"] = True
                    else:
                        row.pop("done", None)
            self.rows[i] = row


def apply(content: dict[str, Any], steps: list[Step], context: Context) -> Result:
    """The plan the steps leave, or ValidationFailed naming the first step that fails."""
    if len(steps) > MAX_STEPS:
        raise ValidationFailed(f"a call takes at most {MAX_STEPS} steps")
    plan = _Plan(content, context)
    for index, step in enumerate(steps):
        try:
            getattr(plan, step.op)(index, step)
            plan.clean()
            stored = validate_module("gantt", plan.content)
        except _Failed as failed:
            raise ValidationFailed(f"step {index} ({step.op}): {failed}") from None
        except ValueError as invalid:
            reason = str(invalid).removeprefix("gantt: ")
            raise ValidationFailed(f"step {index} ({step.op}): {reason}") from None
    if not steps:
        stored = validate_module("gantt", plan.content)
    order = [r["id"] for r in plan.rows if r["id"] in plan.touched]
    return Result(content=stored, touched=order, created=plan.created, kept=plan.kept)
