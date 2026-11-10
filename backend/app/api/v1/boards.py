from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from app.api import deps
from app.api.v1.deps import Key, KeyPerson, Viewable, board_url, read_budget
from app.domain.api_view import BoardShape, Outline, Page, page
from app.domain.boards import task_refs
from app.domain.errors import NotFound
from app.domain.members import BoardRole, effective_role

router = APIRouter(prefix="/boards", tags=["boards"], dependencies=[Depends(read_budget)])


class Board(BaseModel):
    id: str
    name: str
    role: BoardRole
    updated_at: str
    public: bool
    shared_with_everyone: bool
    url: str


class BoardList(BaseModel):
    boards: list[Board]


class BoardOutline(Outline):
    board: Board


class BoardPage(Page):
    board: Board


def _boards(person, key, request: Request, board_id: str | None = None) -> list[Board]:
    # `listing` alone, never `list_boards`: a read must not make the welcome board.
    boards = request.app.state.boards
    rows = boards.listing(person.id, board_id) if board_id else boards.listing(person.id)
    found = []
    for row in rows:
        role = effective_role(person, row.member_role, row.everyone_role)
        if role is None or (key.boards is not None and row.id not in key.boards):
            continue
        found.append(
            Board(
                id=row.id,
                name=row.name,
                role=role,
                updated_at=row.updated_at,
                public=row.public,
                shared_with_everyone=row.everyone_role is not None,
                url=board_url(request, row.id),
            )
        )
    return found


@router.get("")
def list_boards(person: KeyPerson, key: Key, request: Request) -> BoardList:
    """Every board the key reaches, newest change first."""
    boards = sorted(_boards(person, key, request), key=lambda b: b.updated_at, reverse=True)
    return BoardList(boards=boards)


@router.get("/{board_id}")
def read_board(
    board_id: str,
    _: Viewable,
    person: KeyPerson,
    key: Key,
    request: Request,
    frame: Annotated[str | None, Query(max_length=100)] = None,
    elements: Literal["all"] | None = None,
    after: Annotated[str | None, Query(max_length=100)] = None,
) -> BoardOutline | BoardPage:
    """An outline of the board, or its elements a page at a time: all of them, or one frame's."""
    found = _boards(person, key, request, board_id)
    if not found:
        raise NotFound("board not found")
    shape = _shape(board_id, request)
    if frame is not None:
        return BoardPage(board=found[0], **page(shape.in_frame(frame), after).model_dump())
    if elements == "all":
        return BoardPage(board=found[0], **page(shape.elements(), after).model_dump())
    return BoardOutline(board=found[0], **shape.outline().model_dump())


def _shape(board_id: str, request: Request) -> BoardShape:
    state = request.app.state
    record = state.boards.get(board_id)
    if record is None:
        raise NotFound("board not found")
    settings = state.settings
    tracker = deps.tracker(request)
    snapshots = deps.snapshots(request)
    owner = deps.owner(request)
    # Stamps first: the providers read the tokens after them, as on the board's own refresh.
    before = deps.token_stamps(request)
    state.refresher.refresh(
        board_id,
        settings.refresh_interval_s(),
        state.boards,
        snapshots,
        deps.providers(request),
        tracker,
        owner,
        before,
        lambda: settings.token_stamps(owner),
        max_age_s=settings.refresh_interval_s(),
    )
    tasks = snapshots.get_many(task_refs(record.doc, tracker))
    return BoardShape(record.doc, tasks, tracker)
