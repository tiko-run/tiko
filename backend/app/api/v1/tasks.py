from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, model_validator

from app.api import deps
from app.api.v1.deps import read_budget, search_budget
from app.domain.caldav import MAX_LIST_TASKS, PICKER_TASKS
from app.domain.errors import JiraNotConfigured, ValidationFailed
from app.domain.sources import SOURCES
from app.domain.tasks import MAX_SEARCH, Task, search_tasks

router = APIRouter(
    prefix="/tasks", tags=["tasks"], dependencies=[Depends(read_budget), Depends(search_budget)]
)


class SearchIn(BaseModel):
    source: Literal[tuple(SOURCES)]
    # JQL for Jira and Linear (or a Linear view link); words of the title for CalDAV; quoted
    # words for the demo tasks.
    query: str = Field(default="", max_length=2000)
    # CalDAV only: include done tasks.
    done: bool = False
    # 50 by default, 20 for CalDAV, as its task picker shows.
    limit: int | None = Field(default=None, ge=1, le=MAX_SEARCH)

    @model_validator(mode="after")
    def _limits(self) -> "SearchIn":
        titles = SOURCES[self.source].search == "titles"
        if self.limit is None:
            self.limit = PICKER_TASKS if titles else 50
        if titles and self.limit > MAX_LIST_TASKS:
            raise ValueError(f"CalDAV returns at most {MAX_LIST_TASKS} tasks a call")
        return self


class FoundTask(BaseModel):
    source: str
    key: str
    title: str
    status: str
    assignee: str | None
    due: date | None
    url: str
    fetched_at: str


class SearchOut(BaseModel):
    tasks: list[FoundTask]
    # Linear gives no count past a page: then `total` counts what came back and `more` is true.
    total: int
    # True when `total` is the tracker's estimate, not an exact count.
    estimated: bool = False
    more: bool = False


def _found(task: Task) -> FoundTask:
    return FoundTask(
        source=task.source,
        key=task.key,
        title=task.summary,
        status=task.status_name,
        assignee=task.assignee_name,
        due=task.due,
        url=task.url,
        fetched_at=task.fetched_at,
    )


@router.post("/search")
def search(body: SearchIn, request: Request) -> SearchOut:
    """Tasks of one tracker, with the person's own credentials."""
    snapshots = deps.snapshots(request)
    source = SOURCES[body.source]
    if source.search is None:
        raise ValidationFailed(f"{source.name} has no search here: add a card by its key or link.")
    if source.search == "titles":
        found = deps.caldav_source(request).find_tasks(body.query, None, body.done, body.limit)
        snapshots.put_many(found.tasks)
        return SearchOut(tasks=[_found(t) for t in found.tasks], total=found.total)
    providers = deps.providers(request)
    if body.source not in providers:
        raise JiraNotConfigured("This tiko does not read Jira.")
    if not body.query.strip():
        raise ValidationFailed("query: enter a query")
    result = search_tasks(body.query, body.limit, providers[body.source], snapshots)
    return SearchOut(
        tasks=[_found(t) for t in result.tasks],
        total=len(result.tasks) if result.total is None else result.total,
        estimated=result.estimated,
        more=result.more,
    )
