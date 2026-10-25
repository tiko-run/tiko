import time
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from pycrdt import (
    Encoder,
    YMessageType,
    YSyncMessageType,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
)
from starlette.websockets import WebSocketDisconnect

from app.config import Settings
from app.domain.boards import BoardDoc
from app.domain.live import PLANNING_CHANGED, LiveDoc, stored_node
from app.main import create_app
from tests.conftest import signed_in

# The apps of its module fixtures keep their people and boards across the tests.
pytestmark = pytest.mark.shared_rows

LONG = "long-enough-password"


def sticky(node_id: str, text: str = "") -> dict:
    return {
        "id": node_id,
        "type": "sticky",
        "position": {"x": 1, "y": 2},
        "data": {"text": text, "color": "yellow"},
    }


class Tab:
    """A browser tab: its own copy of the board, kept in step over the socket."""

    def __init__(self, socket) -> None:
        self.socket = socket
        self.live = LiveDoc()
        self.sent: list[bytes] = []
        self.received: list[bytes] = []
        # No reference to the tab itself: pycrdt objects must die on the thread that made them.
        sent = self.sent
        self.live.doc.observe(lambda event: sent.append(event.update))
        self.sync()

    def send(self, data: bytes) -> None:
        self.socket.send_bytes(data)

    def read(self) -> bytes:
        data = self.socket.receive_bytes()
        self.received.append(data)
        if data[0] == YMessageType.SYNC:
            reply = handle_sync_message(data[1:], self.live.doc)
            if reply:
                self.send(reply)
        return data

    def sync(self) -> None:
        """Asks the server for what this tab lacks; returns once the answer is applied."""
        self.send(create_sync_message(self.live.doc))
        while True:
            data = self.read()
            if data[0] == YMessageType.SYNC and data[1] == YSyncMessageType.SYNC_STEP2:
                return

    def edit(self, change) -> None:
        nodes, edges = self.live.read()
        change(nodes, edges)
        self.sent.clear()
        self.live.write(nodes, edges, origin="tab")
        for update in self.sent:
            self.send(create_update_message(update))

    def add(self, node: dict, order: float = 1) -> None:
        self.edit(lambda nodes, _: nodes.update({node["id"]: stored_node(node, order)}))

    def ids(self) -> set[str]:
        self.sync()
        return set(self.live.read()[0])


class World:
    def __init__(self) -> None:
        self.app = create_app(Settings(db_path=":memory:"))
        self.rooms = self.app.state.live
        self.rooms.save_idle_s = self.rooms.check_delay_s = self.rooms.presence_delay_s = 0.01
        self.clients = {"admin": signed_in(self.app)}
        self.ids = {}
        for name in ("ann", "bob", "carl", "dave"):
            url = self.clients["admin"].post("/api/invites", json={"role": "member"}).json()["url"]
            client = TestClient(self.app)
            client.post(
                f"/api/invites/{url.split('=', 1)[1]}/accept",
                json={"username": name, "name": name.title(), "password": LONG},
            )
            self.clients[name] = client
            self.ids[name] = client.get("/api/auth/status").json()["me"]["id"]
        # One client carries every socket, so all of them live on one event loop like in uvicorn.
        self.sockets = TestClient(self.app)
        self.sockets.__enter__()

    def board(self, nodes: list[dict] | None = None) -> str:
        """ann owns it, bob edits, carl views, dave has no role."""
        ann = self.clients["ann"]
        board_id = ann.post("/api/boards", json={"name": "Sprint"}).json()["id"]
        for name, role in (("bob", "editor"), ("carl", "viewer")):
            url = f"/api/boards/{board_id}/members/{self.ids[name]}"
            assert ann.put(url, json={"role": role}).is_success
        if nodes:
            body = {"version": 1, "doc": {"nodes": nodes, "edges": []}}
            assert ann.put(f"/api/boards/{board_id}", json=body).is_success
        return board_id

    @contextmanager
    def tab(self, who: str, board_id: str, origin: str | None = None):
        cookie = self.clients[who].cookies.get("tiko_session")
        headers = {"cookie": f"tiko_session={cookie}"} if cookie else {}
        if origin:
            headers["origin"] = origin
        with self.sockets.websocket_connect(
            f"/api/boards/{board_id}/live", headers=headers
        ) as socket:
            yield Tab(socket)

    def publish(self, board_id: str) -> str:
        response = self.clients["ann"].put(f"/api/boards/{board_id}/public", json={"public": True})
        return response.json()["public_token"]

    @contextmanager
    def guest(self, token: str):
        """Someone with the public link and no session."""
        found = TestClient(self.app).get(f"/api/public/{token}")
        room = found.json()["room"] if found.is_success else "00"
        with self.sockets.websocket_connect(f"/api/public/{token}/live/{room}") as socket:
            yield Tab(socket)

    def guest_close_code(self, token: str) -> int:
        with pytest.raises(WebSocketDisconnect) as closed, self.guest(token):
            pass
        return closed.value.code

    def close_code(self, who: str, board_id: str, origin: str | None = None) -> int:
        with pytest.raises(WebSocketDisconnect) as closed, self.tab(who, board_id, origin):
            pass
        return closed.value.code

    def send_presence(self, board_id: str) -> None:
        """The room's turn to send presence comes now, not when its clock says so."""
        room = self.rooms._rooms[board_id]
        self.rooms._loop.call_soon_threadsafe(room._send_presence)

    def stored(self, board_id: str) -> dict:
        return self.clients["ann"].get(f"/api/boards/{board_id}").json()


def eventually(check, seconds: float = 3.0):
    """Waits until the check stops failing; a check may assert or return False."""
    deadline = time.monotonic() + seconds
    while True:
        try:
            result = check()
            assert result is not False
            return result
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            time.sleep(0.02)


def closed_with(tab: Tab) -> int:
    with pytest.raises(WebSocketDisconnect) as closed:
        while True:
            tab.read()
    return closed.value.code


@pytest.fixture(scope="module")
def world(monkeypatch_module):
    world = World()
    yield world
    world.sockets.__exit__(None, None, None)


@pytest.fixture(scope="module")
def monkeypatch_module():
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("TIKO_PASSWORD", "test-password")
        yield patch


def test_two_editors_see_each_other_and_the_board_is_saved(world):
    board_id = world.board([sticky("seed")])
    # Read before the edits: the room may save them all before the tabs close.
    before = world.stored(board_id)["version"]
    with world.tab("ann", board_id) as ann, world.tab("bob", board_id) as bob:
        assert ann.ids() == bob.ids() == {"seed"}
        ann.add(sticky("from-ann"))
        bob.add(sticky("from-bob"))
        bob.edit(lambda nodes, _: nodes["seed"]["place"].update(x=300))
        ann.edit(lambda nodes, _: nodes["seed"]["data"].update(text="hello"))
        assert ann.ids() == bob.ids() == {"seed", "from-ann", "from-bob"}
        seed = ann.live.read()[0]["seed"]
        assert seed["place"]["x"] == 300 and seed["data"]["text"] == "hello"

    def saved():
        board = world.stored(board_id)
        assert {node["id"] for node in board["doc"]["nodes"]} == {"seed", "from-ann", "from-bob"}
        assert board["version"] > before
        return board

    eventually(saved)


def test_an_update_reaches_the_other_tab_without_asking(world):
    board_id = world.board()
    with world.tab("ann", board_id) as ann, world.tab("bob", board_id) as bob:
        ann.add(sticky("pushed"))
        data = bob.read()
        assert data[:2] == bytes([YMessageType.SYNC, YSyncMessageType.SYNC_UPDATE])
        assert "pushed" in bob.live.read()[0]


def test_a_viewer_reads_live_and_cannot_write(world):
    board_id = world.board([sticky("seed")])
    with world.tab("carl", board_id) as carl, world.tab("ann", board_id) as ann:
        assert carl.ids() == {"seed"}
        carl.add(sticky("forged"))
        carl.edit(lambda nodes, _: nodes.pop("seed"))
        # Sync step 2 is the other way to write; it is dropped as well.
        carl.send(
            bytes([YMessageType.SYNC, YSyncMessageType.SYNC_STEP2])
            + create_update_message(carl.live.state())[2:]
        )
        assert ann.ids() == {"seed"}
        ann.add(sticky("real"))
        with world.tab("carl", board_id) as fresh:
            assert fresh.ids() == {"seed", "real"}


@pytest.mark.parametrize(
    ("who", "can_read", "can_write"),
    [("admin", True, True), ("ann", True, True), ("bob", True, True), ("carl", True, False)],
)
def test_socket_access_matrix(world, who, can_read, can_write):
    board_id = world.board([sticky("seed")])
    with world.tab(who, board_id) as tab:
        assert ("seed" in tab.ids()) is can_read
        tab.add(sticky("mine"))
    with world.tab("ann", board_id) as ann:
        assert ("mine" in ann.ids()) is can_write


def test_no_role_no_session_and_a_foreign_origin_get_nothing(world):
    board_id = world.board([sticky("seed")])
    assert world.close_code("dave", board_id) == 4403
    assert world.close_code("ann", "0" * 32) == 4403
    world.clients["nobody"] = TestClient(world.app)
    assert world.close_code("nobody", board_id) == 1008
    assert world.close_code("ann", board_id, origin="https://evil.example") == 1008
    with world.tab("ann", board_id, origin="http://testserver") as ann:
        assert ann.ids() == {"seed"}


def test_a_merge_that_breaks_the_rules_is_repaired_for_everyone(world):
    frame = {"id": "frame", "type": "frame", "position": {"x": 100, "y": 200}, "data": {}}
    board_id = world.board([frame])
    with world.tab("ann", board_id) as ann, world.tab("bob", board_id) as bob:
        assert bob.ids() == {"frame"}
        bob.add({**sticky("card"), "parentId": "frame"})
        ann.edit(lambda nodes, _: nodes.pop("frame"))

        def repaired():
            assert ann.ids() == bob.ids() == {"card"}
            assert bob.live.read()[0]["card"]["place"] == {"x": 101, "y": 202}

        eventually(repaired)
        bob.add({**sticky("huge"), "data": {"text": "x" * 6000, "color": "yellow"}})
        eventually(lambda: bob.ids() == {"card"})
    doc = eventually(lambda: world.stored(board_id))["doc"]
    BoardDoc.model_validate(doc)


def test_a_board_from_before_live_opens_with_the_same_content_and_keeps_its_history(world):
    board_id = world.board()
    boards = world.app.state.boards
    old = BoardDoc.model_validate({"nodes": [sticky("a", "old"), sticky("b")], "edges": []})
    boards.save(board_id, 1, old)
    assert boards.load(board_id)[1] is None
    with world.tab("ann", board_id) as ann:
        assert ann.ids() == {"a", "b"}
        offline = LiveDoc(ann.live.state())
    eventually(lambda: boards.load(board_id)[1] is not None)
    world.rooms.idle_s = 0
    with world.tab("ann", board_id):
        pass
    eventually(lambda: board_id not in world.rooms._rooms)
    world.rooms.idle_s = 30
    # A tab that was offline while the room was dropped merges without doubling the board.
    nodes, edges = offline.read()
    nodes["c"] = stored_node(sticky("c"), 5)
    offline.write(nodes, edges, origin="tab")
    with world.tab("ann", board_id) as back:
        back.send(create_update_message(offline.state()))
        assert back.ids() == {"a", "b", "c"}
    assert world.stored(board_id)["doc"]["nodes"][0]["data"]["text"] == "old"


def test_put_goes_through_the_open_room(world):
    board_id = world.board([sticky("seed")])
    ann_rest = world.clients["ann"]
    with world.tab("bob", board_id) as bob:
        assert bob.ids() == {"seed"}
        version = world.stored(board_id)["version"]
        body = {"version": version, "doc": {"nodes": [sticky("seed"), sticky("rest")], "edges": []}}
        saved = ann_rest.put(f"/api/boards/{board_id}", json=body)
        assert saved.json() == {"version": version + 1}
        assert bob.ids() == {"seed", "rest"}
        stale = ann_rest.put(f"/api/boards/{board_id}", json=body)
        assert stale.status_code == 409 and stale.json()["error"]["code"] == "version_conflict"
    without_room = world.board([sticky("seed")])
    body = {"version": 2, "doc": {"nodes": [], "edges": []}}
    assert ann_rest.put(f"/api/boards/{without_room}", json=body).json() == {"version": 3}
    assert ann_rest.put(f"/api/boards/{without_room}", json=body).status_code == 409


def test_a_mass_delete_is_logged_with_its_source(world, caplog):
    many = [sticky(f"s{i}") for i in range(60)]
    board_id = world.board(many)
    with (
        caplog.at_level("WARNING", logger="app.adapters.live.rooms"),
        world.tab("bob", board_id) as bob,
    ):
        bob.edit(lambda nodes, _: [nodes.pop(f"s{i}") for i in range(10)])
        bob.edit(lambda nodes, _: nodes.clear())
        eventually(lambda: "removed 50 of 50 nodes" in caplog.text)
        # The room saves the empty board on its own timer; the next save goes on top of it.
        saved = eventually(
            lambda: world.stored(board_id)["doc"]["nodes"] == [] and world.stored(board_id)
        )
        version = saved["version"]
        body = {"version": version, "doc": {"nodes": many, "edges": []}}
        assert world.clients["ann"].put(f"/api/boards/{board_id}", json=body).is_success
        body = {"version": version + 1, "doc": {"nodes": [], "edges": []}}
        assert world.clients["ann"].put(f"/api/boards/{board_id}", json=body).is_success
    lines = [r.getMessage() for r in caplog.records if "removed" in r.getMessage()]
    assert lines == [
        f"live board {board_id}: an update from user {world.ids['bob']} removed 50 of 50 nodes",
        f"live board {board_id}: a REST save removed 60 of 60 nodes",
    ]


def presence(client: int, clock: int, state: str) -> bytes:
    encoder = Encoder()
    for value in (1, client, clock):
        encoder.write_var_uint(value)
    encoder.write_var_string(state)
    return create_awareness_message(encoder.to_bytes())


def test_presence_is_relayed_handed_to_newcomers_and_cleared_on_leave(world):
    board_id = world.board()
    hello = presence(7, 1, '{"user":{"name":"Carl"}}')
    with world.tab("ann", board_id) as ann:
        with world.tab("carl", board_id) as carl:
            carl.send(hello)
            assert ann.read() == hello
            # Echoed to the sender: the heartbeat that keeps a lone tab's provider connected.
            assert carl.read() == hello
            with world.tab("bob", board_id) as bob:
                assert hello in bob.received
        assert ann.read() == presence(7, 2, "null")
    assert world.stored(board_id)["doc"]["nodes"] == []


def moves(clocks: range) -> list[bytes]:
    return [presence(7, clock, f'{{"cursor":{{"x":{clock},"y":0}}}}') for clock in clocks]


# A window no runner is slow enough to outlast: the tests say when the room's turn comes.
NEVER = 3600


def test_a_burst_of_presence_is_one_frame_with_the_latest_state(world, monkeypatch):
    board_id = world.board()
    monkeypatch.setattr(world.rooms, "presence_delay_s", NEVER)
    with world.tab("ann", board_id) as ann, world.tab("carl", board_id) as carl:
        first, *burst = moves(range(1, 22))
        for move in (first, *burst):
            carl.send(move)
        # Answered after the moves, so the room has heard them all.
        carl.sync()
        world.send_presence(board_id)
        # After a pause the first move leaves at once; the twenty behind it are one frame.
        assert ann.read() == first and first in carl.received
        assert ann.read() == burst[-1] and carl.read() == burst[-1]
        # Nothing of the burst is left behind: the next frame is the next move.
        after = moves(range(22, 23))[0]
        carl.send(after)
        carl.sync()
        world.send_presence(board_id)
        assert ann.read() == after


def test_a_busy_room_sends_presence_at_its_own_pace(world, monkeypatch):
    board_id = world.board()
    monkeypatch.setattr(world.rooms, "presence_busy_from", 2)
    monkeypatch.setattr(world.rooms, "presence_busy_delay_s", NEVER)
    with world.tab("ann", board_id) as ann:
        first, *burst = moves(range(1, 22))
        # Alone the room is not busy: nothing holds a move back.
        ann.send(first)
        assert ann.read() == first
        with world.tab("carl", board_id) as carl:
            assert first in carl.received
            for move in burst:
                ann.send(move)
            ann.sync()
            world.send_presence(board_id)
            assert carl.read() == burst[-1]


def test_presence_of_several_tabs_is_one_frame(world, monkeypatch):
    board_id = world.board()
    monkeypatch.setattr(world.rooms, "presence_delay_s", NEVER)
    with (
        world.tab("ann", board_id) as ann,
        world.tab("bob", board_id) as bob,
        world.tab("carl", board_id) as carl,
    ):
        ann.send(presence(6, 1, '{"user":{"name":"Ann"}}'))
        assert b"Ann" in ann.read()
        bob.send(presence(8, 1, '{"user":{"name":"Bob"}}'))
        carl.send(presence(7, 1, '{"user":{"name":"Carl"}}'))
        bob.sync()
        carl.sync()
        world.send_presence(board_id)
        frame = ann.read()
        assert b"Bob" in frame and b"Carl" in frame
        for tab in (bob, carl):
            while (heard := tab.read()) != frame:
                assert b"Ann" in heard


def test_presence_heard_before_an_edit_leaves_before_it(world, monkeypatch):
    board_id = world.board()
    with world.tab("ann", board_id) as ann, world.tab("bob", board_id) as bob:
        bob.send(presence(8, 1, '{"user":{"name":"Bob"}}'))
        ann.read()
        monkeypatch.setattr(world.rooms, "presence_delay_s", NEVER)
        drag = presence(8, 2, '{"drag":{"a":{"x":1,"y":2}}}')
        bob.send(drag)
        bob.add(sticky("a"))
        assert ann.read() == drag
        assert ann.read()[0] == YMessageType.SYNC


def test_leaving_is_told_at_once(world, monkeypatch):
    board_id = world.board()
    with world.tab("ann", board_id) as ann:
        ann.send(presence(6, 1, '{"user":{"name":"Ann"}}'))
        ann.read()
        # A frame has just left, so whatever comes next waits for its turn.
        monkeypatch.setattr(world.rooms, "presence_delay_s", NEVER)
        with world.tab("bob", board_id) as bob:
            bob.send(presence(8, 1, '{"user":{"name":"Bob"}}'))
            # The room has heard Bob before he goes; no frame with him has left yet.
            bob.sync()
        assert ann.read() == presence(8, 2, "null")
        with world.tab("bob", board_id) as bob:
            # A closing tab says goodbye itself, and that does not wait for the next frame.
            bob.send(presence(9, 1, "null"))
            bob.sync()
        assert ann.read() == presence(9, 1, "null")


def test_a_tab_speaks_only_for_itself_in_presence(world):
    """Browsers send back every presence change they hear; that must not make it theirs."""
    board_id = world.board()
    hello = presence(7, 1, '{"user":{"name":"Carl"}}')
    with world.tab("ann", board_id) as ann, world.tab("carl", board_id) as carl:
        carl.send(hello)
        assert ann.read() == hello and carl.read() == hello
        with world.tab("bob", board_id) as bob:
            # Bob's browser repeats Carl's state, and tries to move Carl's cursor.
            bob.send(hello)
            bob.send(presence(7, 9, '{"user":{"name":"Not Carl"}}'))
            bob.send(presence(8, 1, '{"user":{"name":"Bob"}}'))
            assert ann.read() == presence(8, 1, '{"user":{"name":"Bob"}}')
        # Bob leaves: only his own state goes, Carl's stays.
        assert ann.read() == presence(8, 2, "null")
        with world.tab("bob", board_id) as back:
            assert hello in back.received


def test_access_changes_reach_open_sockets(world):
    ann_rest, ids = world.clients["ann"], world.ids
    board_id = world.board()
    members = f"/api/boards/{board_id}/members"
    with (
        world.tab("bob", board_id) as bob,
        world.tab("carl", board_id) as carl,
        world.tab("ann", board_id) as ann,
    ):
        ann_rest.put(f"{members}/{ids['bob']}", json={"role": "viewer"})
        assert closed_with(bob) == 4403
        ann_rest.delete(f"{members}/{ids['carl']}")
        assert closed_with(carl) == 4403
        # Nothing changed for the owner, so her socket stays.
        assert ann.ids() == set()
    with world.tab("bob", board_id) as bob, world.tab("ann", board_id) as ann:
        bob.add(sticky("as-viewer"))
        bob.sync()
        assert ann.ids() == set()
    with world.tab("ann", board_id) as ann:
        ann_rest.delete(f"/api/boards/{board_id}")
        assert closed_with(ann) == 4403


def test_ended_sessions_close_sockets(world):
    board_id = world.board()
    with world.tab("bob", board_id) as bob:
        world.clients["bob"].post("/api/auth/logout-all")
        assert closed_with(bob) == 4401
    world.clients["bob"].post("/api/auth/login", json={"username": "bob", "password": LONG})
    with world.tab("bob", board_id) as bob:
        world.clients["admin"].patch(f"/api/accounts/{world.ids['bob']}", json={"disabled": True})
        assert closed_with(bob) == 4401
    world.clients["admin"].patch(f"/api/accounts/{world.ids['bob']}", json={"disabled": False})


def test_limits(world):
    board_id = world.board()
    with world.tab("ann", board_id) as ann:
        ann.send(b"\x00" * (1024 * 1024 + 1))
        assert closed_with(ann) == 1009
    with world.tab("ann", board_id) as ann:
        ann.send(b"\x00\x02\xff\xff\xff")
        assert closed_with(ann) == 1008
    world.rooms._rooms[board_id].connections.update(object() for _ in range(30))
    try:
        assert world.close_code("ann", board_id) == 4429
    finally:
        room = world.rooms._rooms[board_id]
        room.connections = {c for c in room.connections if hasattr(c, "push")}


def test_shutdown_saves_open_boards_and_tells_tabs_to_come_back(world):
    app = create_app(Settings(db_path=":memory:"))
    admin = signed_in(app)
    board_id = admin.post("/api/boards", json={"name": "Sprint"}).json()["id"]
    app.state.live.save_idle_s = 60
    headers = {"cookie": f"tiko_session={admin.cookies.get('tiko_session')}"}
    sockets = TestClient(app)
    sockets.__enter__()
    with sockets.websocket_connect(f"/api/boards/{board_id}/live", headers=headers) as socket:
        tab = Tab(socket)
        tab.add(sticky("unsaved"))
        tab.sync()
        sockets.portal.call(app.state.live.shutdown)
        assert closed_with(tab) == 1012
    sockets.__exit__(None, None, None)
    assert [n["id"] for n in admin.get(f"/api/boards/{board_id}").json()["doc"]["nodes"]] == [
        "unsaved"
    ]


def test_a_guest_sees_edits_live_and_changes_nothing(world):
    board_id = world.board([sticky("a")])
    token = world.publish(board_id)
    with world.tab("ann", board_id) as ann, world.guest(token) as guest:
        assert guest.ids() == {"a"}
        ann.add(sticky("b"), order=2)
        ann.sync()
        # Pushed to the guest, who did not ask.
        update = guest.read()
        assert (update[0], update[1]) == (YMessageType.SYNC, YSyncMessageType.SYNC_UPDATE)
        assert set(guest.live.read()[0]) == {"a", "b"}
        guest.add(sticky("forged"), order=3)
        guest.sync()
        assert ann.ids() == {"a", "b"}
    eventually(lambda: len(world.stored(board_id)["doc"]["nodes"]) == 2)


def test_a_guest_gets_no_presence_and_gives_none(world):
    board_id = world.board()
    token = world.publish(board_id)
    with world.tab("ann", board_id) as ann:
        ann.send(presence(7, 1, '{"user":{"name":"Ann"}}'))
        ann.read()
        with world.guest(token) as guest:
            guest.send(presence(9, 1, '{"user":{"name":"Guest"}}'))
            ann.send(presence(7, 2, '{"user":{"name":"Ann"},"cursor":{"x":1,"y":2}}'))
            ann.read()
            ann.add(sticky("a"))
            guest.ids()
            assert all(data[0] == YMessageType.SYNC for data in guest.received)
            assert not any(b"Ann" in data for data in guest.received)
        # A guest coming and going is not seen by the people on the board.
        ann.sync()
        assert not any(b"Guest" in data for data in ann.received)
        assert sum(data[0] == YMessageType.AWARENESS for data in ann.received) == 2


def test_a_dead_link_closes_guest_sockets(world):
    ann, admin = world.clients["ann"], world.clients["admin"]
    board_id = world.board()
    public = f"/api/boards/{board_id}/public"
    token = world.publish(board_id)
    with world.guest(token) as guest, world.tab("ann", board_id) as owner:
        ann.put(public, json={"public": False})
        assert closed_with(guest) == 4403
        assert owner.ids() == set()
    assert world.guest_close_code(token) == 4403
    assert world.guest_close_code("no-such-link") == 4403

    token = world.publish(board_id)
    with world.guest(token) as guest:
        admin.put("/api/settings", json={"public_links": False})
        assert closed_with(guest) == 4403
    assert world.guest_close_code(token) == 4403
    admin.put("/api/settings", json={"public_links": True})

    with world.guest(token) as guest:
        # The name comes with the board, so a rename sends guests to read it again.
        ann.patch(f"/api/boards/{board_id}", json={"name": "Plan"})
        assert closed_with(guest) == 4403
    with world.guest(token) as guest:
        ann.delete(f"/api/boards/{board_id}")
        assert closed_with(guest) == 4403


def test_guests_have_places_of_their_own(world):
    board_id = world.board()
    token = world.publish(board_id)
    with world.guest(token) as guest:
        room = world.rooms._rooms[board_id]
        # A board full of people still takes a guest, and a board full of guests takes people.
        room.connections.update(object() for _ in range(30))
        try:
            with world.guest(token) as another:
                assert another.ids() == set()
        finally:
            room.connections.clear()
        places = {object() for _ in range(199)}
        room.guests.update(places)
        try:
            assert world.guest_close_code(token) == 4429
            with world.tab("ann", board_id) as ann:
                assert ann.ids() == set()
        finally:
            room.guests -= places
        assert guest.ids() == set()


def test_a_planning_change_reaches_every_open_board_but_not_guests(world):
    first, second = world.board(), world.board()
    token = world.publish(first)
    admin = world.clients["admin"]
    with (
        world.tab("ann", first) as ann,
        world.tab("ann", second) as other,
        world.guest(token) as guest,
    ):
        admin.patch("/api/planning", json={"enabled": True})
        for tab in (ann, other):
            while tab.read() != bytes([PLANNING_CHANGED]):
                pass
        ann.add(sticky("after"))
        ann.sync()
        # The guest's next message is the edit, not the planning change.
        assert guest.read()[0] == YMessageType.SYNC
