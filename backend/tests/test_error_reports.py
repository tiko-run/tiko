import sentry_sdk
from sentry_sdk.transport import Transport

from app.adapters.errors.sentry import clean, scrub
from app.adapters.stats.mock import MockStatsSender
from app.config import Settings
from app.main import create_app
from app.version import VERSION
from tests.conftest import signed_in

DSN = "https://public@o1.ingest.de.sentry.io/1"


class Captured(Transport):
    events: list[dict] = []

    def capture_envelope(self, envelope) -> None:
        for item in envelope.items:
            if item.headers.get("type") == "event":
                Captured.events.append(item.payload.json)


def app_with(**settings):
    Captured.events = []
    app = create_app(
        Settings(db_path=":memory:", tiko_error_reports_dsn=DSN, **settings),
        stats_sender=MockStatsSender(),
        error_transport=Captured,
    )
    return app


def boom(message: str) -> None:
    try:
        raise ValueError(message)
    except ValueError:
        sentry_sdk.capture_exception()
    sentry_sdk.flush()


def test_scrub_hides_addresses_hosts_and_emails():
    text = scrub(
        "GET https://jira.corp.example.com/rest/api/2/search failed for ann@example.com"
        " via jira.corp.example.com and 10.0.0.12 in app/domain/tasks.py"
    )
    assert text == "GET <url> failed for <email> via <host> and <ip> in app/domain/tasks.py"


def test_clean_keeps_only_the_error():
    event = {
        "exception": {"values": [{"value": "bad https://x.example.com", "stacktrace": {"frames": [
            {"filename": "app/main.py", "abs_path": "/srv/me/app/main.py", "vars": {"t": "s"}}
        ]}}]},
        "request": {"url": "https://tiko.example.com/board/42"},
        "user": {"ip_address": "1.2.3.4"},
        "server_name": "ann-laptop",
        "breadcrumbs": {"values": [{"message": "x"}]},
        "contexts": {"os": {"name": "Linux"}},
        "extra": {"sys.argv": ["uvicorn"]},
        "release": VERSION,
        "tags": {"deploy": "compose"},
    }  # fmt: skip
    cleaned = clean(event)
    assert set(cleaned) == {"exception", "release", "tags"}
    exc = cleaned["exception"]["values"][0]
    assert exc["value"] == "bad <url>"
    assert exc["stacktrace"]["frames"][0] == {"filename": "app/main.py", "abs_path": "app/main.py"}


def test_off_by_default_sends_nothing():
    app = app_with()
    assert app.state.usage.errors_enabled() is False
    boom("nothing leaves")
    assert Captured.events == []


def test_turned_on_by_an_admin_sends_without_a_restart():
    app = app_with()
    admin = signed_in(app)
    view = admin.put("/api/privacy", json={"error_reports": True}).json()
    assert view["error_reports"] is True and view["error_reports_available"] is True
    boom("lookup failed for https://jira.example.com/browse/ABC-1")
    assert len(Captured.events) == 1
    event = Captured.events[0]
    assert event["exception"]["values"][0]["value"] == "lookup failed for <url>"
    assert event["release"] == VERSION
    assert event["tags"] == {"deploy": "compose"}
    for gone in ("request", "user", "server_name", "breadcrumbs", "contexts", "extra"):
        assert gone not in event


def test_env_locks_the_switch():
    app = app_with(tiko_error_reports=False)
    admin = signed_in(app)
    assert admin.get("/api/privacy").json()["locked"] == ["error_reports"]
    assert admin.put("/api/privacy", json={"error_reports": True}).status_code == 422


def test_without_a_dsn_the_switch_cannot_turn_on():
    app = create_app(Settings(db_path=":memory:"), stats_sender=MockStatsSender())
    admin = signed_in(app)
    assert admin.get("/api/privacy").json()["error_reports_available"] is False
    assert admin.put("/api/privacy", json={"error_reports": True}).status_code == 422


def test_page_gets_the_dsn_only_while_reports_are_on():
    app = app_with()
    admin = signed_in(app)
    assert admin.get("/api/privacy/page").json() == {
        "dsn": None,
        "version": VERSION,
        "deploy": "compose",
    }
    admin.put("/api/privacy", json={"error_reports": True})
    assert admin.get("/api/privacy/page").json()["dsn"] == DSN
