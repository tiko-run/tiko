import math
import time
from typing import Annotated

from fastapi import Depends, Request

from app.api import deps
from app.domain.accounts import Person
from app.domain.api_keys import KeyIdentity
from app.domain.errors import NotFound, PublicBoard, RateLimited, ScopeRequired
from app.domain.members import BoardRole

# Requests per person and minute, whatever key they use (contract: Budgets).
READS = 120
WRITES = 60
SEARCHES = 20
WINDOW_S = 60.0


def person(request: Request) -> Person:
    """Set by the gate from the key, with the role of a member of the key's workspace."""
    return request.state.person


def key(request: Request) -> KeyIdentity:
    return request.state.api_key


KeyPerson = Annotated[Person, Depends(person)]
Key = Annotated[KeyIdentity, Depends(key)]


def _spend(request: Request, scope: str, limit: int) -> None:
    now = time.time()
    opened = request.app.state.attempts.spend(scope, person(request).id, limit, WINDOW_S, now)
    if opened is not None:
        wait = max(math.ceil(opened + WINDOW_S - now), 1)
        raise RateLimited(f"Too many requests; try again in {wait} s.", wait)


def read_budget(request: Request) -> None:
    _spend(request, "api-read", READS)


def search_budget(request: Request) -> None:
    _spend(request, "api-search", SEARCHES)


def write_budget(request: Request) -> None:
    if key(request).scope != "write":
        raise ScopeRequired("This API key can only read. Make a key that can also write.")
    _spend(request, "api-write", WRITES)


def viewable(board_id: str, request: Request) -> BoardRole:
    """The person's role on a board the key reaches; any other board is simply not found."""
    chosen = key(request).boards
    if chosen is not None and board_id not in chosen:
        raise NotFound("board not found")
    return deps.members(request).require(person(request), board_id, "viewer")


Viewable = Annotated[BoardRole, Depends(viewable)]


def writable(board_id: str, request: Request) -> BoardRole:
    """A board the key may change: chosen for it, or, for a key of all boards, one without a
    public link, so a talked-into agent cannot copy private content onto a public page."""
    chosen = key(request).boards
    if chosen is not None and board_id not in chosen:
        raise NotFound("board not found")
    role = deps.members(request).require(person(request), board_id, "editor")
    if chosen is None and deps.public_links(request).token(board_id) is not None:
        raise PublicBoard(
            "This board has a public link. To write here, make a key for chosen boards and"
            " choose it."
        )
    return role


Writable = Annotated[BoardRole, Depends(writable)]


def board_url(request: Request, board_id: str) -> str:
    """The address the caller reached tiko by; the web proxy passes it on with its port."""
    host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
    if proto not in ("http", "https"):
        proto = request.url.scheme
    return f"{proto}://{host.split(',')[0].strip()}/?board={board_id}"
