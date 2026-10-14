import re
from collections.abc import Callable

import sentry_sdk
from sentry_sdk.transport import Transport

_URL = re.compile(r"[a-zA-Z][a-zA-Z0-9+.-]*://[^\s'\"<>]+")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_HOST = re.compile(r"\b(?:[a-zA-Z0-9-]+\.)+(?:[a-zA-Z]{2,}|local|internal|lan|corp)\b")
_IP = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
# Python file names look like host names to _HOST.
_FILE = re.compile(r"\b[\w./-]+\.(?:py|js|ts|tsx|json|sql|toml)\b")

# What an event keeps; the rest (request, user, host name, breadcrumbs, extra data) is dropped.
_KEEP = {"event_id", "timestamp", "platform", "level", "logger", "exception", "logentry",
         "message", "release", "environment", "tags", "fingerprint", "sdk"}  # fmt: skip


def scrub(text: str) -> str:
    """Addresses, host names and emails out of a message, so a tracker URL never leaves."""
    files: list[str] = []

    def keep_file(match: re.Match[str]) -> str:
        files.append(match.group(0))
        return f"\0{len(files) - 1}\0"

    text = _FILE.sub(keep_file, text)
    text = _URL.sub("<url>", text)
    text = _EMAIL.sub("<email>", text)
    text = _IP.sub("<ip>", text)
    text = _HOST.sub("<host>", text)
    return re.sub(r"\0(\d+)\0", lambda m: files[int(m.group(1))], text)


def clean(event: dict) -> dict:
    event = {key: value for key, value in event.items() if key in _KEEP}
    for exc in event.get("exception", {}).get("values", []):
        if isinstance(exc.get("value"), str):
            exc["value"] = scrub(exc["value"])
        for frame in (exc.get("stacktrace") or {}).get("frames", []):
            frame.pop("vars", None)
            # The path inside the image, never the host's.
            if isinstance(frame.get("abs_path"), str):
                frame["abs_path"] = frame.get("filename", "")
    for key in ("message", "logentry"):
        entry = event.get(key)
        if isinstance(entry, str):
            event[key] = scrub(entry)
        elif isinstance(entry, dict):
            entry.pop("params", None)
            for field in ("message", "formatted"):
                if isinstance(entry.get(field), str):
                    entry[field] = scrub(entry[field])
    return event


def start(
    dsn: str,
    enabled: Callable[[], bool],
    version: str,
    deploy: str,
    transport: type[Transport] | None = None,
) -> None:
    """Error reports, sent only while `enabled()` says so; see the guide's Usage stats page."""

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
        # Nothing about people or requests is collected; before_send drops the rest.
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
        include_local_variables=False,
        max_breadcrumbs=0,
        traces_sample_rate=0,
        before_send=before_send,
        before_send_transaction=lambda _event, _hint: None,
        transport=transport,
    )
    sentry_sdk.set_tag("deploy", deploy)
