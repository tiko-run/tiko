from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api import deps
from app.domain.caldav import CalDavSource, FindTasksIn, ListTasks
from app.domain.ports import SnapshotRepo, TaskProvider
from app.domain.sources import resolve_task
from app.domain.tasks import MAX_SEARCH, SOURCE_PATTERN, Task, search_tasks

router = APIRouter(prefix="/tasks", tags=["tasks"])


class ResolveIn(BaseModel):
    ref: str = Field(max_length=500)
    # The tracker a bare key belongs to, picked when two trackers know its prefix.
    source: str | None = Field(default=None, pattern=SOURCE_PATTERN)


class ResolveOut(BaseModel):
    task: Task


class SearchIn(BaseModel):
    jql: str = Field(min_length=1, max_length=2000)
    # 0 asks only for the match count, which also validates the query.
    limit: int = Field(default=50, ge=0, le=MAX_SEARCH)


class SearchOut(BaseModel):
    tasks: list[Task]
    total: int
    # True when `total` is the tracker's estimate, not an exact count.
    estimated: bool = False


@router.post("/search")
def search(
    body: SearchIn,
    provider: Annotated[TaskProvider, Depends(deps.provider)],
    snapshots: Annotated[SnapshotRepo, Depends(deps.snapshots)],
) -> SearchOut:
    found = search_tasks(body.jql, body.limit, provider, snapshots)
    return SearchOut(tasks=found.tasks, total=found.total, estimated=found.estimated)


@router.post("/resolve")
def resolve(
    body: ResolveIn,
    providers: Annotated[dict[str, TaskProvider], Depends(deps.providers)],
    tracker: Annotated[str, Depends(deps.tracker)],
    snapshots: Annotated[SnapshotRepo, Depends(deps.snapshots)],
    chosen: Annotated[Callable[[str], str | None], Depends(deps.prefix_choice)],
) -> ResolveOut:
    task = resolve_task(body.ref, providers, tracker, snapshots, chosen, body.source)
    return ResolveOut(task=task)


@router.post("/caldav")
def caldav_tasks(
    body: FindTasksIn,
    caldav: Annotated[CalDavSource, Depends(deps.caldav_source)],
    snapshots: Annotated[SnapshotRepo, Depends(deps.snapshots)],
) -> ListTasks:
    """The person's tasks matching a search, to pick cards from."""
    found = caldav.find_tasks(body.query, body.list_id, body.done, body.limit)
    snapshots.put_many(found.tasks)
    return found
