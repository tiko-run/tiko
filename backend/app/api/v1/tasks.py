from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, model_validator

from app.api import deps
from app.api.v1.deps import read_budget, search_budget
from app.domain.caldav import MAX_LIST_TASKS
from app.domain.errors import JiraNotConfigured, ValidationFailed
from app.domain.tasks import MAX_SEARCH, Task, search_tasks

router = APIRouter(
    prefix="/tasks", tags=["tasks"], dependencies=[Depends(read_budget), Depends(search_budget)]
)


class SearchIn(BaseModel):
    source: Literal["jira", "demo", "caldav", "github"]
    # JQL for Jira; words of the title for CalDAV; quoted words for the demo tasks.
    query: str = Field(default="", max_length=2000)
    # CalDAV only: include done tasks.
    done: bool = False
    limit: int = Field(default=50, ge=1, le=MAX_SEARCH)

    @model_validator(mode="after")
    def _limits(self) -> "SearchIn":
        if self.source == "caldav" and self.limit > MAX_LIST_TASKS:
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
    total: int
    # True when `total` is the tracker's estimate, not an exact count.
    estimated: bool = False


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
    if body.source == "github":
        raise ValidationFailed("GitHub has no search here: add a card by its key or link.")
    if body.source == "caldav":
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
        tasks=[_found(t) for t in result.tasks], total=result.total, estimated=result.estimated
    )
