"""US4: each person's tracker token; no task data fetched with one token reaches another."""

import sqlite3
from contextlib import ExitStack

import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters.storage.sqlite import Database, SqliteCredentialRepo, SqliteSnapshotRepo
from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in
from tests.jira_fake import FakeJira
from tests.test_live import Tab

LONG = "long-enough-password"
T_ANN = "-".join(["ann", "token", "for", "tests"])
T_BOB = "-".join(["bob", "token", "for", "tests"])
HIDDEN = "Summary of DEV-2"


@pytest.fixture
def team():
    fake = FakeJira()
    fake.tokens = {T_ANN: {"DEV-1", "DEV-2"}, T_BOB: {"DEV-1"}}
    settings = Settings(db_path=":memory:", tiko_secret_key="test-secret-key")
    app = create_app(settings, jira_transport=httpx.MockTransport(fake))
    admin = signed_in(app)
    assert admin.put(
        "/api/settings", json={"provider": "jira", "jira": {"base_url": "https://jira.example.com"}}
    ).is_success
    people = {"admin": admin}
    for name in ("ann", "bob", "carl"):
        url = admin.post("/api/invites", json={"role": "member"}).json()["url"]
        client = TestClient(app)
        client.post(
            f"/api/invites/{url.split('=', 1)[1]}/accept",
            json={"username": name, "name": name.title(), "password": LONG},
        )
        people[name] = client
    people["ann"].put("/api/me/tracker", json={"token": T_ANN})
    people["bob"].put("/api/me/tracker", json={"token": T_BOB})
    return people, fake


def card(key: str) -> dict:
    data = {"key": key, "collapsed": False}
    return {"id": key, "type": "task_card", "position": {"x": 0, "y": 0}, "data": data}


def shared_board(ann: TestClient) -> str:
    board = ann.post("/api/boards", json={"name": "Sprint"}).json()
    doc = {"nodes": [card("DEV-1"), card("DEV-2")], "edges": []}
    assert ann.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": doc}).is_success
    assert ann.put(f"/api/boards/{board['id']}/everyone", json={"role": "viewer"}).is_success
    return board["id"]


def states(client: TestClient, board_id: str) -> dict[str, str]:
    tasks = client.post(f"/api/boards/{board_id}/refresh").json()["tasks"]
    return {task["key"]: task["state"] for task in tasks.values()}


def test_each_person_sees_what_their_own_token_allows(team):
    people, _ = team
    board_id = shared_board(people["ann"])
    assert states(people["ann"], board_id) == {"DEV-1": "ok", "DEV-2": "ok"}
    assert states(people["bob"], board_id) == {"DEV-1": "ok", "DEV-2": "not_found"}
    assert states(people["carl"], board_id) == {"DEV-1": "no_token", "DEV-2": "no_token"}
    # Reopening reads each person's own cache, never the one ann's token filled.
    for name in ("bob", "carl"):
        response = people[name].get(f"/api/boards/{board_id}")
        assert HIDDEN not in response.text
        assert response.json()["tasks"]["jira:DEV-2"]["summary"] == ""


def test_a_changed_jira_token_takes_what_the_old_one_read_out_of_the_cache(team):
    people, _ = team
    ann = people["ann"]
    board_id = shared_board(ann)
    ann.post(f"/api/boards/{board_id}/refresh")
    assert HIDDEN in ann.get(f"/api/boards/{board_id}").text
    # Before any refresh with the new token: the board opens without the old title.
    assert ann.put("/api/me/tracker", json={"token": T_BOB}).is_success
    assert HIDDEN not in ann.get(f"/api/boards/{board_id}").text
    assert ann.put("/api/me/tracker", json={"token": T_ANN}).is_success
    ann.post(f"/api/boards/{board_id}/refresh")
    assert ann.delete("/api/me/tracker").status_code == 204
    assert HIDDEN not in ann.get(f"/api/boards/{board_id}").text


def test_no_route_hands_out_another_persons_task_data(team):
    people, _ = team
    board_id = shared_board(people["ann"])
    people["ann"].post(f"/api/boards/{board_id}/refresh")
    for name in ("bob", "carl"):
        client = people[name]
        responses = [
            client.get(f"/api/boards/{board_id}"),
            client.post(f"/api/boards/{board_id}/refresh"),
            client.post("/api/tasks/resolve", json={"ref": "DEV-2"}),
            client.post("/api/tasks/search", json={"jql": "project = DEV", "limit": 50}),
            client.get("/api/boards"),
        ]
        for response in responses:
            assert HIDDEN not in response.text


def test_without_a_token_nothing_is_fetched_for_you(team):
    people, fake = team
    fake.requests.clear()
    carl = people["carl"]
    response = carl.post("/api/tasks/resolve", json={"ref": "DEV-1"})
    assert (response.status_code, response.json()["error"]["code"]) == (400, "jira_not_configured")
    assert carl.get("/api/me/tracker").json()["token_state"] == "none"
    assert fake.requests == []


def test_my_tracker_token(team):
    people, _ = team
    carl = people["carl"]
    body = carl.put("/api/me/tracker", json={"token": T_BOB}).json()
    assert body == {
        "provider": "jira",
        "base_url": "https://jira.example.com",
        "token_state": "set",
        "github_token_state": "none",
    }
    assert carl.post("/api/settings/jira/test", json={}).json()["user"] == "Alex Rivera"
    assert T_BOB not in carl.get("/api/settings").text
    assert carl.delete("/api/me/tracker").status_code == 204
    assert carl.get("/api/settings").json()["jira"]["token_state"] == "none"


def test_only_admins_change_the_instance_settings(team):
    people, _ = team
    response = people["ann"].put("/api/settings", json={"refresh_interval_s": 60})
    assert (response.status_code, response.json()["error"]["code"]) == (403, "forbidden")
    assert people["ann"].get("/api/settings").json()["provider"] == "jira"


def test_upgrade_moves_the_instance_token_to_the_admin(tmp_path):
    path = str(tmp_path / "app.db")
    db = Database(path)
    conn = sqlite3.connect(path)
    conn.executescript(
        "INSERT INTO task_snapshots VALUES ('DEV-7', 'ok', '{}', 'x'), ('DEMO-1', 'ok', '{}', 'x');"
        "INSERT INTO settings VALUES ('jira_base_url', 'https://jira.example.com'),"
        " ('jira_token_enc', 'sealed');"
    )
    conn.commit()
    credentials = SqliteCredentialRepo(db)
    credentials.adopt_instance_token("admin")
    credentials.adopt_instance_token("admin")
    assert credentials.get("admin", "jira") == ("sealed", "https://jira.example.com")
    # The old cache names no tracker: it is dropped and fills again on the first refresh.
    tables = conn.execute("SELECT name FROM sqlite_master WHERE name LIKE 'task_snapshots%'")
    assert tables.fetchall() == [("task_snapshots_v3",)]
    assert conn.execute("SELECT COUNT(*) FROM task_snapshots_v3").fetchone() == (0,)
    assert conn.execute("SELECT key FROM settings WHERE key = 'jira_token_enc'").fetchall() == []
    assert SqliteSnapshotRepo(db).scoped("bob").get_many(["jira:DEV-7"]) == {}


def test_no_task_data_travels_through_the_live_socket(team):
    """SC-004: the shared document carries card keys only, whoever's token filled the cards."""
    people, _ = team
    board_id = shared_board(people["ann"])
    assert people["ann"].put(f"/api/boards/{board_id}/everyone", json={"role": "editor"}).is_success
    app = people["ann"].app
    app.state.live.save_idle_s = app.state.live.check_delay_s = 0.01
    seen: list[bytes] = []
    with TestClient(app) as sockets, ExitStack() as open_sockets:
        tabs = {}
        for name in ("ann", "bob"):
            cookie = people[name].cookies.get("tiko_session")
            socket = sockets.websocket_connect(
                f"/api/boards/{board_id}/live", headers={"cookie": f"tiko_session={cookie}"}
            )
            tabs[name] = Tab(open_sockets.enter_context(socket))
        for name, tab in tabs.items():
            assert states(people[name], board_id)["DEV-1"] == "ok"
            tab.add(card({"ann": "NEW-1", "bob": "NEW-2"}[name]), order=5)
            tab.sync()
        for tab in tabs.values():
            tab.sync()
            seen.extend(tab.received)
    stored = app.state.boards.load(board_id)
    wire = b"".join(seen) + stored[1] + stored[0].doc.model_dump_json().encode()
    assert b"DEV-2" in wire
    for secret in (b"Summary of", b"Alex Rivera", b"In Progress"):
        assert secret not in wire
