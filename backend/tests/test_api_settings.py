from tests.jira_fake import TOKEN

JIRA = {"base_url": "https://jira.example.com/", "token": TOKEN}


def connect(client):
    response = client.put("/api/settings", json={"provider": "jira", "jira": JIRA})
    assert response.status_code == 200
    return response.json()


def test_defaults(client):
    assert client.get("/api/settings").json() == {
        "provider": "demo",
        "refresh_interval_s": 30,
        "secret_key_configured": False,
        "jira": {"base_url": None, "token_state": "none", "kind": None},
        "public_links": True,
        "locked": [],
    }


def test_saving_token_needs_secret_key(client):
    response = client.put("/api/settings", json={"jira": JIRA})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "secret_key_missing"


def test_connect_and_resolve_real_card(jira_client):
    body = connect(jira_client)
    assert body["jira"] == {
        "base_url": "https://jira.example.com",
        "token_state": "set",
        "kind": "dc",
    }
    task = jira_client.post("/api/tasks/resolve", json={"ref": "dev-1"}).json()["task"]
    assert task["url"] == "https://jira.example.com/browse/DEV-1"
    link = jira_client.post(
        "/api/tasks/resolve", json={"ref": "https://jira.example.com/browse/DEV-2"}
    )
    assert link.json()["task"]["status_category"] == "done"


def test_token_kept_when_omitted(jira_client):
    connect(jira_client)
    jira_client.put("/api/settings", json={"jira": {"base_url": "https://jira.example.com"}})
    assert jira_client.get("/api/settings").json()["jira"]["token_state"] == "set"


def test_interval_bounds(jira_client):
    assert jira_client.put("/api/settings", json={"refresh_interval_s": 29}).status_code == 422
    assert jira_client.put("/api/settings", json={"refresh_interval_s": 300}).status_code == 200


def test_bad_url_rejected(jira_client):
    response = jira_client.put("/api/settings", json={"jira": {"base_url": "ftp://x"}})
    assert response.status_code == 422


def test_connection_test(jira_client, fake_jira):
    ok = jira_client.post("/api/settings/jira/test", json=JIRA)
    assert ok.json() == {"ok": True, "user": "Alex Rivera"}
    bad = jira_client.post("/api/settings/jira/test", json=JIRA | {"token": "wrong-token"})
    assert (bad.status_code, bad.json()["error"]["code"]) == (401, "jira_unauthorized")
    fake_jira.fail = 503
    down = jira_client.post("/api/settings/jira/test", json=JIRA)
    assert (down.status_code, down.json()["error"]["code"]) == (503, "jira_unavailable")


def test_jira_not_configured(jira_client):
    jira_client.put("/api/settings", json={"provider": "jira"})
    response = jira_client.post("/api/tasks/resolve", json={"ref": "DEV-1"})
    assert (response.status_code, response.json()["error"]["code"]) == (400, "jira_not_configured")


def test_rate_limit_passes_retry_after(jira_client, fake_jira):
    connect(jira_client)
    fake_jira.fail = 429
    response = jira_client.post("/api/tasks/resolve", json={"ref": "DEV-1"})
    assert response.status_code == 429
    assert response.headers["retry-after"] == "42"


def test_changed_secret_key_makes_token_unreadable(tmp_path, fake_jira):
    import httpx

    from app.config import Settings
    from app.main import create_app
    from tests.conftest import signed_in

    db = str(tmp_path / "app.db")
    transport = httpx.MockTransport(fake_jira)
    first = signed_in(create_app(Settings(db_path=db, tiko_secret_key="one"), transport))
    connect(first)
    second = signed_in(create_app(Settings(db_path=db, tiko_secret_key="two"), transport))
    assert second.get("/api/settings").json()["jira"]["token_state"] == "unreadable"
    response = second.post("/api/tasks/resolve", json={"ref": "DEV-1"})
    assert response.json()["error"]["code"] == "jira_not_configured"


def test_blank_token_keeps_stored_one(jira_client):
    connect(jira_client)
    body = jira_client.put("/api/settings", json={"jira": JIRA | {"token": "  "}}).json()
    assert body["jira"]["token_state"] == "set"


def test_pasted_token_with_newline_works(jira_client):
    response = jira_client.post("/api/settings/jira/test", json=JIRA | {"token": TOKEN + "\n"})
    assert response.json()["ok"] is True


def test_empty_secret_key_is_not_configured(fake_jira):
    import httpx

    from app.config import Settings
    from app.main import create_app
    from tests.conftest import signed_in

    settings = Settings(db_path=":memory:", tiko_secret_key="")
    app = create_app(settings, jira_transport=httpx.MockTransport(fake_jira))
    assert signed_in(app).get("/api/settings").json()["secret_key_configured"] is False


def test_tracker_from_the_environment_wins_and_is_locked():
    from app.config import Settings
    from app.main import create_app
    from tests.conftest import signed_in

    settings = Settings(
        db_path=":memory:", tiko_tracker="jira", jira_base_url="https://jira.example.com/"
    )
    client = signed_in(create_app(settings))
    body = client.get("/api/settings").json()
    assert body["provider"] == "jira" and body["jira"]["base_url"] == "https://jira.example.com"
    assert body["locked"] == ["jira_base_url", "provider"]
    moved = client.put("/api/settings", json={"jira": {"base_url": "https://other.example.com"}})
    assert (moved.status_code, moved.json()["error"]["code"]) == (422, "validation_failed")
    assert client.put("/api/settings", json={"provider": "demo"}).status_code == 422
    # Saving the unchanged values with another field is fine, as the form does.
    same = {
        "provider": "jira",
        "refresh_interval_s": 60,
        "jira": {"base_url": body["jira"]["base_url"]},
    }
    assert client.put("/api/settings", json=same).json()["refresh_interval_s"] == 60


def test_a_wrong_jira_url_in_the_environment_stops_the_start():
    import pytest

    from app.config import Settings
    from app.main import create_app

    with pytest.raises(ValueError):
        create_app(Settings(db_path=":memory:", jira_base_url="jira.example.com"))
