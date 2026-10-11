from tests.jira_fake import TOKEN, issue


def board_with(client, *keys, name="b"):
    board = client.post("/api/boards", json={"name": name}).json()
    nodes = [
        {"id": f"n{i}", "type": "task_card", "position": {"x": 0, "y": 0}, "data": {"key": k}}
        for i, k in enumerate(keys)
    ]
    client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": {"nodes": nodes}})
    return board["id"]


def test_demo_status_change_shows_on_refresh(client):
    board_id = board_with(client, "DEMO-1", "DEMO-1", "NOPE-1")
    changed = client.put("/api/demo/tasks/demo-1/status", json={"status": "Done"})
    assert changed.json()["task"]["status_category"] == "done"

    body = client.post(f"/api/boards/{board_id}/refresh").json()
    assert body["tasks"]["demo:DEMO-1"]["status_category"] == "done"
    assert body["tasks"]["demo:NOPE-1"]["state"] == "not_found"
    assert (
        client.get(f"/api/boards/{board_id}").json()["tasks"]["demo:DEMO-1"]["status_name"]
        == "Done"
    )


def test_only_open_board_keys_are_polled(jira_client, fake_jira):
    jira_client.put(
        "/api/settings",
        json={"provider": "jira", "jira": {"base_url": "https://jira.example.com", "token": TOKEN}},
    )
    board_with(jira_client, "DEV-2", name="other")
    open_board = board_with(jira_client, "DEV-1")
    fake_jira.requests.clear()

    body = jira_client.post(f"/api/boards/{open_board}/refresh").json()
    assert set(body["tasks"]) == {"jira:DEV-1"}
    assert body["sources"][0] | {"synced_at": None} == {
        "id": "jira",
        "name": "Jira Data Center",
        "state": "ok",
        "synced_at": None,
        "error": None,
        "note": None,
    }
    assert len(fake_jira.requests) == 1


def test_rate_limited_refresh(jira_client, fake_jira):
    jira_client.put(
        "/api/settings",
        json={"provider": "jira", "jira": {"base_url": "https://jira.example.com", "token": TOKEN}},
    )
    board_id = board_with(jira_client, "DEV-1")
    fake_jira.fail = 429
    first = jira_client.post(f"/api/boards/{board_id}/refresh").json()["sources"][0]
    assert (first["state"], first["error"]["retry_after"]) == ("error", 60)
    fake_jira.fail = None
    fake_jira.requests.clear()
    second = jira_client.post(f"/api/boards/{board_id}/refresh")
    assert second.status_code == 200
    assert second.json()["sources"][0]["error"]["code"] == "jira_rate_limited"
    assert fake_jira.requests == []


def test_unknown_demo_task(client):
    assert client.put("/api/demo/tasks/NOPE-1/status", json={"status": "Done"}).status_code == 404


def test_refresh_missing_board(client):
    assert client.post("/api/boards/nope/refresh").status_code == 404


def test_settings_change_lifts_backoff(jira_client, fake_jira):
    jira_client.put(
        "/api/settings",
        json={"provider": "jira", "jira": {"base_url": "https://jira.example.com", "token": TOKEN}},
    )
    board_id = board_with(jira_client, "DEV-1")
    fake_jira.fail = 503
    refresh = f"/api/boards/{board_id}/refresh"
    assert jira_client.post(refresh).json()["sources"][0]["state"] == "error"
    fake_jira.fail = None
    jira_client.put("/api/settings", json={"jira": {"base_url": "https://jira.example.com"}})
    assert jira_client.post(refresh).json()["sources"][0]["state"] == "ok"


def mixed_board(client):
    """One key in two trackers: a card of the instance's Jira and a demo card."""
    board = client.post("/api/boards", json={"name": "mixed"}).json()
    nodes = [
        {"id": "a", "type": "task_card", "position": {"x": 0, "y": 0}, "data": {"key": "DEMO-1"}},
        {
            "id": "b",
            "type": "task_card",
            "position": {"x": 0, "y": 0},
            "data": {"key": "DEMO-1", "source": "demo"},
        },
    ]
    saved = client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": {"nodes": nodes}})
    assert saved.is_success, saved.text
    return board["id"]


def test_demo_tasks_stay_live_next_to_jira(jira_client, fake_jira):
    """SC-002: the same key in two trackers is two tasks."""
    jira_client.put(
        "/api/settings",
        json={"provider": "jira", "jira": {"base_url": "https://jira.example.com", "token": TOKEN}},
    )
    fake_jira.issues["DEMO-1"] = issue("DEMO-1")
    board_id = mixed_board(jira_client)

    body = jira_client.post(f"/api/boards/{board_id}/refresh").json()
    tasks = body["tasks"]
    assert {ref: task["state"] for ref, task in tasks.items()} == {
        "jira:DEMO-1": "ok",
        "demo:DEMO-1": "ok",
    }
    assert tasks["jira:DEMO-1"]["summary"] != tasks["demo:DEMO-1"]["summary"]
    assert [(s["id"], s["state"]) for s in body["sources"]] == [("demo", "ok"), ("jira", "ok")]

    opened = jira_client.get(f"/api/boards/{board_id}").json()
    assert set(opened["tasks"]) == {"jira:DEMO-1", "demo:DEMO-1"}
    assert opened["default_source"] == "jira"


def test_welcome_board_is_live_on_a_jira_instance(jira_client):
    jira_client.put(
        "/api/settings",
        json={"provider": "jira", "jira": {"base_url": "https://jira.example.com", "token": TOKEN}},
    )
    welcome = jira_client.get("/api/boards").json()["boards"][0]
    tasks = jira_client.post(f"/api/boards/{welcome['id']}/refresh").json()["tasks"]
    assert tasks and all(ref.startswith("demo:") for ref in tasks)
    assert {task["state"] for task in tasks.values()} == {"ok"}
