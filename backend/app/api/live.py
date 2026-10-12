import asyncio
import logging
import time
from collections.abc import Callable
from typing import Protocol
from urllib.parse import urlsplit

import anyio.to_thread
from fastapi import APIRouter, WebSocket

from app.domain.live import ACCESS_CHANGED, MAX_MESSAGE_BYTES, POLICY, SESSION_ENDED, TOO_BIG
from app.observability import live_message

router = APIRouter(tags=["live"])
log = logging.getLogger(__name__)

SESSION_CHECK_S = 60.0


class Listener(Protocol):
    """A place in a board's room, as the socket loop needs it."""

    outbox: asyncio.Queue[bytes | int]
    closing: bool

    def kick(self, code: int) -> None: ...


def _same_origin(websocket: WebSocket) -> bool:
    """Browsers send cookies with a socket opened from any page, so a foreign page is refused."""
    origin = websocket.headers.get("origin")
    if not origin:
        return True
    host = urlsplit(f"//{websocket.headers.get('host', '')}").hostname
    return urlsplit(origin).hostname == host


@router.websocket("/boards/{board_id}/live")
async def live_board(websocket: WebSocket, board_id: str) -> None:
    state = websocket.app.state
    person, session = websocket.state.person, websocket.state.session
    if not _same_origin(websocket):
        await websocket.close(POLICY)
        return
    # Accepted before the role is known: a refused upgrade cannot carry a close code.
    await websocket.accept()
    role = await anyio.to_thread.run_sync(state.members.role, person, board_id)
    if role is None:
        await websocket.close(ACCESS_CHANGED)
        return
    connection = await state.live.join(board_id, person, session, role != "viewer")
    if isinstance(connection, int):
        await websocket.close(connection)
        return
    room = connection.room
    try:
        await serve(
            websocket,
            board_id,
            connection,
            lambda data: room.receive(connection, data),
            lambda: state.sessions.resolve(session, time.time()) is not None,
            SESSION_ENDED,
        )
    finally:
        # Nothing awaited here: a cancelled handler must still leave the room.
        room.leave(connection)


async def serve(
    websocket: WebSocket,
    board_id: str,
    listener: Listener,
    receive: Callable[[bytes], None],
    allowed: Callable[[], bool],
    ended: int,
) -> None:
    """Carries an accepted socket until either side leaves. `allowed` is asked once a minute;
    when it says no, the socket is closed with `ended`."""

    async def read() -> None:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                return
            data = message.get("bytes")
            if data is None:
                continue
            live_message("in", data)
            if len(data) > MAX_MESSAGE_BYTES:
                listener.kick(TOO_BIG)
                return
            try:
                receive(data)
            except Exception:
                log.warning("live board %s: a message could not be read", board_id)
                listener.kick(POLICY)
                return

    async def write() -> None:
        while True:
            item = await listener.outbox.get()
            if isinstance(item, int):
                await websocket.close(item)
                return
            await websocket.send_bytes(item)

    async def watch() -> None:
        while True:
            await asyncio.sleep(SESSION_CHECK_S)
            if not await anyio.to_thread.run_sync(allowed):
                listener.kick(ended)
                return

    tasks = reader, writer, _ = [asyncio.create_task(job()) for job in (read, write, watch)]
    for task in tasks:
        # A socket that broke mid-send is an ordinary way to leave, not an error to report.
        task.add_done_callback(lambda done: done.cancelled() or done.exception())
    try:
        await asyncio.wait({reader, writer}, return_when=asyncio.FIRST_COMPLETED)
        if listener.closing and not writer.done():
            # The close code is still in the outbox.
            await asyncio.wait({writer}, timeout=2)
    finally:
        for task in tasks:
            task.cancel()
