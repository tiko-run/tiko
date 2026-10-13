import os
import socket
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import httpx
import pytest
from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect

from app.adapters.live.workers import owner
from app.adapters.storage.lock import FileLock
from app.adapters.storage.sqlite import Database, SqliteAttempts
from app.domain.accounts import PER_USERNAME_FAILURES
from app.domain.attempts import MemoryAttempts
from app.domain.live import GOING_AWAY, SESSION_ENDED
from tests.conftest import PASSWORD
from tests.test_live import Tab, sticky

BACKEND = Path(__file__).parents[1]


def _free_ports() -> int:
    """A port whose next one is free too: the second process listens there."""
    for _ in range(50):
        with socket.socket() as first, socket.socket() as second:
            first.bind(("127.0.0.1", 0))
            port = first.getsockname()[1]
            try:
                second.bind(("127.0.0.1", port + 1))
            except OSError:
                continue
            return port
    raise RuntimeError("no two free ports in a row")


class Instance:
    """tiko as two processes, each asked on its own port like the proxy does."""

    def __init__(self, port: int) -> None:
        self.ports = (port, port + 1)

    def client(self, worker: int) -> httpx.Client:
        return httpx.Client(base_url=f"http://127.0.0.1:{self.ports[worker]}", timeout=10)

    def sign_in(self, worker: int = 0) -> httpx.Client:
        client = self.client(worker)
        body = {"username": "admin", "password": PASSWORD}
        assert client.post("/api/auth/login", json=body).status_code == 204
        return client

    def board(self, client: httpx.Client, worker: int) -> str:
        """A board whose room belongs to this process."""
        for _ in range(200):
            board_id = client.post("/api/boards", json={"name": "Sprint"}).json()["id"]
            if owner(board_id, 2) == worker:
                return board_id
        raise RuntimeError("no board for the process")

    @contextmanager
    def socket(self, worker: int, board_id: str, session: str):
        url = f"ws://127.0.0.1:{self.ports[worker]}/api/boards/{board_id}/live"
        with connect(url, additional_headers={"Cookie": f"tiko_session={session}"}) as conn:
            yield conn


class _Socket:
    """A socket of the `websockets` client with the two methods `Tab` asks for."""

    def __init__(self, conn) -> None:
        self._conn = conn

    def send_bytes(self, data: bytes) -> None:
        self._conn.send(data)

    def receive_bytes(self) -> bytes:
        return self._conn.recv(timeout=10)


def _close_code(conn) -> int:
    with pytest.raises(ConnectionClosed) as closed:
        while True:
            conn.recv(timeout=10)
    return closed.value.rcvd.code


@pytest.fixture(scope="module")
def instance(tmp_path_factory):
    port = _free_ports()
    env = {
        **os.environ,
        "TIKO_WORKERS": "2",
        "DB_PATH": str(tmp_path_factory.mktemp("workers") / "app.db"),
        "TIKO_PASSWORD": PASSWORD,
        "UPDATE_CHECK": "false",
    }
    process = subprocess.Popen(
        [sys.executable, "-m", "app.serve", "--port", str(port)], cwd=BACKEND, env=env
    )
    found = Instance(port)
    try:
        deadline = time.monotonic() + 60
        while True:
            try:
                if all(found.client(n).get("/health").is_success for n in (0, 1)):
                    break
            except httpx.TransportError:
                pass
            assert process.poll() is None and time.monotonic() < deadline, "tiko did not start"
            time.sleep(0.2)
        yield found
    finally:
        process.terminate()
        process.wait(30)


def test_signing_out_everywhere_closes_a_socket_in_the_other_process(instance):
    admin = instance.sign_in(0)
    session = admin.cookies["tiko_session"]
    board_id = instance.board(admin, 1)
    other = instance.client(1)
    other.cookies.set("tiko_session", session)
    # The other process now keeps the session in its 30 s cache.
    assert other.get("/api/auth/status").json()["me"]
    with instance.socket(1, board_id, session) as conn:
        assert admin.post("/api/auth/logout-all").status_code == 204
        assert _close_code(conn) == SESSION_ENDED
    assert not other.get("/api/auth/status").json()["me"]


def test_a_rest_save_reaches_a_tab_of_a_board_open_in_the_other_process(instance):
    admin = instance.sign_in(0)
    board_id = instance.board(admin, 1)
    with instance.socket(1, board_id, admin.cookies["tiko_session"]) as conn:
        tab = Tab(_Socket(conn))
        body = {"version": 1, "doc": {"nodes": [sticky("a")], "edges": []}}
        saved = admin.put(f"/api/boards/{board_id}", json=body)
        assert saved.status_code == 200 and saved.json()["version"] == 2
        assert tab.ids() == {"a"}
        # The answer of the other process comes back as it is: a stale version is a conflict.
        assert admin.put(f"/api/boards/{board_id}", json=body).status_code == 409


def test_a_socket_that_reaches_the_wrong_process_is_sent_back(instance):
    admin = instance.sign_in(0)
    board_id = instance.board(admin, 1)
    with instance.socket(0, board_id, admin.cookies["tiko_session"]) as conn:
        assert _close_code(conn) == GOING_AWAY


def test_wrong_passwords_are_counted_across_processes(instance):
    wrong = {"username": "nobody", "password": "wrong-password"}
    clients = [instance.client(0), instance.client(1)]
    for attempt in range(PER_USERNAME_FAILURES):
        assert clients[attempt % 2].post("/api/auth/login", json=wrong).status_code == 401
    for client in clients:
        assert client.post("/api/auth/login", json=wrong).status_code == 429


@pytest.mark.parametrize(
    ("board_id", "process"),
    [("0f3a00", 0), ("0f3a01", 1), ("0f3aA3", 163 % 3), ("0f3aff", 0), ("x", 0), ("zz", 0)],
)
def test_the_end_of_an_id_names_the_process_of_a_board(board_id, process):
    assert owner(board_id, 3) == process


def test_a_file_lock_holds_one_thread_at_a_time(tmp_path):
    lock = FileLock(str(tmp_path / "lock"))
    inside = overlaps = 0

    def enter() -> None:
        nonlocal inside, overlaps
        for _ in range(50):
            with lock:
                inside += 1
                overlaps += inside > 1
                time.sleep(0)
                inside -= 1

    threads = [threading.Thread(target=enter) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert overlaps == 0


@pytest.fixture(params=["memory", "sqlite"])
def attempts(request):
    return MemoryAttempts() if request.param == "memory" else SqliteAttempts(Database(":memory:"))


def test_failures_are_counted_in_a_sliding_window(attempts):
    for at in (1.0, 2.0, 3.0):
        attempts.add("s", "k", at, since=at - 10)
    assert attempts.recent("s", "k", since=0.0) == (3, 1.0)
    assert attempts.recent("s", "k", since=1.0) == (2, 2.0)
    assert attempts.recent("s", "other", since=0.0) == (0, 0.0)
    assert attempts.recent("other", "k", since=0.0) == (0, 0.0)
    # Adding forgets what is older than the window.
    attempts.add("s", "k", 13.0, since=3.0)
    assert attempts.recent("s", "k", since=0.0) == (1, 13.0)


def test_a_budget_counts_and_checks_in_one_step(attempts):
    assert attempts.add_under("s", "k", 2, 1.0, since=-9.0) is None
    assert attempts.add_under("s", "k", 2, 2.0, since=-8.0) is None
    assert attempts.add_under("s", "k", 2, 3.0, since=-7.0) == 1.0
    assert attempts.add_under("s", "other", 2, 3.0, since=-7.0) is None
    assert attempts.add_under("s", "k", 2, 11.5, since=1.5) is None


def test_a_window_opens_at_its_first_request(attempts):
    assert attempts.spend("s", "k", 2, 60.0, 100.0) is None
    assert attempts.spend("s", "k", 2, 60.0, 130.0) is None
    assert attempts.spend("s", "k", 2, 60.0, 159.0) == 100.0
    assert attempts.spend("s", "other", 2, 60.0, 159.0) is None
    assert attempts.spend("s", "k", 2, 60.0, 160.0) is None
    attempts.spend("s", "k", 2, 60.0, 161.0)
    attempts.drop("s", "k")
    assert attempts.spend("s", "k", 2, 60.0, 162.0) is None
