import httpx
import sentry_sdk
from sentry_sdk.transport import Transport

from app.adapters.errors.sentry import SentryTunnel, clean
from app.adapters.stats.mock import MockStatsSender
from app.config import Settings
from app.main import create_app
from app.version import VERSION
from tests.conftest import signed_in

DSN = "https://public@o1.ingest.de.sentry.io/1"


class Captured(Transport):
    events: list[dict] = []
    kinds: list[str] = []

    def capture_envelope(self, envelope) -> None:
        for item in envelope.items:
            Captured.kinds.append(item.headers.get("type"))
            if item.headers.get("type") == "event":
                Captured.events.append(item.payload.json)


def app_with(**settings):
    Captured.events = []
    Captured.kinds = []
    settings = {"tiko_error_reports": None, **settings}
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


def test_clean_keeps_only_the_error_type_and_its_code_lines():
    event = {
        "exception": {"values": [{"type": "ValidationError",
            "value": "input_value={'summary': 'Fire Ann'} at https://jira.example.com",
            "mechanism": {"type": "starlette"},
            "stacktrace": {"frames": [{"filename": "app/main.py", "abs_path": "/home/ann/main.py",
                "function": "sync", "lineno": 12, "vars": {"t": "s"}, "context_line": "x = s"}]}}]},
        "request": {"url": "https://tiko.example.com/board/42"},
        "user": {"ip_address": "1.2.3.4"},
        "server_name": "ann-laptop",
        "breadcrumbs": {"values": [{"message": "x"}]},
        "contexts": {"os": {"name": "Linux"}},
        "logentry": {"message": "sync of %s", "params": ["ABC-1"]},
        "release": VERSION,
        "tags": {"deploy": "compose"},
    }  # fmt: skip
    cleaned = clean(event)
    assert set(cleaned) == {"exception", "release", "tags"}
    assert cleaned["exception"]["values"][0] == {
        "type": "ValidationError",
        "stacktrace": {"frames": [{"filename": "app/main.py", "function": "sync", "lineno": 12}]},
    }


def test_a_log_line_without_an_error_is_not_sent():
    assert clean({"logentry": {"message": "sync failed for ABC-1"}}) is None


def test_off_by_default_sends_nothing_at_all():
    app = app_with()
    assert app.state.privacy.errors_enabled() is False
    client = signed_in(app)
    for _ in range(3):
        client.get("/api/boards")
    boom("nothing leaves")
    sentry_sdk.flush()
    # Not even sessions or client reports, which count requests.
    assert Captured.kinds == []


def test_turned_on_by_an_admin_sends_without_a_restart():
    app = app_with()
    admin = signed_in(app)
    view = admin.put("/api/privacy", json={"error_reports": True}).json()
    assert view["error_reports"] is True and view["error_reports_available"] is True
    boom("lookup failed for https://jira.example.com/browse/ABC-1")
    assert len(Captured.events) == 1
    event = Captured.events[0]
    assert "value" not in event["exception"]["values"][0]
    assert event["release"] == VERSION
    assert event["tags"] == {"deploy": "compose"}
    for gone in ("request", "user", "server_name", "breadcrumbs", "contexts", "extra"):
        assert gone not in event


def test_env_locks_the_switch():
    app = app_with(tiko_error_reports=True)
    admin = signed_in(app)
    assert admin.get("/api/privacy").json()["locked"] == ["error_reports"]
    assert admin.put("/api/privacy", json={"error_reports": False}).status_code == 422


def test_env_off_locks_the_switch_off():
    app = app_with(tiko_error_reports=False)
    admin = signed_in(app)
    assert admin.get("/api/privacy").json()["locked"] == ["error_reports"]
    assert admin.put("/api/privacy", json={"error_reports": True}).status_code == 422


def test_without_a_dsn_the_switch_cannot_turn_on():
    app = create_app(
        Settings(db_path=":memory:", tiko_error_reports_dsn="", tiko_error_reports=None),
        stats_sender=MockStatsSender(),
    )
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


def test_no_trace_headers_on_calls_to_trackers():
    app = app_with(tiko_error_reports=True)
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200)

    with sentry_sdk.start_transaction(name="probe"):
        httpx.Client(transport=httpx.MockTransport(handler)).get("https://jira.example.com/x")
    assert app.state.error_tunnel is not None
    assert "sentry-trace" not in seen[0].headers
    assert "baggage" not in seen[0].headers


def page_tunnel(app):
    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200)

    app.state.error_tunnel = SentryTunnel(DSN, httpx.Client(transport=httpx.MockTransport(handler)))
    return sent


def envelope(dsn: str = DSN) -> bytes:
    return f'{{"dsn":"{dsn}"}}\n{{"type":"event"}}\n{{}}\n'.encode()


def test_page_reports_go_through_the_server_only_while_on():
    app = app_with()
    sent = page_tunnel(app)
    admin = signed_in(app)
    assert admin.post("/api/privacy/errors", content=envelope()).status_code == 403
    admin.put("/api/privacy", json={"error_reports": True})
    assert admin.post("/api/privacy/errors", content=envelope()).status_code == 204
    assert str(sent[0].url) == "https://o1.ingest.de.sentry.io/api/1/envelope/"
    assert "origin" not in sent[0].headers


def test_the_tunnel_carries_only_our_project():
    app = app_with(tiko_error_reports=True)
    sent = page_tunnel(app)
    other = "https://key@o9.ingest.us.sentry.io/9"
    assert signed_in(app).post("/api/privacy/errors", content=envelope(other)).status_code == 422
    assert sent == []
