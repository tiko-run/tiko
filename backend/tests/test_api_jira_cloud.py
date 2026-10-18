import httpx
import pytest

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in
from tests.jira_cloud_fake import EMAIL, FakeJiraCloud
from tests.jira_fake import TOKEN
from tests.test_api_refresh import board_with

CLOUD = "https://example.atlassian.net"


@pytest.fixture
def fake() -> FakeJiraCloud:
    return FakeJiraCloud()


@pytest.fixture
def cloud(fake):
    settings = Settings(db_path=":memory:", tiko_secret_key="test-secret-key")
    return signed_in(create_app(settings, jira_transport=httpx.MockTransport(fake)))


def connect(client, **jira):
    body = {"base_url": CLOUD, "token": TOKEN, "email": EMAIL} | jira
    return client.put("/api/settings", json={"provider": "jira", "jira": body})


def test_cloud_needs_the_email(cloud):
    refused = connect(cloud, email=None)
    assert refused.status_code == 422
    assert "e-mail" in refused.json()["error"]["message"]


def test_connect_resolve_and_refresh(cloud, fake):
    body = connect(cloud).json()
    assert body["jira"] == {"base_url": CLOUD, "token_state": "set", "kind": "cloud"}
    task = cloud.post("/api/tasks/resolve", json={"ref": "dev-1"}).json()["task"]
    assert (task["source"], task["url"]) == ("jira", f"{CLOUD}/browse/DEV-1")
    link = cloud.post("/api/tasks/resolve", json={"ref": f"{CLOUD}/browse/DEV-2"}).json()
    assert link["task"]["status_category"] == "done"

    board_id = board_with(cloud, "DEV-1", "DEV-9")
    refreshed = cloud.post(f"/api/boards/{board_id}/refresh").json()
    assert refreshed["tasks"]["jira:DEV-9"]["state"] == "not_found"
    assert refreshed["sources"][0]["name"] == "Jira Cloud"


def test_my_tracker_shows_kind_and_my_email(cloud):
    connect(cloud)
    tracker = cloud.get("/api/me/tracker").json()
    assert (tracker["kind"], tracker["email"]) == ("cloud", EMAIL)
    # A new token alone keeps the stored e-mail.
    assert cloud.put("/api/me/tracker", json={"token": TOKEN}).status_code == 200
    assert cloud.get("/api/me/tracker").json()["email"] == EMAIL


def test_connection_test_with_email(cloud):
    connect(cloud)
    assert cloud.post("/api/settings/jira/test", json={}).json()["user"] == "Alex Rivera"
    wrong = cloud.post(
        "/api/settings/jira/test", json={"token": TOKEN, "email": "someone.else@example.com"}
    )
    assert (wrong.status_code, wrong.json()["error"]["code"]) == (401, "jira_unauthorized")


def test_admin_tests_a_cloud_url_before_saving(cloud):
    tested = cloud.post(
        "/api/settings/jira/test", json={"base_url": CLOUD, "token": TOKEN, "email": EMAIL}
    )
    assert tested.json() == {"ok": True, "user": "Alex Rivera"}
    no_email = cloud.post("/api/settings/jira/test", json={"base_url": CLOUD, "token": TOKEN})
    assert no_email.status_code == 422


def test_cloud_credentials_never_go_over_plain_http(cloud, fake):
    connect(cloud, base_url="http://example.atlassian.net")
    fake.requests.clear()
    refused = cloud.post("/api/settings/jira/test", json={})
    assert refused.status_code == 422
    assert "https" in refused.json()["error"]["message"]
    assert all("authorization" not in r.headers for r in fake.requests)


def test_secrets_stay_on_the_server(cloud):
    connect(cloud)
    text = cloud.get("/api/settings").text + cloud.get("/api/me/tracker").text
    assert TOKEN not in text


def test_kind_is_asked_once(cloud, fake):
    connect(cloud)
    for _ in range(3):
        cloud.get("/api/settings")
        cloud.post("/api/tasks/resolve", json={"ref": "DEV-1"})
    assert sum(r.url.path.endswith("/serverInfo") for r in fake.requests) == 1


def test_usage_counts_jira_cloud(cloud):
    connect(cloud)
    cloud.post(f"/api/boards/{board_with(cloud, 'DEV-1')}/refresh")
    ping = cloud.app.state.privacy.ping()
    assert "jira_cloud" in ping.trackers and "jira_dc" not in ping.trackers
