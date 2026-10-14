import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.jira_fake import FakeJira

PASSWORD = "test-password"


@pytest.fixture(autouse=True)
def instance_password(monkeypatch):
    monkeypatch.setenv("TIKO_PASSWORD", PASSWORD)
    # No test reaches the real collector.
    monkeypatch.setenv("TIKO_STATS_URL", "http://127.0.0.1:9/")
    monkeypatch.setenv("TIKO_ERROR_REPORTS", "false")


def signed_in(app, username: str = "admin", password: str = PASSWORD) -> TestClient:
    """A client with a session; by default the admin made from TIKO_PASSWORD."""
    client = TestClient(app)
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 204
    return client


@pytest.fixture
def client() -> TestClient:
    return signed_in(create_app(Settings(db_path=":memory:")))


@pytest.fixture
def fake_jira() -> FakeJira:
    return FakeJira()


@pytest.fixture
def jira_client(fake_jira) -> TestClient:
    """App with a secret key and a fake Jira DC behind the HTTP transport."""
    settings = Settings(db_path=":memory:", tiko_secret_key="test-secret-key")
    return signed_in(create_app(settings, jira_transport=httpx.MockTransport(fake_jira)))
