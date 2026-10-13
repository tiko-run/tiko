import threading
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.adapters.storage import sqlite
from app.api.gate import COOKIE
from app.config import Settings
from app.domain import boards as board_service
from app.domain import demo
from app.domain.errors import BoardLimit
from app.main import create_app
from tests.conftest import signed_in
from tests.jira_fake import FakeJira

DAY = 24 * 3600
STICKY = {
    "id": "note",
    "type": "sticky",
    "position": {"x": 1, "y": 2},
    "width": 200,
    "height": 200,
    "data": {"text": "mine", "color": "yellow"},
}


@pytest.fixture
def app():
    return create_app(Settings(db_path=":memory:", tiko_demo=True))


def visitor(app, address: str = "203.0.113.1") -> TestClient:
    client = TestClient(app)
    response = client.post("/api/auth/demo", headers={"x-real-ip": address})
    assert response.status_code == 204, response.text
    return client


def me(client: TestClient) -> dict:
    return client.get("/api/auth/status").json()["me"]


def welcome(client: TestClient) -> str:
    return client.get("/api/boards").json()["boards"][0]["id"]


def edit(client: TestClient, board_id: str) -> None:
    body = {"version": 1, "doc": {"nodes": [STICKY], "edges": []}}
    assert client.put(f"/api/boards/{board_id}", json=body).is_success


def together(count: int, work) -> list:
    """Runs `work(index)` on `count` threads that start at once; returns results and errors."""
    start, results = threading.Barrier(count), []

    def run(index: int) -> None:
        start.wait()
        try:
            results.append(work(index))
        except Exception as error:
            results.append(error)

    threads = [threading.Thread(target=run, args=(index,)) for index in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return results


def slow_add(app, monkeypatch) -> None:
    """Makes adding a person slow, so requests that start together overlap for sure."""
    users = app.state.visitors._users
    add = users.add

    def slow(person, password_hash):
        time.sleep(0.05)
        add(person, password_hash)

    monkeypatch.setattr(users, "add", slow)


def rows(app) -> str:
    """Everything the database holds, as text."""
    db = app.state.boards._db
    with db.transaction() as conn:
        tables = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        found = [conn.execute(f"SELECT * FROM {t['name']}").fetchall() for t in tables]
    return repr([tuple(row) for table in found for row in table])


def test_without_the_switch_nothing_is_there(client):
    assert client.get("/api/auth/status").json().keys() == {"signed_in", "me"}
    assert TestClient(client.app).post("/api/auth/demo").status_code == 404
    assert client.post("/api/auth/demo").status_code == 404


T_ANN = "-".join(["ann", "token", "for", "tests"])
JIRA_URL = "https://jira.example.com"


@pytest.fixture
def jira_app():
    """Demo visitors on an instance whose people work with Jira."""
    fake = FakeJira()
    fake.tokens = {T_ANN: {"DEV-1"}}
    settings = Settings(
        db_path=":memory:",
        tiko_demo=True,
        tiko_tracker="jira",
        jira_base_url=JIRA_URL,
        tiko_secret_key="test-secret-key",
    )
    return create_app(settings, jira_transport=httpx.MockTransport(fake))


def resolve(client: TestClient, ref: str):
    return client.post("/api/tasks/resolve", json={"ref": ref})


def test_a_visitor_works_on_the_demo_tasks_next_to_a_tracker(jira_app):
    ann = visitor(jira_app)
    settings = ann.get("/api/settings").json()
    assert settings["provider"] == "demo" and settings["locked"] == []
    assert settings["jira"] == {"base_url": None, "token_state": "none"}
    assert ann.get("/api/me/tracker").json() == {
        "provider": "demo",
        "base_url": None,
        "token_state": "none",
        "github_token_state": "none",
    }
    assert JIRA_URL not in ann.get("/api/settings").text
    assert resolve(ann, "DEMO-1").json()["task"]["source"] == "demo"
    assert not resolve(ann, "DEV-1").is_success
    board_id = welcome(ann)
    assert ann.get(f"/api/boards/{board_id}").json()["default_source"] == "demo"
    sources = ann.post(f"/api/boards/{board_id}/refresh").json()["sources"]
    assert [source["id"] for source in sources] == ["demo"]


def test_a_visitor_cannot_reach_the_tracker(jira_app):
    ann = visitor(jira_app)
    assert ann.put("/api/me/tracker", json={"token": T_ANN}).status_code == 403
    for body in ({}, {"token": T_ANN}, {"base_url": "https://internal.example", "token": "x"}):
        assert ann.post("/api/settings/jira/test", json=body).status_code == 403


def test_after_sign_up_the_person_connects_their_tracker(jira_app):
    ann = visitor(jira_app)
    board_id = welcome(ann)
    sign_up(ann)
    assert ann.get("/api/settings").json()["jira"]["base_url"] == JIRA_URL
    assert ann.put("/api/me/tracker", json={"token": T_ANN}).json()["token_state"] == "set"
    assert resolve(ann, "DEV-1").json()["task"]["source"] == "jira"
    # The cards of the demo days name their tracker, so they stay what they were.
    assert ann.get(f"/api/boards/{board_id}").json()["default_source"] == "jira"
    tasks = ann.post(f"/api/boards/{board_id}/refresh").json()["tasks"]
    assert tasks and {task["source"] for task in tasks.values()} == {"demo"}
    assert all(task["state"] == "ok" for task in tasks.values())
    # The address the server calls is the admin's to pick.
    other = {"base_url": "https://internal.example", "token": T_ANN}
    assert ann.post("/api/settings/jira/test", json=other).status_code == 403
    assert ann.post("/api/settings/jira/test", json={}).json()["ok"]


def notes(client: TestClient) -> str:
    return client.get(f"/api/boards/{welcome(client)}").text


def test_only_a_visitor_gets_the_demo_note(app):
    assert "This is a demo" in notes(visitor(app))
    admin = signed_in(app)
    assert "This is a demo" not in notes(admin) and "Connect your tracker" in notes(admin)


def test_one_request_makes_a_person_with_a_board_they_can_edit(app):
    assert TestClient(app).get("/api/auth/status").json() == {
        "signed_in": False,
        "me": None,
        "demo": True,
    }
    client = visitor(app)
    person = me(client)
    assert person["role"] == "member" and person["name"] == "Demo visitor"
    assert person["demo_expires_at"]
    boards = client.get("/api/boards").json()["boards"]
    assert [board["name"] for board in boards] == ["Welcome to tiko"]
    edit(client, boards[0]["id"])


def test_a_session_in_hand_makes_nobody(app):
    client = visitor(app)
    first = me(client)["id"]
    assert client.post("/api/auth/demo").status_code == 204
    assert me(client)["id"] == first
    admin = signed_in(app)
    assert admin.post("/api/auth/demo").status_code == 204
    assert me(admin)["username"] == "admin"


def test_a_demo_visitor_cannot_sign_in_by_password(app):
    username = me(visitor(app))["username"]
    for password in ("!", "", "anything-long-enough"):
        response = TestClient(app).post(
            "/api/auth/login", json={"username": username, "password": password}
        )
        assert response.status_code == 401


def test_visitors_see_nothing_of_each_other(app):
    ann, bob = visitor(app), visitor(app, "203.0.113.2")
    board_id = welcome(ann)
    edit(ann, board_id)
    assert board_id not in [b["id"] for b in bob.get("/api/boards").json()["boards"]]
    save = {"version": 2, "doc": {"nodes": [], "edges": []}}
    for method, path, body in [
        ("get", f"/api/boards/{board_id}", None),
        ("put", f"/api/boards/{board_id}", save),
        ("patch", f"/api/boards/{board_id}", {"name": "Taken"}),
        ("delete", f"/api/boards/{board_id}", None),
        ("post", f"/api/boards/{board_id}/refresh", None),
        ("get", f"/api/boards/{board_id}/members", None),
    ]:
        assert bob.request(method, path, json=body).status_code == 404, path
    assert bob.get("/api/people").status_code == 403
    assert bob.get("/api/people/directory").json() == {"people": []}
    assert bob.get("/api/people/directory?q=admin").json() == {"people": []}
    assert ann.get(f"/api/boards/{board_id}").json()["doc"]["nodes"][0]["id"] == "note"

    with TestClient(app) as sockets:
        cookie = bob.cookies.get("tiko_session")
        with (
            pytest.raises(WebSocketDisconnect) as closed,
            sockets.websocket_connect(
                f"/api/boards/{board_id}/live", headers={"cookie": f"tiko_session={cookie}"}
            ) as socket,
        ):
            socket.receive_bytes()
        assert closed.value.code == 4403


def test_nobody_is_shown_a_demo_visitor(app):
    ann = visitor(app)
    board_id = welcome(ann)
    admin = signed_in(app)
    assert [p["username"] for p in admin.get("/api/people").json()["people"]] == ["admin"]
    # On a demo instance the picker answers a whole username and nothing else.
    assert admin.get("/api/people/directory").json() == {"people": []}
    assert admin.get("/api/people/directory?q=adm").json() == {"people": []}
    found = admin.get("/api/people/directory?q=Admin").json()["people"]
    assert [p["username"] for p in found] == ["admin"]
    listed = admin.get("/api/boards").json()
    assert board_id not in [b["id"] for b in listed["boards"] + listed["all"]]
    # By its address the board still opens for an admin.
    assert admin.get(f"/api/boards/{board_id}").status_code == 200
    change = admin.patch(f"/api/people/{me(ann)['id']}", json={"role": "admin"})
    assert change.status_code == 404


def test_what_a_demo_visitor_is_refused(app):
    ann = visitor(app)
    board_id = welcome(ann)
    admin_id = me(signed_in(app))["id"]
    password = {"current": "!", "new": "long-enough-password"}
    for method, path, body in [
        ("put", f"/api/boards/{board_id}/members/{admin_id}", {"role": "editor"}),
        ("delete", f"/api/boards/{board_id}/members/{admin_id}", None),
        ("put", f"/api/boards/{board_id}/everyone", {"role": "viewer"}),
        ("put", f"/api/boards/{board_id}/public", {"public": True}),
        ("post", f"/api/boards/{board_id}/transfer", {"user_id": admin_id}),
        ("patch", "/api/me", {"username": "ann"}),
        ("put", "/api/me/password", password),
        ("put", "/api/me/tracker", {"token": "secret"}),
        ("post", "/api/invites", {"role": "member"}),
    ]:
        response = ann.request(method, path, json=body)
        assert response.status_code == 403, path
        assert response.json()["error"]["code"] == "forbidden"
    assert ann.get(f"/api/boards/{board_id}/members").json()["public"] is False


def test_a_demo_instance_has_no_everyone_role(app):
    admin = signed_in(app)
    board_id = admin.post("/api/boards", json={"name": "Roadmap"}).json()["id"]
    assert admin.put(f"/api/boards/{board_id}/everyone", json={"role": "viewer"}).status_code == 403
    # Taking it away is allowed: the board may have been shared before the demo was turned on.
    assert admin.put(f"/api/boards/{board_id}/everyone", json={"role": None}).status_code == 204
    # An admin still publishes a board, as on any instance.
    assert admin.put(f"/api/boards/{board_id}/public", json={"public": True}).json()["public"]


def test_a_board_shared_with_everyone_before_the_demo_stays_closed_to_visitors(app):
    admin = signed_in(app)
    board_id = admin.post("/api/boards", json={"name": "Roadmap"}).json()["id"]
    # As it was left by an instance that became a demo later.
    app.state.members.set_everyone(board_id, "editor")
    ann = visitor(app)
    assert board_id not in [b["id"] for b in ann.get("/api/boards").json()["boards"]]
    assert ann.get(f"/api/boards/{board_id}").status_code == 404
    assert sign_up(ann).status_code == 200
    assert ann.get(f"/api/boards/{board_id}").status_code == 200


def test_boards_made_at_once_stay_within_the_limit(app):
    ann = visitor(app)
    person = app.state.accounts.get(me(ann)["id"])
    boards = app.state.boards
    made = together(
        8, lambda index: board_service.create_board(person, f"Board {index}", boards, 3)
    )
    assert sum(isinstance(result, BoardLimit) for result in made) == 5
    assert boards.owned(person.id) == 3


def test_three_boards_with_the_welcome_board(app):
    ann = visitor(app)
    welcome(ann)
    for name in ("Second", "Third"):
        assert ann.post("/api/boards", json={"name": name}).status_code == 201
    response = ann.post("/api/boards", json={"name": "Fourth"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "board_limit"
    admin = signed_in(app)
    for name in ("One", "Two", "Three", "Four"):
        assert admin.post("/api/boards", json={"name": name}).status_code == 201


def test_the_board_limit_of_the_instance_holds_members_and_not_admins():
    app = create_app(Settings(db_path=":memory:", tiko_demo=True, tiko_board_limit=2))
    ann = visitor(app)
    sign_up(ann)
    welcome(ann)
    assert ann.post("/api/boards", json={"name": "Second"}).status_code == 201
    response = ann.post("/api/boards", json={"name": "Third"})
    assert response.json()["error"]["code"] == "board_limit"
    # A visitor keeps the three of the demo whatever the instance allows its people.
    bob = visitor(app, "203.0.113.2")
    welcome(bob)
    for name in ("Second", "Third"):
        assert bob.post("/api/boards", json={"name": name}).status_code == 201
    assert bob.post("/api/boards", json={"name": "Fourth"}).status_code == 409
    admin = signed_in(app)
    for name in ("One", "Two", "Three"):
        board_id = admin.post("/api/boards", json={"name": name}).json()["id"]
    # A board handed over would be a third for Ann.
    transfer = admin.post(f"/api/boards/{board_id}/transfer", json={"user_id": me(ann)["id"]})
    assert transfer.json()["error"]["code"] == "board_limit"


def test_the_instance_limit_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("TIKO_DEMO_LIMIT", "7")
    limited = create_app(Settings(_env_file=None, db_path=":memory:", tiko_demo=True))
    assert limited.state.visitors.max_alive == 7
    monkeypatch.setenv("TIKO_DEMO_LIMIT", "")
    default = create_app(Settings(_env_file=None, db_path=":memory:", tiko_demo=True))
    assert default.state.visitors.max_alive == demo.MAX_ALIVE


def test_a_variable_left_empty_means_its_default(monkeypatch):
    for name in ("TIKO_BOARD_LIMIT", "TIKO_TRACKER", "TIKO_DEMO"):
        monkeypatch.setenv(name, "")
    settings = Settings(_env_file=None)
    assert settings.tiko_board_limit is None and settings.tiko_tracker is None
    assert settings.tiko_demo is False


def test_an_ordinary_instance_has_no_board_limit(client):
    for index in range(5):
        assert client.post("/api/boards", json={"name": f"Board {index}"}).status_code == 201


def test_five_demos_an_hour_from_one_address(app):
    for _ in range(demo.PER_ADDRESS):
        visitor(app)
    response = TestClient(app).post("/api/auth/demo", headers={"x-real-ip": "203.0.113.1"})
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "too_many_attempts"
    assert int(response.headers["retry-after"]) > 0
    visitor(app, "203.0.113.2")
    # Signing in is not held back by it.
    signed_in(app)


def test_demos_asked_for_at_once_stay_within_the_address_limit(app, monkeypatch):
    slow_add(app, monkeypatch)
    now = time.time()
    made = together(8, lambda _: app.state.visitors.create("203.0.113.1", now))
    assert sum(isinstance(result, str) for result in made) == demo.PER_ADDRESS


def test_demos_asked_for_at_once_stay_within_the_instance_limit(app, monkeypatch):
    monkeypatch.setattr(app.state.visitors, "max_alive", 2)
    edit(ann := visitor(app), welcome(ann))
    slow_add(app, monkeypatch)
    now = time.time()
    together(4, lambda index: app.state.visitors.create(f"198.51.100.{index}", now))
    # Each newcomer takes the place of the one before, who changed nothing yet.
    assert app.state.visitors._users.demo_alive(demo.iso(now)) == 2


def test_a_lowered_limit_takes_back_every_place_over_it(app, monkeypatch):
    edit(busy := visitor(app, "203.0.113.1"), welcome(busy))
    for index in range(2, 6):
        visitor(app, f"203.0.113.{index}")
    monkeypatch.setattr(app.state.visitors, "max_alive", 2)
    now = time.time()
    visitor(app, "203.0.113.6")
    assert app.state.visitors._users.demo_alive(demo.iso(now)) == 2
    assert me(busy)["name"] == "Demo visitor"


def test_an_ipv6_network_counts_as_one_address():
    assert demo.address_key("2001:db8:1:2:aaaa::1") == demo.address_key("2001:db8:1:2:bbbb::9")
    assert demo.address_key("2001:db8:1:2::1") != demo.address_key("2001:db8:1:3::1")
    assert demo.address_key("203.0.113.7") == "203.0.113.7"
    assert demo.address_key("not an address") == "not an address"


def test_a_full_demo_gives_the_place_of_one_who_changed_nothing(app, monkeypatch):
    monkeypatch.setattr(app.state.visitors, "max_alive", 2)
    idle = visitor(app, "203.0.113.1")
    busy = visitor(app, "203.0.113.2")
    idle_board = welcome(idle)
    edit(busy, welcome(busy))

    newcomer = visitor(app, "203.0.113.3")
    assert idle.get("/api/boards").status_code == 401
    assert busy.get("/api/boards").status_code == 200
    assert idle_board not in rows(app)

    edit(newcomer, welcome(newcomer))
    response = TestClient(app).post("/api/auth/demo", headers={"x-real-ip": "203.0.113.4"})
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "demo_full"
    signed_in(app)


def test_the_cleanup_takes_everything_of_a_visitor_who_stayed_away(app):
    ann, bob = visitor(app), visitor(app, "203.0.113.2")
    ann_id, board_id = me(ann)["id"], welcome(ann)
    edit(ann, board_id)
    ann.put("/api/demo/tasks/DEMO-1/status", json={"status": "Done"})
    ann.post(f"/api/boards/{board_id}/refresh")
    edit(bob, welcome(bob))
    visitors = app.state.visitors
    assert ann_id in rows(app)

    assert visitors.cleanup(time.time() + 6 * DAY) == 0
    # Bob came back on day 6; Ann did not.
    app.state.accounts._users.touch_demo(me(bob)["id"], demo.iso(time.time() + 13 * DAY))
    assert visitors.cleanup(time.time() + 8 * DAY) == 1
    assert visitors.cleanup(time.time() + 8 * DAY) == 0

    assert ann.get("/api/boards").status_code == 401
    left = rows(app)
    assert ann_id not in left and board_id not in left
    assert bob.get("/api/boards").status_code == 200


def test_a_visitor_who_changed_nothing_goes_within_the_hour(app):
    idle, busy = visitor(app), visitor(app, "203.0.113.2")
    welcome(idle)
    edit(busy, welcome(busy))
    assert app.state.visitors.cleanup(time.time() + 30 * 60) == 0
    assert app.state.visitors.cleanup(time.time() + 2 * 3600) == 1
    assert idle.get("/api/boards").status_code == 401
    assert busy.get("/api/boards").status_code == 200


def test_a_visitor_who_only_opened_the_board_changed_nothing(app):
    app.state.live.save_idle_s = 0.01
    idle = visitor(app)
    board_id = welcome(idle)
    boards = app.state.boards
    with TestClient(app) as sockets:
        cookie = idle.cookies.get("tiko_session")
        with sockets.websocket_connect(
            f"/api/boards/{board_id}/live", headers={"cookie": f"tiko_session={cookie}"}
        ) as socket:
            socket.receive_bytes()
            deadline = time.time() + 5
            while boards.load(board_id)[1] is None and time.time() < deadline:
                time.sleep(0.01)
    assert boards.load(board_id)[1] is not None
    assert boards.get(board_id).version == 1
    assert app.state.visitors.cleanup(time.time() + 2 * 3600) == 1
    assert idle.get("/api/boards").status_code == 401


def test_a_status_or_a_new_board_name_is_a_change_worth_keeping(app, monkeypatch):
    monkeypatch.setattr(app.state.visitors, "max_alive", 2)
    ann, bob = visitor(app), visitor(app, "203.0.113.2")
    assert ann.put("/api/demo/tasks/DEMO-1/status", json={"status": "Done"}).is_success
    board_id = welcome(bob)
    # The clock counts whole seconds, and nobody renames a board in the second it was made.
    monkeypatch.setattr(sqlite, "now_iso", lambda: demo.iso(time.time() + 60))
    assert bob.patch(f"/api/boards/{board_id}", json={"name": "Mine"}).is_success

    assert app.state.visitors.cleanup(time.time() + 2 * 3600) == 0
    response = TestClient(app).post("/api/auth/demo", headers={"x-real-ip": "203.0.113.3"})
    assert response.json()["error"]["code"] == "demo_full"
    assert ann.get("/api/boards").status_code == 200
    assert bob.get("/api/boards").status_code == 200


def test_places_keep_being_found_behind_visitors_who_changed_something(app, monkeypatch):
    monkeypatch.setattr(app.state.visitors, "max_alive", 3)
    busy, first, second = (visitor(app, f"203.0.113.{n}") for n in (1, 2, 3))
    edit(busy, welcome(busy))
    welcome(first), welcome(second)

    third = visitor(app, "203.0.113.4")
    fourth = visitor(app, "203.0.113.5")
    gone = [who.get("/api/boards").status_code for who in (busy, first, second)]
    assert gone == [200, 401, 401]

    edit(third, welcome(third))
    edit(fourth, welcome(fourth))
    full = TestClient(app).post("/api/auth/demo", headers={"x-real-ip": "203.0.113.6"})
    assert full.json()["error"]["code"] == "demo_full"

    # A place opens and an idle visitor takes it: the next one to come still finds them.
    monkeypatch.setattr(app.state.visitors, "max_alive", 4)
    idle = visitor(app, "203.0.113.7")
    visitor(app, "203.0.113.8")
    assert idle.get("/api/boards").status_code == 401
    assert all(who.get("/api/boards").status_code == 200 for who in (busy, third, fourth))


def test_an_idle_visitor_behind_the_last_search_is_found_before_the_demo_is_full(app, monkeypatch):
    monkeypatch.setattr(app.state.visitors, "max_alive", 2)
    users = app.state.visitors._users
    busy, idle = visitor(app, "203.0.113.1"), visitor(app, "203.0.113.2")
    edit(busy, welcome(busy))
    welcome(idle)
    # A request that waited its turn brings an older clock: its visitor expires before the
    # place the last search stopped at.
    users._changed_until = demo.iso(time.time() + 30 * DAY)

    visitor(app, "203.0.113.3")
    assert idle.get("/api/boards").status_code == 401
    assert busy.get("/api/boards").status_code == 200


def test_a_visitor_deleted_between_the_read_and_the_touch_is_signed_out(app, monkeypatch):
    ann = visitor(app)
    sessions, users = app.state.sessions, app.state.visitors._users
    touch = sessions._touch_demo

    def late(user_id: str, now: float):
        # The cleanup lands after the session was read and before the expiry moves.
        users.evict_untouched_demo()
        return touch(user_id, now)

    monkeypatch.setattr(sessions, "_touch_demo", late)
    assert sessions.resolve(ann.cookies[COOKIE], time.time() + 120) is None


def test_an_expired_visitor_is_refused_before_the_cleanup(app, monkeypatch):
    ann = visitor(app)
    assert ann.get("/api/boards").status_code == 200
    later = time.time() + 8 * DAY
    monkeypatch.setattr(time, "time", lambda: later)
    assert ann.get("/api/boards").status_code == 401


def test_requests_move_the_expiry_on(app, monkeypatch):
    ann = visitor(app)
    first = me(ann)["demo_expires_at"]
    later = time.time() + 3 * DAY
    monkeypatch.setattr(time, "time", lambda: later)
    assert me(ann)["demo_expires_at"] > first
    much_later = later + 6 * DAY
    monkeypatch.setattr(time, "time", lambda: much_later)
    assert ann.get("/api/boards").status_code == 200


def test_the_cleanup_closes_an_open_board(app):
    ann = visitor(app)
    board_id = welcome(ann)
    edit(ann, board_id)
    cookie = ann.cookies.get("tiko_session")
    with (
        TestClient(app) as sockets,
        sockets.websocket_connect(
            f"/api/boards/{board_id}/live", headers={"cookie": f"tiko_session={cookie}"}
        ) as socket,
    ):
        socket.receive_bytes()
        assert app.state.visitors.cleanup(time.time() + 8 * DAY) == 1
        with pytest.raises(WebSocketDisconnect) as closed:
            while True:
                socket.receive_bytes()
        assert closed.value.code == 4401


def test_task_statuses_are_each_persons_own(app):
    ann, bob = visitor(app), visitor(app, "203.0.113.2")
    assert ann.put("/api/demo/tasks/DEMO-1/status", json={"status": "Done"}).is_success

    def status(client: TestClient) -> str:
        return client.post("/api/tasks/resolve", json={"ref": "DEMO-1"}).json()["task"][
            "status_name"
        ]

    assert status(ann) == "Done"
    assert status(bob) == "In Progress"
    found = bob.post("/api/tasks/search", json={"jql": '"DEMO-1"'}).json()["tasks"]
    assert found[0]["status_name"] == "In Progress"
    board = ann.post(f"/api/boards/{welcome(ann)}/refresh").json()
    assert board["tasks"]["demo:DEMO-1"]["status_name"] == "Done"
    board = bob.post(f"/api/boards/{welcome(bob)}/refresh").json()
    assert board["tasks"]["demo:DEMO-1"]["status_name"] == "In Progress"


def test_a_guest_sees_the_statuses_of_the_boards_owner(app):
    admin = signed_in(app)
    board_id = welcome(admin)
    admin.put("/api/demo/tasks/DEMO-1/status", json={"status": "Done"})
    visitor(app).put("/api/demo/tasks/DEMO-1/status", json={"status": "Closed"})
    token = admin.put(f"/api/boards/{board_id}/public", json={"public": True}).json()[
        "public_token"
    ]
    guest = TestClient(app)
    tasks = guest.post(f"/api/public/{token}/refresh").json()["tasks"]
    assert tasks["demo:DEMO-1"]["status_name"] == "Done"
    assert guest.get(f"/api/public/{token}").json()["tasks"]["demo:DEMO-1"]["status_name"] == "Done"


def test_statuses_survive_a_restart(tmp_path):
    settings = Settings(db_path=str(tmp_path / "app.db"), tiko_demo=True)
    admin = signed_in(create_app(settings))
    admin.put("/api/demo/tasks/DEMO-2/status", json={"status": "Done"})
    again = signed_in(create_app(settings))
    task = again.post("/api/tasks/resolve", json={"ref": "DEMO-2"}).json()["task"]
    assert task["status_name"] == "Done"


def test_an_ordinary_instance_still_shares_statuses(client):
    client.put("/api/demo/tasks/DEMO-1/status", json={"status": "Done"})
    url = client.post("/api/invites", json={"role": "member"}).json()["url"]
    other = TestClient(client.app)
    other.post(
        f"/api/invites/{url.split('=', 1)[1]}/accept",
        json={"username": "ann", "name": "Ann", "password": "long-enough-password"},
    )
    task = other.post("/api/tasks/resolve", json={"ref": "DEMO-1"}).json()["task"]
    assert task["status_name"] == "Done"


def test_a_board_list_stays_fast_among_many_strangers(app):
    boards = app.state.boards
    users = app.state.accounts._users
    for index in range(demo.MAX_ALIVE - 1):
        person = demo.Person(
            id=f"{index:032x}",
            username=f"~{index:012x}",
            name="Demo visitor",
            role="member",
            demo_expires_at=demo.iso(time.time() + DAY),
        )
        users.add(person, demo.NO_PASSWORD)
        for name in ("One", "Two", "Three"):
            boards.create(name, demo_doc(), person.id)
    ann = visitor(app)
    welcome(ann)
    started = time.perf_counter()
    listed = ann.get("/api/boards").json()
    assert time.perf_counter() - started < 0.1
    assert len(listed["boards"]) == 1 and listed["all"] == []


def demo_doc():
    from app.domain.boards import BoardDoc

    return BoardDoc()


LONG = "long-enough-password"


def sign_up(client: TestClient, username: str = "ann", password: str = LONG):
    body = {"name": "Ann Lee", "username": username, "password": password}
    return client.post("/api/auth/signup", json=body)


def test_sign_up_keeps_the_person_their_boards_and_the_session(app):
    ann = visitor(app)
    before_id = me(ann)["id"]
    first = welcome(ann)
    edit(ann, first)
    second = ann.post("/api/boards", json={"name": "Plan"}).json()["id"]
    ann.put("/api/demo/tasks/DEMO-1/status", json={"status": "Done"})
    before = [ann.get(f"/api/boards/{board}").json() for board in (first, second)]

    response = sign_up(ann)
    assert response.status_code == 200
    assert response.json() == {
        "id": before_id,
        "username": "ann",
        "name": "Ann Lee",
        "role": "member",
        "demo_expires_at": None,
    }
    assert me(ann)["demo_expires_at"] is None
    after = [ann.get(f"/api/boards/{board}").json() for board in (first, second)]
    for was, now in zip(before, after, strict=True):
        assert (now["id"], now["version"], now["doc"]) == (was["id"], was["version"], was["doc"])
        assert now["owner"]["name"] == "Ann Lee"

    elsewhere = signed_in(app, "ann", LONG)
    assert {b["id"] for b in elsewhere.get("/api/boards").json()["boards"]} == {first, second}
    task = elsewhere.post("/api/tasks/resolve", json={"ref": "DEMO-1"}).json()["task"]
    assert task["status_name"] == "Done"


def test_sign_up_errors_leave_a_demo_visitor(app):
    ann = visitor(app)
    for username, password, status, code in [
        ("admin", LONG, 409, "username_taken"),
        ("ann", "short", 422, "weak_password"),
        ("a b", LONG, 422, "validation_failed"),
    ]:
        response = sign_up(ann, username, password)
        assert (response.status_code, response.json()["error"]["code"]) == (status, code)
        assert me(ann)["demo_expires_at"]


def test_sign_up_is_for_demo_visitors_only(app, client):
    assert sign_up(TestClient(app)).status_code == 404
    assert sign_up(signed_in(app)).status_code == 404
    ann = visitor(app)
    assert sign_up(ann).status_code == 200
    assert sign_up(ann, "ann2").status_code == 404
    # Without the switch the route is not there, with or without a session.
    assert sign_up(client).status_code == 404
    assert sign_up(TestClient(client.app)).status_code == 404


def test_after_sign_up_sharing_and_the_public_link_work_and_the_three_boards_go(app):
    ann, bob = visitor(app), visitor(app, "203.0.113.2")
    sign_up(ann)
    sign_up(bob, "bob")
    board_id = welcome(ann)
    found = ann.get("/api/people/directory?q=bob").json()["people"]
    assert [p["username"] for p in found] == ["bob"]
    assert ann.get("/api/people/directory?q=bo").json() == {"people": []}
    share = ann.put(f"/api/boards/{board_id}/members/{found[0]['id']}", json={"role": "viewer"})
    assert share.status_code == 200
    assert board_id in [b["id"] for b in bob.get("/api/boards").json()["boards"]]
    link = ann.put(f"/api/boards/{board_id}/public", json={"public": True}).json()
    assert TestClient(app).get(f"/api/public/{link['public_token']}").status_code == 200
    assert ann.put("/api/me/password", json={"current": LONG, "new": LONG + "!"}).is_success
    for name in ("Second", "Third", "Fourth"):
        assert ann.post("/api/boards", json={"name": name}).status_code == 201


def test_the_cleanup_leaves_a_signed_up_person_until_90_days_without_a_sign_in(app):
    ann = visitor(app)
    board_id = welcome(ann)
    edit(ann, board_id)
    sign_up(ann)
    ann_id = me(ann)["id"]
    token = ann.put(f"/api/boards/{board_id}/public", json={"public": True}).json()["public_token"]
    admin = signed_in(app)
    visitors = app.state.visitors

    assert visitors.cleanup(time.time() + 8 * DAY) == 0
    assert visitors.cleanup(time.time() + 89 * DAY) == 0
    assert ann.get("/api/boards").status_code == 200

    assert visitors.cleanup(time.time() + 91 * DAY) == 1
    assert ann.get("/api/boards").status_code == 401
    assert TestClient(app).get(f"/api/public/{token}").status_code == 404
    left = rows(app)
    assert ann_id not in left and board_id not in left
    # Admins stay whatever their last sign-in.
    assert admin.get("/api/boards").status_code == 200


def test_sign_up_wins_a_race_with_a_touch_and_loses_one_with_the_cleanup(app):
    ann = visitor(app)
    ann_id = me(ann)["id"]
    sign_up(ann)
    # A touch that was on its way when the sign-up landed does not bring the expiry back.
    assert demo.touch(app.state.accounts._users, ann_id, time.time()) is None
    assert me(ann)["demo_expires_at"] is None

    bob = visitor(app, "203.0.113.2")
    person = app.state.accounts.get(me(bob)["id"])
    app.state.visitors.cleanup(time.time() + 8 * DAY)
    with pytest.raises(demo.NotFound):
        app.state.visitors.sign_up(person, "Bob", "bob", LONG)


def test_the_welcome_board_of_a_demo_does_not_send_people_to_connect_a_tracker(app, client):
    def notes(who: TestClient) -> str:
        board = who.get(f"/api/boards/{welcome(who)}").json()
        return " ".join(n["data"].get("text", "") for n in board["doc"]["nodes"])

    assert "This is a demo" in notes(visitor(app))
    assert "Connect your tracker" not in notes(visitor(app, "203.0.113.2"))
    assert "Connect your tracker" in notes(client)


def test_a_reset_link_counts_as_a_sign_in_for_the_90_days(app):
    ann = visitor(app)
    edit(ann, welcome(ann))
    sign_up(ann)
    ann_id = me(ann)["id"]
    admin = signed_in(app)
    users = app.state.accounts._users
    db = app.state.boards._db
    with db.transaction() as conn:
        conn.execute(
            "UPDATE users SET last_sign_in_at = ? WHERE id = ?",
            (demo.iso(time.time() - 89 * DAY), ann_id),
        )
    url = admin.post(f"/api/people/{ann_id}/reset").json()["url"]
    fresh = TestClient(app)
    accepted = fresh.post(
        f"/api/invites/{url.split('=', 1)[1]}/accept", json={"password": LONG + "2"}
    )
    assert accepted.status_code == 204
    assert users.delete_unused_members(demo.iso(time.time() - 88 * DAY)) == ([], [])
    assert app.state.visitors.cleanup(time.time() + 2 * DAY) == 0
    assert fresh.get("/api/boards").status_code == 200


def test_the_directory_takes_so_many_searches_a_minute(app):
    ann = visitor(app)
    sign_up(ann)
    for _ in range(demo.LOOKUPS):
        assert ann.get("/api/people/directory?q=bob").status_code == 200
    busy = ann.get("/api/people/directory?q=bob")
    assert busy.status_code == 429 and busy.headers["retry-after"]
    # An empty search finds nobody and costs nothing; another person is not held up.
    assert ann.get("/api/people/directory").status_code == 200
    assert signed_in(app).get("/api/people/directory?q=ann").json()["people"]


def test_an_ordinary_instance_does_not_count_searches(client):
    for _ in range(demo.LOOKUPS + 5):
        assert client.get("/api/people/directory?q=adm").status_code == 200
