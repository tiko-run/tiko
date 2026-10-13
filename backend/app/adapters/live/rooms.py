"""Live boards in the memory of this process: one room per open board.

Everything here runs on the event loop that served the first socket; calls from request threads
cross over with `call_soon_threadsafe`. Storage is blocking and runs in worker threads.
"""

import asyncio
import contextlib
import logging
import time
import weakref
from collections.abc import Callable
from typing import Any

import anyio.to_thread
from pycrdt import (
    Decoder,
    Encoder,
    TransactionEvent,
    YMessageType,
    YSyncMessageType,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    read_message,
)

from app.domain.accounts import Person
from app.domain.boards import BoardDoc
from app.domain.errors import NotFound, VersionConflict
from app.domain.live import (
    ACCESS_CHANGED,
    GOING_AWAY,
    MAX_CONNECTIONS,
    MAX_GUESTS,
    ROOM_FULL,
    SESSION_ENDED,
    TOO_SLOW,
    LiveDoc,
)
from app.domain.members import role_on
from app.domain.ports import BoardRepo, MemberRepo
from app.observability import LIVE_CHECK, LIVE_NODES, LIVE_SAVE

log = logging.getLogger(__name__)

QUEUE_SIZE = 512

# pycrdt reports a transaction that changed nothing as this update.
_EMPTY_UPDATE = b"\x00\x00"
_WRITES = (YSyncMessageType.SYNC_STEP2, YSyncMessageType.SYNC_UPDATE)


class Listener:
    """One socket and what is waiting to be sent to it. On its own it is a guest of a public
    link: it hears the board and has no say in it."""

    def __init__(self, room: "Room") -> None:
        self.room = room
        # Bytes to send, or an int: the code to close the socket with.
        self.outbox: asyncio.Queue[bytes | int] = asyncio.Queue(QUEUE_SIZE)
        self.closing = False

    def push(self, data: bytes) -> None:
        if self.closing:
            return
        try:
            self.outbox.put_nowait(data)
        except asyncio.QueueFull:
            self.kick(TOO_SLOW)

    def kick(self, code: int) -> None:
        if self.closing:
            return
        self.closing = True
        while not self.outbox.empty():
            self.outbox.get_nowait()
        self.outbox.put_nowait(code)


class Connection(Listener):
    """A signed-in person's socket: who it belongs to and what it may do."""

    def __init__(self, room: "Room", person: Person, session: str, can_edit: bool) -> None:
        super().__init__(room)
        self.person = person
        self.session = session
        self.can_edit = can_edit
        self.clients: set[int] = set()


class Room:
    def __init__(
        self, rooms: "LiveRooms", board_id: str, doc: BoardDoc, version: int, state: bytes | None
    ) -> None:
        self._rooms = rooms
        self.board_id = board_id
        self.live = live = LiveDoc(state)
        self.last = doc
        self.version = version
        self.connections: set[Connection] = set()
        # Guests of the public link: they get the document and never presence.
        self.guests: set[Listener] = set()
        # Latest presence of each tab by its Yjs client id: (clock, state as JSON text).
        self.presence: dict[int, tuple[int, str]] = {}
        # Which connection each presence state belongs to.
        self._owners: dict[int, Connection] = {}
        # States that changed since the last presence frame went out.
        self._news: dict[int, tuple[int, str]] = {}
        self._presence_timer: asyncio.TimerHandle | None = None
        self._presence_sent = 0.0
        self._sender: Connection | None = None
        self._dirty_since: float | None = None
        if state is None:
            live.apply_json(doc)
            # The first save stores the state, so later rooms share its history.
            self._dirty_since = asyncio.get_running_loop().time()
        self._check_timer: asyncio.TimerHandle | None = None
        self._save_timer: asyncio.TimerHandle | None = None
        self._drop_timer: asyncio.TimerHandle | None = None
        self._saving = asyncio.Lock()
        # pycrdt objects must be freed on the thread that made them. A bound method here would
        # tie the room and the document into a cycle that the collector may free on any thread.
        room = weakref.ref(self)
        self._subscription = live.doc.observe(lambda event: room()._on_update(event))

    def _on_update(self, event: TransactionEvent) -> None:
        if event.update == _EMPTY_UPDATE:
            return
        # Presence heard before an edit leaves before it: a drag ends with both.
        self._send_presence()
        message = create_update_message(event.update)
        for connection in (*self.connections, *self.guests):
            if connection is not self._sender:
                connection.push(message)
        loop = asyncio.get_running_loop()
        self._dirty_since = self._dirty_since or loop.time()
        # Checked once per burst: validating a big board on every keystroke would stall the loop.
        if self._check_timer is None:
            self._check_timer = loop.call_later(self._rooms.check_delay_s, self.check)

    def _stay(self) -> None:
        if self._drop_timer:
            self._drop_timer.cancel()
            self._drop_timer = None

    def _left(self) -> None:
        if self.connections or self.guests:
            return
        loop = asyncio.get_running_loop()
        loop.create_task(self.save())
        self._drop_timer = loop.call_later(
            self._rooms.idle_s, lambda: loop.create_task(self._rooms.drop(self))
        )

    def join_guest(self, guest: Listener) -> None:
        self._stay()
        self.guests.add(guest)
        guest.push(create_sync_message(self.live.doc))

    def leave_guest(self, guest: Listener) -> None:
        self.guests.discard(guest)
        self._left()

    def answer(self, guest: Listener, data: bytes) -> None:
        """A guest may ask for the board; whatever else it sends is dropped."""
        if len(data) < 2 or data[0] != YMessageType.SYNC:
            return
        if data[1] == YSyncMessageType.SYNC_STEP1:
            reply = handle_sync_message(data[1:], self.live.doc)
            if reply:
                guest.push(reply)

    def join(self, connection: Connection) -> None:
        self._stay()
        self.connections.add(connection)
        connection.push(create_sync_message(self.live.doc))
        if self.presence:
            connection.push(_presence_message(self.presence))

    def leave(self, connection: Connection) -> None:
        self.connections.discard(connection)
        for client in connection.clients:
            if self._owners.get(client) is connection:
                del self._owners[client]
        gone: dict[int, tuple[int, str]] = {}
        for client in connection.clients:
            # Told at once, with a goodbye the tab itself sent and that was still waiting.
            waiting = self._news.pop(client, None)
            if client in self.presence:
                gone[client] = (self.presence.pop(client)[0] + 1, "null")
            elif waiting:
                gone[client] = waiting
        if gone:
            message = _presence_message(gone)
            for other in self.connections:
                other.push(message)
        self._left()

    def receive(self, connection: Connection, data: bytes) -> None:
        if len(data) < 2:
            return
        if data[0] == YMessageType.SYNC:
            if data[1] == YSyncMessageType.SYNC_STEP1:
                reply = handle_sync_message(data[1:], self.live.doc)
                if reply:
                    connection.push(reply)
            elif data[1] in _WRITES and connection.can_edit:
                self._sender = connection
                try:
                    handle_sync_message(data[1:], self.live.doc)
                finally:
                    self._sender = None
        elif data[0] == YMessageType.AWARENESS:
            # A browser sends back every presence change it hears, other people's included.
            # Only a tab's own state counts: otherwise one tab closing would take the others'
            # cursors with it, and anyone could move anyone's cursor.
            accepted = False
            decoder = Decoder(read_message(data[1:]))
            for _ in range(decoder.read_var_uint()):
                client, clock = decoder.read_var_uint(), decoder.read_var_uint()
                state = decoder.read_var_string()
                owner = self._owners.get(client)
                if owner is None or owner not in self.connections:
                    owner = self._owners[client] = connection
                if owner is not connection:
                    continue
                connection.clients.add(client)
                self._news[client] = (clock, state)
                accepted = True
                if state == "null":
                    self.presence.pop(client, None)
                else:
                    self.presence[client] = (clock, state)
            # At most one frame for the room every `presence_delay_s`, not one per pointer move:
            # relayed one by one, 30 people turn 130 messages a second into 4000. After a pause
            # the first one leaves at once, so a lone pointer is not held back.
            if accepted and self._presence_timer is None:
                loop = asyncio.get_running_loop()
                due = self._presence_sent + self._rooms.presence_delay_s
                if due <= loop.time():
                    self._send_presence()
                else:
                    self._presence_timer = loop.call_at(due, self._send_presence)

    def _send_presence(self) -> None:
        if self._presence_timer:
            self._presence_timer.cancel()
            self._presence_timer = None
        if not self._news:
            return
        # The sender gets it back too: the browser's provider reconnects when it hears
        # nothing for 30 s, and its own heartbeat is what keeps a lone tab connected.
        message = _presence_message(self._news)
        self._news = {}
        self._presence_sent = asyncio.get_running_loop().time()
        for connection in self.connections:
            connection.push(message)

    def check(self) -> None:
        """Repairs what the last merges broke; `last` is the board as it will be saved."""
        if self._check_timer:
            self._check_timer.cancel()
            self._check_timer = None
        started = time.perf_counter()
        try:
            self.last, notes = self.live.repair(self.last)
        except Exception:
            # The previous valid board stays the one that is saved.
            log.exception("live board %s failed its check", self.board_id)
            return
        finally:
            LIVE_CHECK.observe(time.perf_counter() - started)
        for note in notes:
            log.warning("live board %s repaired: %s", self.board_id, note)
        self._plan_save()

    def _plan_save(self) -> None:
        if self._dirty_since is None:
            return
        loop = asyncio.get_running_loop()
        if self._save_timer:
            self._save_timer.cancel()
        due = min(loop.time() + self._rooms.save_idle_s, self._dirty_since + self._rooms.save_max_s)
        self._save_timer = loop.call_at(due, lambda: loop.create_task(self.save()))

    async def save(self) -> None:
        async with self._saving:
            if self._check_timer:
                self.check()
            if self._save_timer:
                self._save_timer.cancel()
                self._save_timer = None
            if self._dirty_since is None:
                return
            self._dirty_since = None
            doc, state = self.last, self.live.state()
            LIVE_NODES.observe(len(doc.nodes))
            started = time.perf_counter()
            try:
                self.version = await anyio.to_thread.run_sync(
                    self._rooms.boards.save_live, self.board_id, doc, state
                )
            except NotFound:
                self.close(ACCESS_CHANGED)
            except Exception:
                log.exception("live board %s was not saved", self.board_id)
                self._dirty_since = asyncio.get_running_loop().time()
                self._plan_save()
            finally:
                LIVE_SAVE.observe(time.perf_counter() - started)

    async def put(self, version: int, doc: BoardDoc) -> int:
        if version != self.version:
            raise VersionConflict("board was changed elsewhere; reload it")
        self.last = self.last.model_copy(update={"viewport": doc.viewport})
        self.live.apply_json(doc)
        # A save even when nothing differs, so the caller gets a new version as it always did.
        self._dirty_since = self._dirty_since or asyncio.get_running_loop().time()
        await self.save()
        return self.version

    def close(self, code: int) -> None:
        for connection in (*self.connections, *self.guests):
            connection.kick(code)

    def stop(self) -> None:
        for timer in (
            self._check_timer,
            self._save_timer,
            self._drop_timer,
            self._presence_timer,
        ):
            if timer:
                timer.cancel()
        self.live.doc.unobserve(self._subscription)
        # Freed here, on the loop's thread, whatever still points at the room.
        self._subscription = self.live = None


def _presence_message(states: dict[int, tuple[int, str]]) -> bytes:
    encoder = Encoder()
    encoder.write_var_uint(len(states))
    for client, (clock, state) in states.items():
        encoder.write_var_uint(client)
        encoder.write_var_uint(clock)
        encoder.write_var_string(state)
    return create_awareness_message(encoder.to_bytes())


class LiveRooms:
    """Opens, finds and closes rooms; the `LiveBoards` port of the domain."""

    def __init__(self, boards: BoardRepo, members: MemberRepo) -> None:
        self.boards = boards
        self._members = members
        self._rooms: dict[str, Room] = {}
        self._opening: dict[str, asyncio.Future[Room | None]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self.check_delay_s = 0.05
        self.presence_delay_s = 0.05
        self.save_idle_s = 2.0
        self.save_max_s = 10.0
        self.idle_s = 30.0

    def stats(self) -> tuple[int, int, int, int]:
        """Open rooms, sockets of people and of guests, and the fullest queue of a socket."""
        people = guests = fullest = 0
        for room in self._rooms.values():
            people += len(room.connections)
            guests += len(room.guests)
            for listener in (*room.connections, *room.guests):
                fullest = max(fullest, listener.outbox.qsize())
        return len(self._rooms), people, guests, fullest

    async def _room(self, board_id: str) -> Room | None:
        self._loop = asyncio.get_running_loop()
        if board_id in self._rooms:
            return self._rooms[board_id]
        if board_id in self._opening:
            return await self._opening[board_id]
        future = self._opening[board_id] = self._loop.create_future()
        room = None
        try:
            found = await anyio.to_thread.run_sync(self.boards.load, board_id)
            if found is not None:
                record, state = found
                room = self._rooms[board_id] = Room(
                    self, board_id, record.doc, record.version, state
                )
        finally:
            del self._opening[board_id]
            future.set_result(room)
        return room

    async def join(
        self, board_id: str, person: Person, session: str, can_edit: bool
    ) -> Connection | int:
        """A connection in the board's room, or the code to close the socket with."""
        room = await self._room(board_id)
        if room is None:
            return ACCESS_CHANGED
        if len(room.connections) >= MAX_CONNECTIONS:
            return ROOM_FULL
        connection = Connection(room, person, session, can_edit)
        room.join(connection)
        return connection

    async def join_guest(self, board_id: str) -> Listener | int:
        """A guest's place in the board's room, or the code to close the socket with."""
        room = await self._room(board_id)
        if room is None:
            return ACCESS_CHANGED
        if len(room.guests) >= MAX_GUESTS:
            return ROOM_FULL
        guest = Listener(room)
        room.join_guest(guest)
        return guest

    async def drop(self, room: Room) -> None:
        if room.connections or room.guests or self._rooms.get(room.board_id) is not room:
            return
        await room.save()
        if not (room.connections or room.guests):
            del self._rooms[room.board_id]
            room.stop()

    async def shutdown(self) -> None:
        for room in list(self._rooms.values()):
            await room.save()
            room.close(GOING_AWAY)
            room.stop()
        self._rooms.clear()

    def put(self, board_id: str, version: int, doc: BoardDoc) -> int:
        loop = self._loop
        if loop and loop.is_running() and (board_id in self._rooms or board_id in self._opening):
            return asyncio.run_coroutine_threadsafe(self._put(board_id, version, doc), loop).result(
                30
            )
        found = self.boards.load(board_id)
        if found is None:
            raise NotFound("board not found")
        live = LiveDoc(found[1])
        live.apply_json(doc)
        return self.boards.save(board_id, version, doc, live.state())

    async def _put(self, board_id: str, version: int, doc: BoardDoc) -> int:
        room = await self._room(board_id)
        if room is None:
            raise NotFound("board not found")
        return await room.put(version, doc)

    def _each(self, wanted: Callable[[Room, Connection], bool], act: Callable[..., Any]) -> None:
        loop = self._loop
        if loop is None or not loop.is_running():
            return

        def run() -> None:
            for room in list(self._rooms.values()):
                for connection in [c for c in room.connections if wanted(room, c)]:
                    act(room, connection)

        loop.call_soon_threadsafe(run)

    def end_session(self, token: str) -> None:
        self._each(lambda _, c: c.session == token, lambda _, c: c.kick(SESSION_ENDED))

    def end_person(self, user_id: str, keep_token: str | None = None) -> None:
        self._each(
            lambda _, c: c.person.id == user_id and c.session != keep_token,
            lambda _, c: c.kick(SESSION_ENDED),
        )

    def recheck_person(self, user_id: str) -> None:
        self._each(lambda _, c: c.person.id == user_id, lambda _, c: c.kick(ACCESS_CHANGED))

    def end_public(self, board_id: str | None = None) -> None:
        loop = self._loop
        if loop is None or not loop.is_running():
            return

        def run() -> None:
            for room in list(self._rooms.values()):
                if board_id in (None, room.board_id):
                    for guest in list(room.guests):
                        guest.kick(ACCESS_CHANGED)

        loop.call_soon_threadsafe(run)

    def recheck_board(self, board_id: str) -> None:
        def recheck(room: Room, connection: Connection) -> None:
            asyncio.get_running_loop().create_task(self._recheck(room, connection))

        self._each(lambda room, _: room.board_id == board_id, recheck)

    async def _recheck(self, room: Room, connection: Connection) -> None:
        with contextlib.suppress(Exception):
            role = await anyio.to_thread.run_sync(
                role_on, self._members, connection.person, room.board_id
            )
            if role is not None and (role != "viewer") == connection.can_edit:
                return
        connection.kick(ACCESS_CHANGED)
