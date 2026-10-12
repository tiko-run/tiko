import asyncio
import json
import logging
import re
import time
import uuid
from contextvars import ContextVar

from fastapi import Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

HTTP_REQUESTS = Counter("http_requests_total", "HTTP requests", ["method", "route", "status"])
HTTP_LATENCY = Histogram(
    "http_request_duration_seconds", "HTTP request latency", ["method", "route"]
)

# Finer than the default: a healthy loop and a healthy database answer in under a millisecond.
_FAST = (0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0)

LIVE_ROOMS = Gauge("tiko_live_rooms", "Boards held open in memory")
LIVE_SOCKETS = Gauge("tiko_live_sockets", "Open live sockets", ["kind"])
LIVE_OUTBOX = Gauge("tiko_live_outbox_max", "Messages waiting in the fullest queue of a socket")
LIVE_MESSAGES = Counter("tiko_live_messages", "Messages of live sockets", ["direction", "kind"])
LIVE_BYTES = Counter("tiko_live_bytes", "Bytes of live messages", ["direction"])
LIVE_CLOSES = Counter("tiko_live_closes", "Live sockets closed by the server", ["code"])
LIVE_CHECK = Histogram("tiko_live_check_seconds", "Check of a board after edits", buckets=_FAST)
LIVE_SAVE = Histogram("tiko_live_save_seconds", "Save of an open board", buckets=_FAST)
LIVE_NODES = Histogram(
    "tiko_live_board_nodes",
    "Elements of a board when it is saved",
    buckets=(10, 50, 100, 250, 500, 1000, 2500, 5000),
)
LOOP_LAG = Histogram("tiko_event_loop_lag_seconds", "How late the event loop runs", buckets=_FAST)
DB_WAIT = Histogram("tiko_db_wait_seconds", "Wait for the database connection", buckets=_FAST)
DB_HELD = Histogram("tiko_db_transaction_seconds", "Length of a transaction", buckets=_FAST)
THREADS_BUSY = Gauge("tiko_threadpool_busy", "Worker threads serving a request")
DEMO_VISITORS = Gauge("tiko_demo_visitors", "Demo visitors the instance keeps")
DEMO_LIMIT = Gauge("tiko_demo_limit", "Demo visitors the instance may keep")

LOOP_LAG_EVERY_S = 0.25
_KINDS = {0: "sync", 1: "awareness"}
# Looked up once: a live message is counted on the busiest path of the server.
_MESSAGES = {
    (direction, kind): LIVE_MESSAGES.labels(direction, kind)
    for direction in ("in", "out")
    for kind in ("sync", "awareness", "other")
}
_BYTES = {direction: LIVE_BYTES.labels(direction) for direction in ("in", "out")}


def live_message(direction: str, data: bytes) -> None:
    """Counts one message of a live socket by its y-websocket type."""
    _MESSAGES[direction, _KINDS.get(data[0], "other") if data else "other"].inc()
    _BYTES[direction].inc(len(data))


async def watch_loop() -> None:
    """Measures how much later than asked the loop wakes: the sign that one core is not enough."""
    loop = asyncio.get_running_loop()
    while True:
        asked = loop.time()
        await asyncio.sleep(LOOP_LAG_EVERY_S)
        LOOP_LAG.observe(max(0.0, loop.time() - asked - LOOP_LAG_EVERY_S))


_secrets: set[str] = set()


def register_secret(value: str) -> None:
    """Masks the value in every later log line; short values would mask too much."""
    if len(value) >= 8:
        _secrets.add(value)


def _mask(text: str) -> str:
    # A copy: request threads may register a token while another thread logs.
    for secret in tuple(_secrets):
        text = text.replace(secret, "***")
    return text


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return _mask(self._format(record))

    def _format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        payload.update(getattr(record, "fields", {}))
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


_PUBLIC_LINK = re.compile(r"(/api/public/)[\w-]+")


class _HidePublicLinks(logging.Filter):
    """uvicorn logs the path of every socket it accepts, and a public link is its own key."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg, record.args = _PUBLIC_LINK.sub(r"\1***", record.getMessage()), None
        return True


def setup_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=level.upper(), handlers=[handler], force=True)
    # uvicorn's access log duplicates ours without request ids.
    logging.getLogger("uvicorn.access").disabled = True
    errors = logging.getLogger("uvicorn.error")
    if not any(isinstance(known, _HidePublicLinks) for known in errors.filters):
        errors.addFilter(_HidePublicLinks())


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        token = request_id_var.set(request_id)
        start = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        elapsed = time.perf_counter() - start
        # Route template, not raw path, keeps metric cardinality bounded.
        route = getattr(request.scope.get("route"), "path", "unmatched")
        HTTP_REQUESTS.labels(request.method, route, response.status_code).inc()
        HTTP_LATENCY.labels(request.method, route).observe(elapsed)
        response.headers["x-request-id"] = request_id
        logging.getLogger("http").info(
            "request",
            extra={
                "fields": {
                    "request_id": request_id,
                    "method": request.method,
                    "route": route,
                    "status": response.status_code,
                    "duration_ms": round(elapsed * 1000, 1),
                }
            },
        )
        return response


def metrics_response() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
