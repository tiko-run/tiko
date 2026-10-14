from collections.abc import Callable
from urllib.parse import urlsplit

import httpx
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.transport import Transport

from app.domain.errors import DependencyUnavailable

# What an event keeps; the rest (request, user, host name, breadcrumbs, extra data) is dropped.
_KEEP = {"event_id", "timestamp", "platform", "level", "exception", "release", "environment",
         "tags", "fingerprint", "sdk"}  # fmt: skip
_FRAME = {"filename", "module", "function", "lineno", "colno", "in_app"}


def clean(event: dict) -> dict | None:
    """Only the error type and its code lines: messages can hold task data or addresses."""
    if "exception" not in event:
        return None
    event = {key: value for key, value in event.items() if key in _KEEP}
    for exc in event["exception"].get("values", []):
        exc.pop("value", None)
        exc.pop("mechanism", None)
        frames = (exc.get("stacktrace") or {}).get("frames", [])
        exc["stacktrace"] = {"frames": [{k: f[k] for k in _FRAME if k in f} for f in frames]}
    return event


def start(
    dsn: str,
    enabled: Callable[[], bool],
    version: str,
    deploy: str,
    transport: type[Transport] | None = None,
) -> None:
    """Error reports, sent only while `enabled()` says so; see the guide's privacy page."""

    def before_send(event: dict, _hint: dict) -> dict | None:
        try:
            on = enabled()
        except Exception:
            return None
        return clean(event) if on else None

    sentry_sdk.init(
        dsn=dsn,
        release=version,
        environment="self-hosted",
        server_name="",
        # Only unhandled errors of requests: no log capture, no patched HTTP clients.
        default_integrations=False,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        # No trace headers on calls to trackers, and nothing that counts requests.
        trace_propagation_targets=[],
        traces_sample_rate=0,
        auto_session_tracking=False,
        send_client_reports=False,
        include_local_variables=False,
        max_breadcrumbs=0,
        data_collection={
            "user_info": False,
            "gen_ai": {"inputs": False, "outputs": False},
            "graphql": {"document": False, "variables": False},
            "database_query_data": False,
            "queues": False,
            "http_bodies": [],
            "cookies": {"mode": "allowlist", "terms": []},
            "http_headers": {"request": {"mode": "allowlist", "terms": []}},
            "url_query_params": {"mode": "allowlist", "terms": []},
        },
        before_send=before_send,
        before_send_transaction=lambda _event, _hint: None,
        transport=transport,
    )
    sentry_sdk.set_tag("deploy", deploy)


class SentryTunnel:
    """Sends the page's reports from the server, so Sentry never sees the instance's address."""

    def __init__(self, dsn: str, client: httpx.Client) -> None:
        parts = urlsplit(dsn)
        project = parts.path.rstrip("/").rsplit("/", 1)[-1]
        self._dsn = dsn
        self._url = f"{parts.scheme}://{parts.hostname}/api/{project}/envelope/"
        self._client = client

    def forward(self, envelope: bytes) -> None:
        header = envelope.split(b"\n", 1)[0]
        # Only envelopes for our own project; anything else would make this an open relay.
        if f'"dsn":"{self._dsn}"'.encode() not in header.replace(b" ", b""):
            raise ValueError("envelope for another project")
        try:
            self._client.post(
                self._url,
                content=envelope,
                headers={"Content-Type": "application/x-sentry-envelope"},
            ).raise_for_status()
        except httpx.HTTPError as exc:
            raise DependencyUnavailable("could not forward the error report") from exc
