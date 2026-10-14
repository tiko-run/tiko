import logging
import uuid
from typing import Literal

from pydantic import BaseModel

from app.domain.errors import DependencyUnavailable, ValidationFailed
from app.domain.ports import SettingsRepo, StatsSender, UsageCounts

log = logging.getLogger(__name__)

SCHEMA = 1
FIRST_PING_S = 600
PING_EVERY_S = 86400
PING_JITTER_S = 3600

Bucket = Literal["0", "1", "2-5", "6-20", "21-100", "100+"]
Tracker = Literal["demo", "jira_dc", "github"]
Deploy = Literal["installer", "compose", "railway", "render", "source", "demo"]

# Snapshot sources as stored, named as the guide lists them.
_TRACKERS: dict[str, Tracker] = {"demo": "demo", "jira": "jira_dc", "github": "github"}


def bucket(count: int) -> Bucket:
    if count <= 1:
        return "0" if count <= 0 else "1"
    if count <= 5:
        return "2-5"
    if count <= 20:
        return "6-20"
    return "21-100" if count <= 100 else "100+"


class Ping(BaseModel):
    """Everything the daily ping sends; the guide lists these fields and a test holds it to that."""

    schema_version: int = SCHEMA
    instance_id: str
    version: str
    deploy: Deploy
    arch: str
    trackers: list[Tracker]
    people: Bucket
    boards: Bucket
    updater: bool

    def body(self) -> dict:
        data = self.model_dump()
        data["schema"] = data.pop("schema_version")
        return {"kind": "ping", **data}


Switch = Literal["usage_stats", "error_reports"]


class PrivacyView(BaseModel):
    usage_stats: bool
    error_reports: bool
    # False when the instance has no address to send error reports to.
    error_reports_available: bool
    # Set in the environment, so the API does not change it.
    locked: list[Switch]
    next_ping: dict


class PageReports(BaseModel):
    """What the page needs to report its own errors; no DSN while reports are off."""

    dsn: str | None
    version: str
    deploy: Deploy


class PrivacyIn(BaseModel):
    usage_stats: bool | None = None
    error_reports: bool | None = None


class Privacy:
    """What the instance sends about itself: usage counts, on unless turned off, and error
    reports, off unless turned on. An ENV variable wins over the admin's setting."""

    def __init__(
        self,
        repo: SettingsRepo,
        counts: UsageCounts,
        sender: StatsSender,
        version: str,
        deploy: Deploy,
        arch: str,
        updater: bool,
        usage_env: bool | None = None,
        errors_env: bool | None = None,
        errors_dsn: str = "",
    ) -> None:
        self._repo = repo
        self._counts = counts
        self._sender = sender
        self._version = version
        self._deploy = deploy
        self._arch = arch
        self._updater = updater
        self._env: dict[Switch, bool | None] = {
            "usage_stats": usage_env,
            "error_reports": errors_env,
        }
        self._errors_dsn = errors_dsn
        self._errors_available = bool(errors_dsn)

    def instance_id(self) -> str:
        """A random id made once; it says nothing about the host or the people on it."""
        stored = self._repo.get_all().get("instance_id")
        if stored:
            return stored
        made = str(uuid.uuid4())
        self._repo.set_many({"instance_id": made})
        return made

    def _on(self, switch: Switch, default: bool) -> bool:
        if (env := self._env[switch]) is not None:
            return env
        stored = self._repo.get_all().get(switch)
        return default if stored is None else stored == "1"

    def enabled(self) -> bool:
        return self._on("usage_stats", default=True)

    def errors_enabled(self) -> bool:
        """Read for every report, so a change in Settings needs no restart."""
        return self._errors_available and self._on("error_reports", default=False)

    def ping(self) -> Ping:
        trackers = sorted({_TRACKERS[s] for s in self._counts.sources() if s in _TRACKERS})
        return Ping(
            instance_id=self.instance_id(),
            version=self._version,
            deploy=self._deploy,
            arch=self._arch,
            trackers=trackers,
            people=bucket(self._counts.people()),
            boards=bucket(self._counts.boards()),
            updater=self._updater,
        )

    def send_ping(self) -> bool:
        if not self.enabled():
            return False
        try:
            self._sender.send(self.ping().body())
        except DependencyUnavailable:
            # Nobody should notice the collector being down.
            log.debug("usage ping not sent", exc_info=True)
            return False
        return True

    def view(self) -> PrivacyView:
        return PrivacyView(
            usage_stats=self.enabled(),
            error_reports=self.errors_enabled(),
            error_reports_available=self._errors_available,
            locked=[switch for switch, env in self._env.items() if env is not None],
            next_ping=self.ping().body(),
        )

    def update(self, change: PrivacyIn) -> PrivacyView:
        values = {
            switch: on
            for switch, on in (
                ("usage_stats", change.usage_stats),
                ("error_reports", change.error_reports),
            )
            if on is not None
        }
        for switch in values:
            if self._env[switch] is not None:
                raise ValidationFailed(f"This is set by the server in TIKO_{switch.upper()}.")
        if values.get("error_reports") and not self._errors_available:
            raise ValidationFailed("This instance has no address for error reports.")
        self._repo.set_many({switch: "1" if on else "0" for switch, on in values.items()})
        return self.view()

    def page_reports(self) -> PageReports:
        return PageReports(
            dsn=self._errors_dsn if self.errors_enabled() else None,
            version=self._version,
            deploy=self._deploy,
        )
