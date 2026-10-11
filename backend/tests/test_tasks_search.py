def test_demo_search_filters_by_quoted_values(client):
    body = client.post("/api/tasks/search", json={"jql": 'status = "In Progress"'}).json()
    assert [task["key"] for task in body["tasks"]] == ["DEMO-1", "DEMO-4", "DEMO-7"]
    assert body["total"] == 3


def test_search_limit_and_snapshots(client):
    body = client.post("/api/tasks/search", json={"jql": "project = DEMO", "limit": 2}).json()
    assert len(body["tasks"]) == 2
    assert body["total"] == 12
    board = client.post("/api/boards", json={"name": "Q4"}).json()
    doc = {
        "nodes": [
            {
                "id": "a",
                "type": "task_card",
                "position": {"x": 0, "y": 0},
                "data": {"key": "DEMO-1"},
            }
        ],
        "edges": [],
    }
    client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": doc})
    assert "demo:DEMO-1" in client.get(f"/api/boards/{board['id']}").json()["tasks"]


def test_search_errors(client):
    bad = client.post("/api/tasks/search", json={"jql": 'summary ~ "open'})
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "invalid_jql"
    assert client.post("/api/tasks/search", json={"jql": "x", "limit": 101}).status_code == 422
    assert client.post("/api/tasks/search", json={"jql": ""}).status_code == 422
