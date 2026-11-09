from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from app.api.deps import CanView, CurrentPerson
from app.domain.voting import ElementId, Overview, RoundIn, RoundRename, RoundView, Voting

router = APIRouter(prefix="/boards/{board_id}/votes", tags=["votes"])


def _voting(request: Request) -> Voting:
    return request.app.state.voting


VotingDep = Annotated[Voting, Depends(_voting)]


class BallotIn(BaseModel):
    element: ElementId
    delta: Literal[-1, 1]


class DoneIn(BaseModel):
    done: bool


@router.get("")
def overview(board_id: str, person: CurrentPerson, role: CanView, voting: VotingDep) -> Overview:
    return voting.overview(person, role, board_id)


@router.post("", status_code=201)
def start(
    board_id: str, body: RoundIn, person: CurrentPerson, role: CanView, voting: VotingDep
) -> RoundView:
    return voting.start(person, role, board_id, body)


@router.get("/{round_id}")
def get_round(
    board_id: str, round_id: str, person: CurrentPerson, role: CanView, voting: VotingDep
) -> RoundView:
    return voting.get(person, role, board_id, round_id)


@router.post("/{round_id}/join")
def join(
    board_id: str, round_id: str, person: CurrentPerson, role: CanView, voting: VotingDep
) -> RoundView:
    return voting.join(person, role, board_id, round_id)


@router.post("/{round_id}/ballot")
def ballot(
    board_id: str,
    round_id: str,
    body: BallotIn,
    person: CurrentPerson,
    role: CanView,
    voting: VotingDep,
) -> RoundView:
    return voting.vote(person, role, board_id, round_id, body.element, body.delta)


@router.post("/{round_id}/done")
def done(
    board_id: str,
    round_id: str,
    body: DoneIn,
    person: CurrentPerson,
    role: CanView,
    voting: VotingDep,
) -> RoundView:
    return voting.done(person, role, board_id, round_id, body.done)


@router.post("/{round_id}/extend")
def extend(
    board_id: str, round_id: str, person: CurrentPerson, role: CanView, voting: VotingDep
) -> RoundView:
    return voting.extend(person, role, board_id, round_id)


@router.post("/{round_id}/end")
def end(
    board_id: str, round_id: str, person: CurrentPerson, role: CanView, voting: VotingDep
) -> RoundView:
    return voting.end(person, role, board_id, round_id)


@router.patch("/{round_id}")
def rename(
    board_id: str,
    round_id: str,
    body: RoundRename,
    person: CurrentPerson,
    role: CanView,
    voting: VotingDep,
) -> RoundView:
    return voting.rename(person, role, board_id, round_id, body.name)


@router.delete("/{round_id}", status_code=204)
def delete(
    board_id: str, round_id: str, person: CurrentPerson, role: CanView, voting: VotingDep
) -> Response:
    voting.delete(person, role, board_id, round_id)
    return Response(status_code=204)
