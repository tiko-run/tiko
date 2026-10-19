from tests.jira_fake import TOKEN


def test_demo_vocabulary(client):
    body = client.get("/api/jql/vocabulary").json()
    status = next(f for f in body["fields"] if f["name"] == "status")
    assert "=" in status["operators"]
    assert "AND" in body["keywords"]


def test_demo_values_are_quoted_when_needed(client):
    body = client.get("/api/jql/values", params={"field": "status", "prefix": "in"}).json()
    assert [v["value"] for v in body["values"]] == ['"In Progress"', '"In Review"']
    assert client.get("/api/jql/values", params={"field": "summary"}).json() == {"values": []}
    assert client.get("/api/jql/values").status_code == 422


def test_count_only_search(client):
    body = client.post("/api/tasks/search", json={"jql": 'status = "Done"', "limit": 0}).json()
    assert body == {"tasks": [], "total": 1, "estimated": False}


def test_jira_vocabulary_through_the_api(jira_client):
    jira_client.put(
        "/api/settings",
        json={"provider": "jira", "jira": {"base_url": "https://jira.example.com", "token": TOKEN}},
    )
    body = jira_client.get("/api/jql/values", params={"field": "status", "prefix": "do"}).json()
    assert body == {"values": [{"value": "Done", "label": "Done"}]}
