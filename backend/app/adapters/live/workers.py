import asyncio
import contextlib
import json
import logging
import socket
import string
from collections.abc import Callable
from pathlib import Path
from typing import Any

import anyio.to_thread

from app.adapters.live.rooms import Connection, Listener, LiveRooms
from app.domain.accounts import Person
from app.domain.boards import BoardDoc
from app.domain.errors import NotFound, ValidationFailed, VersionConflict
from app.domain.live import GOING_AWAY, room_key

log = logging.getLogger(__name__)

TELL_TIMEOUT_S = 2.0
PUT_TIMEOUT_S = 30.0
_HEX = set(string.hexdigits)
# What a save may answer with; anything else is a failure of the other process.
_ERRORS = {error.code: error for error in (NotFound, VersionConflict, ValidationFailed)}
_TOLD = (
    "end_session",
    "end_person",
    "recheck_person",
    "recheck_board",
    "end_public",
    "planning_changed",
)


def owner(board_id: str, workers: int) -> int:
    """The process that holds the board's room. The proxy picks it by the same rule: the last
    two hex digits of the id, modulo the number of processes."""
    tail = room_key(board_id)
    return int(tail, 16) % workers if len(tail) == 2 and set(tail) <= _HEX else 0


class Workers:
    """The `LiveBoards` port of an instance that runs several processes: this one's rooms, and
    word to the others through a Unix socket each of them listens on."""

    def __init__(self, rooms: LiveRooms, index: int, count: int, directory: str) -> None:
        self._rooms = rooms
        self._index = index
        self._count = count
        self._directory = Path(directory)
        self._heard: dict[str, list[Callable[..., Any]]] = {}
        self._server: asyncio.Server | None = None

    def _path(self, index: int) -> str:
        return str(self._directory / f"{index}.sock")

    def heard(self, what: str, act: Callable[..., Any]) -> None:
        """`act` also runs here when another process tells `what`."""
        self._heard.setdefault(what, []).append(act)

    async def listen(self) -> None:
        path = self._path(self._index)
        Path(path).unlink(missing_ok=True)
        self._server = await asyncio.start_unix_server(self._answer, path)

    async def close(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            Path(self._path(self._index)).unlink(missing_ok=True)

    async def _answer(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        reply: dict[str, Any] = {}
        try:
            what, args = json.loads(await reader.read())
            if what == "put":
                board_id, version, doc = args
                put = self._rooms.put
                reply["version"] = await anyio.to_thread.run_sync(
                    put, board_id, version, BoardDoc.model_validate(doc)
                )
            else:
                # Off the loop: what runs here may wait for a lock or the database.
                await anyio.to_thread.run_sync(self._hear, what, args)
        except tuple(_ERRORS.values()) as error:
            reply["error"] = [error.code, str(error)]
        except Exception:
            log.exception("a message from another process failed")
            reply["error"] = ["", "failed"]
        with contextlib.suppress(OSError):
            writer.write(json.dumps(reply).encode())
            await writer.drain()
            writer.close()

    def _hear(self, what: str, args: list[Any]) -> None:
        if what in _TOLD:
            getattr(self._rooms, what)(*args)
        for act in self._heard.get(what, []):
            act(*args)

    def _ask(self, index: int, what: str, args: list[Any], timeout: float) -> dict[str, Any]:
        with socket.socket(socket.AF_UNIX) as conn:
            conn.settimeout(timeout)
            conn.connect(self._path(index))
            conn.sendall(json.dumps([what, args]).encode())
            conn.shutdown(socket.SHUT_WR)
            data = b""
            while chunk := conn.recv(65536):
                data += chunk
        return json.loads(data)

    def tell(self, what: str, *args: Any) -> None:
        """Passes `what` to every other process. One that does not answer is logged and
        skipped: its sockets still ask about their session once a minute."""
        for index in range(self._count):
            if index == self._index:
                continue
            try:
                self._ask(index, what, list(args), TELL_TIMEOUT_S)
            except (OSError, ValueError):
                log.exception("process %d did not hear %s", index, what)

    def _mine(self, board_id: str) -> bool:
        return owner(board_id, self._count) == self._index

    async def join(
        self, board_id: str, person: Person, session: str, can_edit: bool
    ) -> Connection | int:
        if not self._mine(board_id):
            return self._misrouted(board_id)
        return await self._rooms.join(board_id, person, session, can_edit)

    async def join_guest(self, board_id: str) -> Listener | int:
        if not self._mine(board_id):
            return self._misrouted(board_id)
        return await self._rooms.join_guest(board_id)

    def _misrouted(self, board_id: str) -> int:
        # A second room for the board here would drift apart from the real one.
        log.warning(
            "board %s belongs to process %d, not %d: TIKO_WORKERS of the web container, or a"
            " proxy that skips it",
            board_id,
            owner(board_id, self._count),
            self._index,
        )
        return GOING_AWAY

    def end_session(self, token: str) -> None:
        self._rooms.end_session(token)
        self.tell("end_session", token)

    def end_person(self, user_id: str, keep_token: str | None = None) -> None:
        self._rooms.end_person(user_id, keep_token)
        self.tell("end_person", user_id, keep_token)

    def recheck_person(self, user_id: str) -> None:
        self._rooms.recheck_person(user_id)
        self.tell("recheck_person", user_id)

    def planning_changed(self, workspace: str | None = None) -> None:
        self._rooms.planning_changed(workspace)
        self.tell("planning_changed", workspace)

    def recheck_board(self, board_id: str) -> None:
        if self._mine(board_id):
            self._rooms.recheck_board(board_id)
        else:
            self._tell_owner("recheck_board", board_id)

    def end_public(self, board_id: str | None = None) -> None:
        if board_id is None:
            self._rooms.end_public()
            self.tell("end_public")
        elif self._mine(board_id):
            self._rooms.end_public(board_id)
        else:
            self._tell_owner("end_public", board_id)

    def _tell_owner(self, what: str, board_id: str) -> None:
        try:
            self._ask(owner(board_id, self._count), what, [board_id], TELL_TIMEOUT_S)
        except (OSError, ValueError):
            log.exception("the process of board %s did not hear %s", board_id, what)

    def put(self, board_id: str, version: int, doc: BoardDoc) -> int:
        if self._mine(board_id):
            return self._rooms.put(board_id, version, doc)
        # The board's room, open or not, is the other process's: a save from here would go
        # past the tabs on it.
        reply = self._ask(
            owner(board_id, self._count),
            "put",
            [board_id, version, doc.model_dump(mode="json", exclude_none=True)],
            PUT_TIMEOUT_S,
        )
        if "error" in reply:
            code, message = reply["error"]
            if code in _ERRORS:
                raise _ERRORS[code](message)
            raise RuntimeError(f"board {board_id} was not saved by its process")
        return reply["version"]
