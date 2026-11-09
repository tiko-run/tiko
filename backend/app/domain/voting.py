"""Timed voting rounds on a board (spec 043).

Votes live here, never in the shared board: everyone on a board can read its document, and an
anonymous round must not show who voted for what. Each person sees only their own votes until
the round ends.
"""

import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Annotated, Literal, NamedTuple

from pydantic import BaseModel, Field, StringConstraints

from app.domain.accounts import Person
from app.domain.errors import Forbidden, NotFound, VoteClosed, VoteRefused, VoteRunning
from app.domain.members import BoardRole
from app.domain.ports import BoardRepo, LiveBoards, VoteRepo

MAX_ELEMENTS = 500
PAST_SHOWN = 50
ElementId = Annotated[str, StringConstraints(min_length=1, max_length=100)]
RoundName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class RoundIn(BaseModel):
    name: RoundName
    votes: int = Field(default=5, ge=1, le=99)
    # Several votes of one person may go on one element, as in dot voting.
    stack: bool = True
    # None: the round runs until it is ended by hand.
    minutes: int | None = Field(default=5, ge=1, le=60)
    anonymous: bool = True
    elements: list[ElementId] = Field(min_length=1, max_length=MAX_ELEMENTS)


class RoundRename(BaseModel):
    name: RoundName


class Round(BaseModel):
    id: str
    board_id: str
    name: str
    votes: int
    stack: bool
    anonymous: bool
    elements: list[str]
    texts: dict[str, str] = {}
    started_by: str
    started_at: str
    ends_at: str | None
    ended_at: str | None


class Ballot(NamedTuple):
    person: str
    element: str
    count: int


class Participant(NamedTuple):
    person: str
    done: bool


class PersonRef(BaseModel):
    id: str
    name: str


class Voter(BaseModel):
    name: str
    count: int


class ResultRow(BaseModel):
    element: str
    count: int
    # The element's text when the round ended: a note's words or a card's key.
    text: str
    # An open round names who gave the votes; an anonymous one never does.
    voters: list[Voter] | None


class RoundView(BaseModel):
    id: str
    name: str
    votes: int
    stack: bool
    anonymous: bool
    elements: list[str]
    started_by: PersonRef
    started_at: str
    ends_at: str | None
    ended_at: str | None
    state: Literal["running", "ended"]
    # The viewer's own part.
    joined: bool
    done: bool
    # Done pressed, not only every vote spent: the panel stays folded after a reload.
    marked_done: bool
    mine: dict[str, int]
    left: int
    # How many joined and how many of them are done: the only shared number while it runs.
    joined_count: int
    done_count: int
    # The starter and the board's owner: who is still voting, never what anyone picked.
    can_manage: bool
    still_voting: list[str] | None
    results: list[ResultRow] | None
    voted_count: int | None


class RoundSummary(BaseModel):
    id: str
    name: str
    started_at: str
    ended_at: str | None
    voted_count: int


class Overview(BaseModel):
    running: RoundView | None
    past: list[RoundSummary]


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).isoformat()


def _ts(value: str) -> float:
    return datetime.fromisoformat(value).timestamp()


def cast(round_: Round, mine: dict[str, int], element: str, delta: int) -> dict[str, int]:
    """The person's votes after giving (+1) or taking back (-1) one on an element."""
    if element not in round_.elements:
        raise VoteRefused("This element is not in the vote.")
    count = mine.get(element, 0) + delta
    if count < 0:
        raise VoteRefused("You have no vote on this element.")
    if delta > 0:
        if not round_.stack and count > 1:
            raise VoteRefused("This vote takes one vote per element.")
        if sum(mine.values()) + delta > round_.votes:
            raise VoteRefused("You have no votes left.")
    out = {**mine, element: count}
    return {key: value for key, value in out.items() if value > 0}


def element_texts(nodes: list, elements: list[str]) -> dict[str, str]:
    """What each element says on the board: a note's text, a card's key."""
    wanted = set(elements)
    out: dict[str, str] = {}
    for node in nodes:
        if node.id not in wanted:
            continue
        if node.type == "sticky":
            out[node.id] = node.data.text
        elif node.type == "task_card":
            out[node.id] = node.data.key
    return out


class Voting:
    def __init__(
        self,
        repo: VoteRepo,
        boards: BoardRepo,
        names: Callable[[], dict[str, str]],
        live: LiveBoards | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._repo = repo
        self._boards = boards
        self._names = names
        self._live = live
        self._clock = clock

    def _changed(self, board_id: str) -> None:
        if self._live:
            self._live.votes_changed(board_id)

    def _settle(self, round_: Round | None) -> Round | None:
        """Ends a round whose time ran out; the first one to look ends it."""
        if round_ is None or round_.ended_at or round_.ends_at is None:
            return round_
        if _ts(round_.ends_at) > self._clock():
            return round_
        # Ended when its time ran out, whenever someone first looks.
        return self._finish(round_, by_timer=True)

    def _finish(self, round_: Round, by_timer: bool = False) -> Round:
        board = self._boards.get(round_.board_id)
        texts = element_texts(board.doc.nodes, round_.elements) if board else {}
        ended = round_.ends_at if by_timer and round_.ends_at else _iso(self._clock())
        deadline = round_.ends_at if by_timer else None
        if self._repo.end(round_.id, ended, texts, deadline):
            self._changed(round_.board_id)
        return self._repo.get(round_.board_id, round_.id) or round_

    def _round(self, board_id: str, round_id: str) -> Round:
        found = self._settle(self._repo.get(board_id, round_id))
        if found is None:
            raise NotFound("vote not found")
        return found

    def _running(self, board_id: str, round_id: str) -> Round:
        found = self._round(board_id, round_id)
        if found.ended_at:
            raise VoteClosed("This vote has ended.")
        return found

    def _manages(self, round_: Round, person: Person, role: BoardRole) -> bool:
        return person.id == round_.started_by or role == "owner"

    def _manager(self, round_: Round, person: Person, role: BoardRole) -> None:
        if not self._manages(round_, person, role):
            raise Forbidden("Only who started the vote or the board's owner can do this.")

    def running_elements(self, board_id: str) -> tuple[frozenset[str], float | None] | None:
        """What a running round locks on the board, and until when."""
        found = self._repo.running(board_id)
        if found is None:
            return None
        return frozenset(found.elements), _ts(found.ends_at) if found.ends_at else None

    def overview(self, person: Person, role: BoardRole, board_id: str) -> Overview:
        running = self._settle(self._repo.running(board_id))
        if running and running.ended_at:
            running = None
        past = self._repo.past(board_id, PAST_SHOWN)
        return Overview(
            running=self.view(running, person, role) if running else None,
            past=[
                RoundSummary(
                    id=r.id,
                    name=r.name,
                    started_at=r.started_at,
                    ended_at=r.ended_at,
                    voted_count=len({b.person for b in self._repo.ballots(r.id)}),
                )
                for r in past
            ],
        )

    def get(self, person: Person, role: BoardRole, board_id: str, round_id: str) -> RoundView:
        return self.view(self._round(board_id, round_id), person, role)

    def start(self, person: Person, role: BoardRole, board_id: str, body: RoundIn) -> RoundView:
        if role == "viewer":
            raise Forbidden("Only people who can edit the board start a vote.")
        settled = self._settle(self._repo.running(board_id))
        if settled and not settled.ended_at:
            raise VoteRunning("A vote is already running on this board.")
        board = self._boards.get(board_id)
        # A note added a moment ago may not be saved yet: only what is surely not one is refused.
        others = {
            node.id
            for node in (board.doc.nodes if board else [])
            if node.type not in ("sticky", "task_card")
        }
        if others & set(body.elements):
            raise VoteRefused("Only notes and cards can take part in a vote.")
        now = self._clock()
        round_ = Round(
            id=uuid.uuid4().hex,
            board_id=board_id,
            name=body.name,
            votes=body.votes,
            stack=body.stack,
            anonymous=body.anonymous,
            elements=list(dict.fromkeys(body.elements)),
            started_by=person.id,
            started_at=_iso(now),
            ends_at=_iso(now + body.minutes * 60) if body.minutes else None,
            ended_at=None,
        )
        if not self._repo.add(round_):
            raise VoteRunning("A vote is already running on this board.")
        self._repo.join(round_.id, person.id)
        self._changed(board_id)
        return self.view(round_, person, role)

    def join(self, person: Person, role: BoardRole, board_id: str, round_id: str) -> RoundView:
        round_ = self._running(board_id, round_id)
        self._repo.join(round_.id, person.id)
        self._changed(board_id)
        return self.view(round_, person, role)

    def vote(
        self,
        person: Person,
        role: BoardRole,
        board_id: str,
        round_id: str,
        element: str,
        delta: Literal[-1, 1],
    ) -> RoundView:
        round_ = self._running(board_id, round_id)
        self._repo.cast(round_.id, person.id, lambda mine: cast(round_, mine, element, delta))
        self._changed(board_id)
        return self.view(round_, person, role)

    def done(
        self, person: Person, role: BoardRole, board_id: str, round_id: str, done: bool
    ) -> RoundView:
        round_ = self._running(board_id, round_id)
        self._repo.join(round_.id, person.id)
        self._repo.set_done(round_.id, person.id, done)
        self._changed(board_id)
        return self.view(round_, person, role)

    def extend(self, person: Person, role: BoardRole, board_id: str, round_id: str) -> RoundView:
        round_ = self._running(board_id, round_id)
        self._manager(round_, person, role)
        if not round_.ends_at:
            raise VoteRefused("This vote has no timer.")
        self._repo.extend(round_.id, _iso(self._clock()))
        self._changed(board_id)
        return self.get(person, role, board_id, round_id)

    def end(self, person: Person, role: BoardRole, board_id: str, round_id: str) -> RoundView:
        round_ = self._running(board_id, round_id)
        self._manager(round_, person, role)
        return self.view(self._finish(round_), person, role)

    def rename(
        self, person: Person, role: BoardRole, board_id: str, round_id: str, name: str
    ) -> RoundView:
        round_ = self._round(board_id, round_id)
        self._manager(round_, person, role)
        self._repo.rename(round_.id, name)
        self._changed(board_id)
        return self.get(person, role, board_id, round_id)

    def delete(self, person: Person, role: BoardRole, board_id: str, round_id: str) -> None:
        round_ = self._round(board_id, round_id)
        self._manager(round_, person, role)
        self._repo.delete(round_.id)
        self._changed(board_id)

    def view(self, round_: Round, person: Person, role: BoardRole) -> RoundView:
        people = self._repo.people(round_.id)
        ballots = self._repo.ballots(round_.id)
        names = self._names()
        spent: dict[str, int] = {}
        for ballot in ballots:
            spent[ballot.person] = spent.get(ballot.person, 0) + ballot.count
        mine = {b.element: b.count for b in ballots if b.person == person.id}
        finished = {p.person for p in people if p.done or spent.get(p.person, 0) >= round_.votes}
        manages = self._manages(round_, person, role)
        running = round_.ended_at is None
        return RoundView(
            id=round_.id,
            name=round_.name,
            votes=round_.votes,
            stack=round_.stack,
            anonymous=round_.anonymous,
            elements=round_.elements,
            started_by=PersonRef(
                id=round_.started_by, name=names.get(round_.started_by, "Former member")
            ),
            started_at=round_.started_at,
            ends_at=round_.ends_at,
            ended_at=round_.ended_at,
            state="running" if running else "ended",
            joined=any(p.person == person.id for p in people),
            done=person.id in finished,
            marked_done=any(p.person == person.id and p.done for p in people),
            mine=mine,
            left=round_.votes - sum(mine.values()),
            joined_count=len(people),
            done_count=len(finished),
            can_manage=manages,
            still_voting=(
                sorted(
                    (
                        names.get(p.person, "Former member")
                        for p in people
                        if p.person not in finished
                    ),
                    key=str.casefold,
                )
                if manages and running
                else None
            ),
            results=None if running else _results(round_, ballots, names),
            voted_count=None if running else len(spent),
        )


def _results(round_: Round, ballots: list[Ballot], names: dict[str, str]) -> list[ResultRow]:
    totals: dict[str, int] = {}
    voters: dict[str, list[Voter]] = {}
    for ballot in ballots:
        totals[ballot.element] = totals.get(ballot.element, 0) + ballot.count
        voters.setdefault(ballot.element, []).append(
            Voter(name=names.get(ballot.person, "Former member"), count=ballot.count)
        )
    order = {element: index for index, element in enumerate(round_.elements)}
    rows = [
        ResultRow(
            element=element,
            count=count,
            text=round_.texts.get(element, ""),
            voters=(
                None
                if round_.anonymous
                else sorted(voters[element], key=lambda v: (-v.count, v.name.casefold()))
            ),
        )
        for element, count in totals.items()
    ]
    return sorted(rows, key=lambda row: (-row.count, order.get(row.element, 0)))
