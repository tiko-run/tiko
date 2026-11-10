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


def boards_of(person, key, request: Request, board_id: str | None = None) -> list[Board]:
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
    boards = sorted(boards_of(person, key, request), key=lambda b: b.updated_at, reverse=True)
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
    found = boards_of(person, key, request, board_id)
    if not found:
        raise NotFound("board not found")
    board_shape = shape(board_id, request)
    if frame is not None:
        return BoardPage(board=found[0], **page(board_shape.in_frame(frame), after).model_dump())
    if elements == "all":
        return BoardPage(board=found[0], **page(board_shape.elements(), after).model_dump())
    return BoardOutline(board=found[0], **board_shape.outline().model_dump())


def editable(board_id: str, request: Request) -> set[str]:
    """Elements the caller's person added through the API."""
    me = deps.current_person(request).id
    made = request.app.state.api_elements.of_board(board_id)
    return {element_id for element_id, person_id in made.items() if person_id == me}


def shape(board_id: str, request: Request, refresh: bool = True) -> BoardShape:
    state = request.app.state
    record = state.boards.get(board_id)
    if record is None:
        raise NotFound("board not found")
    tracker = deps.tracker(request)
    snapshots = deps.snapshots(request)
    if refresh:
        _refresh(board_id, request)
    tasks = snapshots.get_many(task_refs(record.doc, tracker))
    return BoardShape(record.doc, tasks, tracker, editable(board_id, request))


def _refresh(board_id: str, request: Request) -> None:
    state = request.app.state
    settings = state.settings
    owner = deps.owner(request)
    tracker = deps.tracker(request)
    snapshots = deps.snapshots(request)
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
