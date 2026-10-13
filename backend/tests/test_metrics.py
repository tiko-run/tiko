from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in

TOKEN = "test-metrics-token"


def app_with(**settings):
    return create_app(Settings(_env_file=None, db_path=":memory:", **settings))


def value(text: str, sample: str) -> float:
    line = next(line for line in text.splitlines() if line.startswith(sample + " "))
    return float(line.rsplit(" ", 1)[1])


def test_an_open_board_shows_in_the_metrics():
    admin = signed_in(app_with())
    board = admin.post("/api/boards", json={"name": "Plan"}).json()
    before = admin.get("/metrics").text
    with admin.websocket_connect(f"/api/boards/{board['id']}/live") as socket:
        socket.receive_bytes()
        text = admin.get("/metrics").text
    assert value(text, "tiko_live_rooms") == 1
    assert value(text, 'tiko_live_sockets{kind="person"}') == 1
    assert value(text, 'tiko_live_sockets{kind="guest"}') == 0
    sent = 'tiko_live_messages_total{direction="out",kind="sync"}'
    assert value(text, sent) > value(before, sent)
    assert value(text, 'tiko_live_bytes_total{direction="out"}') > 0


def test_the_database_and_the_runtime_are_measured():
    text = signed_in(app_with()).get("/metrics").text
    for name in (
        "tiko_db_wait_seconds_count",
        "tiko_db_transaction_seconds_count",
        "tiko_threadpool_busy",
        "tiko_event_loop_lag_seconds_bucket",
        "tiko_live_check_seconds_bucket",
        "tiko_live_save_seconds_bucket",
        "tiko_live_board_nodes_bucket",
    ):
        assert name in text, name
    assert value(text, "tiko_db_transaction_seconds_count") > 0


def test_the_loop_is_watched_while_the_app_runs(monkeypatch):
    monkeypatch.setattr("app.observability.LOOP_LAG_EVERY_S", 0.01)
    with signed_in(app_with()) as admin:
        before = value(admin.get("/metrics").text, "tiko_event_loop_lag_seconds_count")
        for _ in range(50):
            admin.get("/health")
        assert value(admin.get("/metrics").text, "tiko_event_loop_lag_seconds_count") > before


def test_a_demo_instance_counts_its_visitors():
    app = app_with(tiko_demo=True, tiko_demo_limit=7)
    visitor = TestClient(app)
    assert visitor.post("/api/auth/demo", headers={"x-real-ip": "203.0.113.1"}).status_code == 204
    text = signed_in(app).get("/metrics").text
    assert value(text, "tiko_demo_visitors") == 1
    assert value(text, "tiko_demo_limit") == 7
    # The numbers of the instance are not for the people it serves.
    assert visitor.get("/metrics").status_code == 404


def test_monitoring_reads_the_metrics_with_the_token():
    app = app_with(tiko_metrics_token=TOKEN)
    scraper = TestClient(app)
    answer = scraper.get("/metrics", headers={"authorization": f"Bearer {TOKEN}"})
    assert answer.status_code == 200 and "tiko_live_rooms" in answer.text
    assert scraper.get("/metrics", headers={"authorization": "Bearer wrong"}).status_code == 401
    assert scraper.get("/metrics").status_code == 401
    # The token opens the metrics and nothing else.
    boards = scraper.get("/api/boards", headers={"authorization": f"Bearer {TOKEN}"})
    assert boards.status_code == 401


def test_without_a_token_set_no_header_opens_the_metrics():
    scraper = TestClient(app_with())
    assert scraper.get("/metrics", headers={"authorization": "Bearer "}).status_code == 401


def test_a_socket_the_server_refuses_is_counted_under_its_code(monkeypatch):
    monkeypatch.setattr("app.adapters.live.rooms.MAX_CONNECTIONS", 1)
    admin = signed_in(app_with())
    board = admin.post("/api/boards", json={"name": "Plan"}).json()
    full = 'tiko_live_closes_total{code="4429"}'
    text = admin.get("/metrics").text
    before = value(text, full) if full in text else 0
    with admin.websocket_connect(f"/api/boards/{board['id']}/live") as first:
        first.receive_bytes()
        with admin.websocket_connect(f"/api/boards/{board['id']}/live") as second:
            assert second.receive()["code"] == 4429
    assert value(admin.get("/metrics").text, full) == before + 1
