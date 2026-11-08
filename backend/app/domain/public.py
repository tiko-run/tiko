import hashlib
import math
import secrets
import time
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel

from app.domain.accounts import Person, address_key
from app.domain.attempts import MemoryAttempts
from app.domain.boards import stage_refs, task_refs, working_ranges
from app.domain.errors import DomainError, Forbidden, NotFound, TooManyAttempts
from app.domain.live import room_key
from app.domain.members import Members
from app.domain.planning import BoardPlanning, Planning
from app.domain.ports import Attempts, BoardRepo, LiveBoards, TaskProvider
from app.domain.tasks import GITHUB, Task, github_url, now_iso, split_ref, task_ref

# Guests of one link share this budget, so one link going viral cannot starve the instance.
# The API sits behind proxies and cannot tell guests apart by address.
LINK_REQUESTS = 3000
LINK_WINDOW_S = 60.0
_LINK = "link"
# Each guest's own budget for the pictures of public boards. A browser asks for each picture
# about once, so a person opening big boards stays far below it; a script pulling pictures not.
PICTURE_REQUESTS = 1500
PICTURE_WINDOW_S = 60.0
_PICTURES = "pictures"


class PublicBoard(BaseModel):
    """A board as a guest gets it: content and tasks, nothing about its people."""

    # What the path of the link's socket ends with; says nothing else about the board.
    room: str
    name: str
    updated_at: str
    version: int
    doc: dict[str, Any]
    tasks: dict[str, Task]
    default_source: str
    refresh_interval_s: int
    # Absent with Planning off: the guest's Gantt draws one bar per row.
    planning: BoardPlanning | None = None


class PublicLinks:
    """A board's public link: whoever has it can view that board without signing in."""

    def __init__(
        self,
        boards: BoardRepo,
        allowed: Callable[[], bool],
        live: LiveBoards | None = None,
        clock: Callable[[], float] = time.time,
        attempts: Attempts | None = None,
    ) -> None:
        self._boards = boards
        self._allowed = allowed
        self._live = live
        self._clock = clock
        self._attempts = attempts or MemoryAttempts()

    def token(self, board_id: str) -> str | None:
        return self._boards.public_token(board_id)

    def set(self, board_id: str, public: bool) -> str | None:
        """Turns the link on or off. A link turned off is gone: turning it on makes a new one."""
        if not public:
            if old := self._boards.clear_public_token(board_id):
                self._attempts.drop(_LINK, old)
                if self._live:
                    self._live.end_public(board_id)
            return None
        if not self._allowed():
            raise Forbidden("Public links are switched off on this tiko.")
        token = self._boards.ensure_public_token(board_id, secrets.token_urlsafe(24))
        if token is None:
            raise NotFound("board not found")
        return token

    def find(self, token: str) -> tuple[str, int, str]:
        """The id, version and last change time of the board behind a link. A wrong link, a
        link turned off and an instance without public links all answer like a missing board."""
        found = self._boards.by_public_token(token) if self._allowed() else None
        if found is None:
            raise NotFound("board not found")
        now = self._clock()
        opened = self._attempts.spend(_LINK, token, LINK_REQUESTS, LINK_WINDOW_S, now)
        if opened is not None:
            wait = math.ceil(opened + LINK_WINDOW_S - now)
            raise TooManyAttempts("This board is busy. Try again in a moment.", max(wait, 1))
        return found

    def files_of(self, token: str, address: str) -> str:
        """The board behind a link, for its pictures. Outside the link's budget, since a board
        asks for many pictures at once, but within the guest's own one, counted by address."""
        # Kept by hash for the window only: the budget needs to tell guests apart, not name them.
        key = hashlib.sha256(address_key(address).encode()).hexdigest()
        now = self._clock()
        opened = self._attempts.spend(_PICTURES, key, PICTURE_REQUESTS, PICTURE_WINDOW_S, now)
        if opened is not None:
            wait = math.ceil(opened + PICTURE_WINDOW_S - now)
            raise TooManyAttempts("Too many pictures at once. Try again in a moment.", max(wait, 1))
        found = self._boards.by_public_token(token) if self._allowed() else None
        if found is None:
            raise NotFound("board not found")
        return found[0]

    def forget_guests(self) -> None:
        """Drops the picture budgets whose window is over, with the address hashes they hold."""
        self._attempts.forget(_PICTURES, self._clock() - PICTURE_WINDOW_S)

    def board_for(self, person: Person, token: str, members: Members) -> str:
        """The board behind a link, for a signed-in person who can open it anyway. Anyone else
        gets the answer of a wrong link, so the link tells nothing more about the board. It is
        asked outside the guests' budget: signed-in people must not use up the link for guests."""
        found = self._boards.by_public_token(token) if self._allowed() else None
        if found is None or members.role(person, found[0]) is None:
            raise NotFound("board not found")
        return found[0]

    def alive(self, token: str, board_id: str) -> bool:
        """Whether the link still opens this board; asked for an open socket, outside the budget."""
        found = self._boards.by_public_token(token) if self._allowed() else None
        return found is not None and found[0] == board_id


def guest_tasks(
    refs: list[str], open_sources: dict[str, TaskProvider], base_url: str | None
) -> tuple[dict[str, Task], dict[str, DomainError]]:
    """What a guest gets, by ref, and the open sources that failed, by source id."""
    # Tasks of the open sources (the demo, public GitHub) belong to no person and show in
    # full; a task read with a person's token, or one an open source cannot read right now,
    # is its key and its link, nothing else.
    url = f"{base_url}/browse/" if base_url else ""
    keys: dict[str, list[str]] = {}
    for ref in refs:
        source, key = split_ref(ref)
        keys.setdefault(source, []).append(key)
    tasks: dict[str, Task] = {}
    failed: dict[str, DomainError] = {}
    for source, source_keys in keys.items():
        provider = open_sources.get(source)
        found: list[Task] = []
        try:
            found = provider.poll(source_keys) if provider else []
        except DomainError as exc:
            failed[source] = exc
        tasks |= {task.ref: task for task in found if task.state == "ok"}
        for key in source_keys:
            ref = task_ref(source, key)
            if ref not in tasks:
                link = f"{url}{key}" if url and provider is None else ""
                if source == GITHUB:
                    link = github_url(key)
                tasks[ref] = Task(
                    source=source, key=key, state="private", url=link, fetched_at=now_iso()
                )
    return tasks, failed


def public_board(
    board_id: str,
    boards: BoardRepo,
    open_sources: dict[str, TaskProvider],
    default_source: str,
    base_url: str | None,
    refresh_interval_s: int,
    planning: Planning | None,
) -> PublicBoard:
    record = boards.get(board_id)
    if record is None:
        raise NotFound("board not found")
    return PublicBoard(
        room=room_key(record.id),
        name=record.name,
        updated_at=record.updated_at,
        version=record.version,
        doc=record.doc.model_dump(exclude_none=True),
        tasks=guest_tasks(task_refs(record.doc, default_source), open_sources, base_url)[0],
        default_source=default_source,
        refresh_interval_s=refresh_interval_s,
        planning=(
            planning.for_board(*stage_refs(record.doc), working_ranges(record.doc))
            if planning
            else None
        ),
    )
