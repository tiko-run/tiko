"""Spec 012: a board shown by its public link, view-only and without its people."""

import logging

import pytest
from fastapi.testclient import TestClient

from app.domain.public import LINK_REQUESTS, PublicLinks
from tests.jira_fake import TOKEN
from tests.test_sharing import call, monkeypatch_module, new_board, world  # noqa: F401

JIRA = {"base_url": "https://jira.example.com", "token": TOKEN}


def card(key: str) -> dict:
    return {"id": key, "type": "task_card", "position": {"x": 0, "y": 0}, "data": {"key": key}}


def publish(client: TestClient, board_id: str) -> str:
    response = client.put(f"/api/boards/{board_id}/public", json={"public": True})
    assert response.status_code == 200, response.text
    return response.json()["public_token"]


def guest(client: TestClient) -> TestClient:
    """A browser nobody is signed in to, on the same instance."""
    return TestClient(client.app)


def board_with(client: TestClient, key: str) -> str:
    board_id = client.post("/api/boards", json={"name": "Roadmap"}).json()["id"]
    doc = {"nodes": [card(key)], "edges": []}
    assert client.put(f"/api/boards/{board_id}", json={"version": 1, "doc": doc}).is_success
    return board_id


def test_guest_reads_a_public_board(client):
    board_id = board_with(client, "DEMO-1")
    summary = client.post("/api/tasks/resolve", json={"ref": "DEMO-1"}).json()["task"]["summary"]
    anyone = guest(client)
    assert anyone.get(f"/api/boards/{board_id}").status_code == 401

    token = publish(client, board_id)
    body = anyone.get(f"/api/public/{token}").json()
    assert set(body) == {
        "room",
        "name",
        "updated_at",
        "version",
        "doc",
        "tasks",
        "default_source",
        "refresh_interval_s",
        "planning",
    }
    assert body["planning"] is None
    assert body["name"] == "Roadmap" and body["doc"]["nodes"][0]["data"]["key"] == "DEMO-1"
    assert body["tasks"]["demo:DEMO-1"]["summary"] == summary
    assert anyone.get(f"/api/public/{token}/version").json() == {
        "version": body["version"],
        "updated_at": body["updated_at"],
    }
    # The link opens that one board and nothing else.
    assert anyone.get(f"/api/boards/{board_id}").status_code == 401
    assert anyone.get("/api/boards").status_code == 401


def gantt_with(client: TestClient, stages: list[dict], **extra) -> str:
    board_id = client.post("/api/boards", json={"name": "Plan"}).json()["id"]
    row = {"id": "r1", "title": "Checkout", "start": "2026-10-05", "end": "2026-10-16"}
    content = {"start": "2026-10-01", "end": "2026-12-31", "rows": [row | {"stages": stages}]}
    content |= extra
    node = {
        "id": "g",
        "type": "module",
        "position": {"x": 0, "y": 0},
        "data": {"kind": "gantt", "content": content},
    }
    doc = {"nodes": [node], "edges": []}
    assert client.put(f"/api/boards/{board_id}", json={"version": 1, "doc": doc}).is_success
    return board_id


def test_guest_gets_only_the_types_and_people_of_the_board(client):
    types = client.patch("/api/planning", json={"enabled": True}).json()["types"]
    ivan, petra = (
        client.post("/api/planning/people", json={"name": name, "teams": ["Web"]}).json()
        for name in ("Ivan", "Petra")
    )
    stage = {"id": "s1", "type": types[2]["id"], "start": "2026-10-05", "end": "2026-10-16"}
    quarter = client.post("/api/planning/fields", json={"name": "Quarter"}).json()
    client.post("/api/planning/fields", json={"name": "Budget code"})
    board_id = gantt_with(
        client, [stage | {"people": [ivan["id"], "gone"]}], columns=["priority", quarter["id"]]
    )
    planning = guest(client).get(f"/api/public/{publish(client, board_id)}").json()["planning"]
    assert planning["types"] == [types[2]] and planning["people"] == [ivan]
    assert [f["name"] for f in planning["fields"]] == ["Priority", "Quarter"]
    assert petra not in planning["people"]
    client.patch("/api/planning", json={"enabled": False})
    assert guest(client).get(f"/api/public/{publish(client, board_id)}").json()["planning"] is None


def test_guest_sees_demo_status_changes(client):
    token = publish(client, board_with(client, "DEMO-1"))
    client.put("/api/demo/tasks/DEMO-1/status", json={"status": "Done"})
    refreshed = guest(client).post(f"/api/public/{token}/refresh").json()
    assert refreshed["tasks"]["demo:DEMO-1"]["status_name"] == "Done"


def test_link_turned_off_is_gone_for_good(client):
    board_id = board_with(client, "DEMO-1")
    old = publish(client, board_id)
    assert publish(client, board_id) == old
    off = client.put(f"/api/boards/{board_id}/public", json={"public": False}).json()
    assert off == {"public": False, "public_token": None}
    anyone = guest(client)
    missing = anyone.get("/api/public/no-such-link")
    for path in ("", "/version"):
        dead = anyone.get(f"/api/public/{old}{path}")
        assert (dead.status_code, dead.json()) == (missing.status_code, missing.json())
    assert anyone.post(f"/api/public/{old}/refresh").status_code == 404
    new = publish(client, board_id)
    assert new != old and anyone.get(f"/api/public/{new}").status_code == 200
    assert anyone.get(f"/api/public/{old}").status_code == 404


def test_deleted_board_takes_its_link_along(client):
    board_id = board_with(client, "DEMO-1")
    token = publish(client, board_id)
    client.delete(f"/api/boards/{board_id}")
    assert guest(client).get(f"/api/public/{token}").status_code == 404


def test_admin_switches_public_links_off(client):
    board_id = board_with(client, "DEMO-1")
    token = publish(client, board_id)
    assert client.put("/api/settings", json={"public_links": False}).json()["public_links"] is False
    anyone = guest(client)
    assert anyone.get(f"/api/public/{token}").status_code == 404
    other = client.post("/api/boards", json={"name": "Other"}).json()["id"]
    refused = client.put(f"/api/boards/{other}/public", json={"public": True})
    assert (refused.status_code, refused.json()["error"]["code"]) == (403, "forbidden")
    # Turning a link off still works while links are forbidden.
    assert client.put(f"/api/boards/{board_id}/public", json={"public": False}).is_success
    client.put("/api/settings", json={"public_links": True})
    assert anyone.get(f"/api/public/{token}").status_code == 404


@pytest.mark.parametrize(
    "method,path",
    [
        ("PUT", ""),
        ("PATCH", ""),
        ("DELETE", ""),
        ("POST", ""),
        ("PUT", "/public"),
        ("GET", "/members"),
        ("PUT", "/everyone"),
        ("POST", "/transfer"),
        ("GET", "/live"),
    ],
)
def test_guest_routes_only_read(client, method, path):
    board_id = board_with(client, "DEMO-1")
    token = publish(client, board_id)
    before = client.get(f"/api/boards/{board_id}").json()
    response = guest(client).request(method, f"/api/public/{token}{path}", json={})
    assert response.status_code in (404, 405)
    assert client.get(f"/api/boards/{board_id}").json()["version"] == before["version"]


def test_token_opens_no_other_route(client):
    board_id = board_with(client, "DEMO-1")
    token = publish(client, board_id)
    anyone = guest(client)
    headers = {"authorization": f"Bearer {token}", "cookie": f"tiko_session={token}"}
    for path in (f"/api/boards/{board_id}", f"/api/boards/{token}", "/api/settings", "/api/people"):
        assert anyone.get(path, headers=headers).status_code == 401
        assert anyone.get(f"{path}?token={token}").status_code == 401


def test_only_the_owner_makes_and_sees_the_link(world):  # noqa: F811
    clients, _ = world
    board_id = new_board(world)
    for who in ("bob", "carl"):
        response = clients[who].put(f"/api/boards/{board_id}/public", json={"public": True})
        assert response.status_code == 403
    assert (
        clients["dave"].put(f"/api/boards/{board_id}/public", json={"public": True}).status_code
        == 404
    )
    token = publish(clients["ann"], board_id)
    for who, sees in (("ann", token), ("admin", token), ("bob", None), ("carl", None)):
        body = clients[who].get(f"/api/boards/{board_id}/members").json()
        assert (body["public"], body["public_token"]) == (True, sees)
    listed = clients["carl"].get("/api/boards").json()["boards"]
    assert next(b for b in listed if b["id"] == board_id)["public"] is True
    assert clients["carl"].get(f"/api/boards/{board_id}").json()["public"] is True


def test_guest_learns_nothing_about_people(world):  # noqa: F811
    clients, _ = world
    board_id = new_board(world)
    token = publish(clients["ann"], board_id)
    anyone = guest(clients["ann"])
    text = (
        anyone.get(f"/api/public/{token}").text + anyone.post(f"/api/public/{token}/refresh").text
    )
    # The key itself spells "ann".
    text = text.replace('"planning"', "")
    for name in ("ann", "Ann", "bob", "Bob", "carl", "admin", board_id):
        assert name not in text


def test_guest_gets_only_keys_of_tracker_tasks(jira_client):
    """SC-003: nothing fetched with a person's token reaches a guest."""
    jira_client.put("/api/settings", json={"provider": "jira", "jira": JIRA})
    task = jira_client.post("/api/tasks/resolve", json={"ref": "DEV-1"}).json()["task"]
    board_id = board_with(jira_client, "DEV-1")
    assert jira_client.post(f"/api/boards/{board_id}/refresh").json()["tasks"]["jira:DEV-1"][
        "summary"
    ]
    token = publish(jira_client, board_id)
    anyone = guest(jira_client)
    private = {
        **task,
        "state": "private",
        "summary": "",
        "status_name": "",
        "status_category": "new",
        "type_name": "",
        "assignee_name": None,
        "priority_name": None,
        "updated": None,
        "url": "https://jira.example.com/browse/DEV-1",
    }
    for response in (
        anyone.get(f"/api/public/{token}"),
        anyone.post(f"/api/public/{token}/refresh"),
    ):
        shown = response.json()["tasks"]["jira:DEV-1"]
        assert {**shown, "fetched_at": ""} == {**private, "fetched_at": ""}
        assert task["summary"] not in response.text and TOKEN not in response.text
    assert anyone.post(f"/api/public/{token}/refresh").json()["sources"] == []


def test_one_link_cannot_take_the_whole_instance():
    class Boards:
        def by_public_token(self, token):
            return ("b", 1, "")

    now = [0.0]
    links = PublicLinks(Boards(), lambda: True, clock=lambda: now[0])
    for _ in range(LINK_REQUESTS):
        links.find("t")
    with pytest.raises(Exception) as caught:
        links.find("t")
    assert caught.value.code == "too_many_attempts" and caught.value.retry_after == 60
    assert links.find("other") == ("b", 1, "")
    now[0] = 61.0
    assert links.find("t") == ("b", 1, "")


def test_upgrade_leaves_every_board_private(client):
    board_id = board_with(client, "DEMO-1")
    body = client.get(f"/api/boards/{board_id}/members").json()
    assert (body["public"], body["public_token"]) == (False, None)
    assert client.get(f"/api/boards/{board_id}").json()["public"] is False


def test_two_owners_turning_the_link_on_get_the_same_link(client):
    """Whoever comes second gets the link that is stored, not one of their own."""
    boards = client.app.state.boards
    board_id = board_with(client, "DEMO-1")
    first = boards.ensure_public_token(board_id, "first-token")
    second = boards.ensure_public_token(board_id, "second-token")
    assert first == second == "first-token"
    assert guest(client).get("/api/public/first-token").status_code == 200
    assert boards.ensure_public_token("no-such-board", "x") is None


def test_a_rename_reaches_the_guest_check(client):
    board_id = board_with(client, "DEMO-1")
    token = publish(client, board_id)
    anyone = guest(client)
    before = anyone.get(f"/api/public/{token}/version").json()
    boards = client.app.state.boards
    with boards._db.transaction() as conn:
        conn.execute("UPDATE boards SET updated_at = '2020-01-01T00:00:00+00:00'")
    client.patch(f"/api/boards/{board_id}", json={"name": "Renamed"})
    after = anyone.get(f"/api/public/{token}/version").json()
    assert (
        after["version"] == before["version"] and after["updated_at"] != "2020-01-01T00:00:00+00:00"
    )
    assert anyone.get(f"/api/public/{token}").json()["name"] == "Renamed"


def test_quiet_links_do_not_pile_up_in_memory():
    class Boards:
        def by_public_token(self, token):
            return ("b", 1, "")

    now = [0.0]
    links = PublicLinks(Boards(), lambda: True, clock=lambda: now[0])
    for n in range(2000):
        links.find(f"old-{n}")
        now[0] += 1.0
    assert len(links._attempts._windows) <= 1024


def test_a_public_link_is_not_written_to_the_server_log(client, caplog):
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        logging.getLogger("uvicorn.error").info(
            '%s - "WebSocket %s" [accepted]', "10.0.0.1:1", "/api/public/s3cr3t-Link_1/live/a3"
        )
    assert "s3cr3t" not in caplog.text
    assert "/api/public/***/live/a3" in caplog.text


def test_guest_of_a_mixed_board_sees_demo_tasks_only(jira_client):
    """A demo task belongs to no person and shows in full; a Jira task stays a key."""
    jira_client.put("/api/settings", json={"provider": "jira", "jira": JIRA})
    secret = jira_client.post("/api/tasks/resolve", json={"ref": "DEV-1"}).json()["task"]
    board_id = jira_client.post("/api/boards", json={"name": "Roadmap"}).json()["id"]
    demo_card = card("DEMO-1") | {"id": "demo", "data": {"key": "DEMO-1", "source": "demo"}}
    doc = {"nodes": [card("DEV-1"), demo_card], "edges": []}
    assert jira_client.put(f"/api/boards/{board_id}", json={"version": 1, "doc": doc}).is_success
    token = publish(jira_client, board_id)
    anyone = guest(jira_client)
    for response in (
        anyone.get(f"/api/public/{token}"),
        anyone.post(f"/api/public/{token}/refresh"),
    ):
        tasks = response.json()["tasks"]
        assert tasks["jira:DEV-1"]["state"] == "private"
        assert tasks["demo:DEMO-1"]["state"] == "ok" and tasks["demo:DEMO-1"]["summary"]
        assert secret["summary"] not in response.text and TOKEN not in response.text
    sources = anyone.post(f"/api/public/{token}/refresh").json()["sources"]
    assert [source["id"] for source in sources] == ["demo"]
