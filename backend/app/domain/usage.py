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


class PrivacyView(BaseModel):
    usage_stats: bool
    # Set in the environment, so the API does not change it.
    locked: list[Literal["usage_stats"]]
    next_ping: dict


class UsageStats:
    """Counts without personal data, on unless the admin or TIKO_USAGE_STATS turns them off."""

    def __init__(
        self,
        repo: SettingsRepo,
        counts: UsageCounts,
        sender: StatsSender,
        version: str,
        deploy: Deploy,
        arch: str,
        updater: bool,
        env: bool | None = None,
    ) -> None:
        self._repo = repo
        self._counts = counts
        self._sender = sender
        self._version = version
        self._deploy = deploy
        self._arch = arch
        self._updater = updater
        self._env = env

    def instance_id(self) -> str:
        """A random id made once; it says nothing about the host or the people on it."""
        stored = self._repo.get_all().get("instance_id")
        if stored:
            return stored
        made = str(uuid.uuid4())
        self._repo.set_many({"instance_id": made})
        return made

    def enabled(self) -> bool:
        if self._env is not None:
            return self._env
        return self._repo.get_all().get("usage_stats") != "0"

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
            locked=["usage_stats"] if self._env is not None else [],
            next_ping=self.ping().body(),
        )

    def set_enabled(self, on: bool) -> PrivacyView:
        if self._env is not None:
            raise ValidationFailed("This is set by the server in TIKO_USAGE_STATS.")
        self._repo.set_many({"usage_stats": "1" if on else "0"})
        return self.view()
