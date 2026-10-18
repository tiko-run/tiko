import re
from datetime import UTC, datetime
from typing import Literal, NoReturn
from urllib.parse import urlparse

from pydantic import BaseModel

from app.domain.errors import DomainError, HostMismatch, InvalidRef
from app.domain.ports import SnapshotRepo, TaskProvider

KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]+-\d+$")
_BROWSE_RE = re.compile(r"/browse/([A-Za-z][A-Za-z0-9_]+-\d+)/?$")

GITHUB = "github"
_REPO = r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+"
GITHUB_KEY_RE = re.compile(rf"^{_REPO}#[1-9]\d*$")
# A link to an issue or a pull request, with whatever follows: a tab, a comment anchor.
_GITHUB_LINK_RE = re.compile(
    rf"^https?://(?:www\.)?github\.com/({_REPO})/(?:issues|pull)/([1-9]\d*)(?:[/?#].*)?$"
)

SOURCE_PATTERN = r"^[a-z][a-z0-9_]{0,39}$"

StatusCategory = Literal["new", "indeterminate", "done"]


def task_ref(source: str, key: str) -> str:
    """What identifies a task: two trackers may use the same key."""
    return f"{source}:{key}"


def split_ref(ref: str) -> tuple[str, str]:
    source, _, key = ref.partition(":")
    return source, key


class TaskLabel(BaseModel):
    name: str
    # Six hex digits without "#", or empty when the tracker gives none.
    color: str = ""


class TaskRow(BaseModel):
    label: str
    value: str


class Task(BaseModel):
    # The tracker the task comes from, a provider's `source_id`.
    source: str
    key: str
    # not_found also covers a task the person's own token may not see: Jira hides both alike.
    # private: a guest of a public board sees the key only.
    state: Literal["ok", "not_found", "no_token", "private"] = "ok"
    summary: str = ""
    status_name: str = ""
    status_category: StatusCategory = "new"
    type_name: str = ""
    assignee_name: str | None = None
    priority_name: str | None = None
    updated: str | None = None
    url: str
    fetched_at: str
    # What only some trackers have, shown in the mini-card: chips and extra rows.
    labels: list[TaskLabel] = []
    rows: list[TaskRow] = []

    @property
    def ref(self) -> str:
        return task_ref(self.source, self.key)


def valid_key(source: str | None, key: str) -> bool:
    """Whether the key has the shape its tracker uses; a missing source is the instance's."""
    return bool((GITHUB_KEY_RE if source == GITHUB else KEY_RE).match(key))


def github_key(ref: str) -> str | None:
    """The key in a GitHub link or a typed `owner/repo#number`; None for anything else."""
    text = ref.strip()
    if match := _GITHUB_LINK_RE.match(text):
        return f"{match.group(1)}#{match.group(2)}"
    return text if GITHUB_KEY_RE.match(text) else None


def github_url(key: str) -> str:
    """The issue page of a key; GitHub sends a pull request's number on to the pull request."""
    repo, _, number = key.rpartition("#")
    return f"https://github.com/{repo}/issues/{number}"


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def parse_ref(ref: str, base_host: str) -> str:
    """Returns the issue key from a bare key or a `.../browse/KEY` URL on the configured host."""
    text = ref.strip()
    if text.startswith(("http://", "https://")):
        url = urlparse(text)
        match = _BROWSE_RE.search(url.path)
        if not match:
            raise InvalidRef("link is not a Jira issue URL")
        if url.hostname != base_host:
            raise HostMismatch(f"link host {url.hostname} does not match {base_host}")
        text = match.group(1)
    key = text.upper()
    if not KEY_RE.match(key):
        raise InvalidRef("expected an issue key like ABC-123 or an issue link")
    return key


def resolve_task(
    ref: str, providers: dict[str, TaskProvider], default_source: str, snapshots: SnapshotRepo
) -> Task:
    """A GitHub link or key goes to GitHub on any instance, the rest to the instance's tracker."""
    key = github_key(ref)
    if key and GITHUB in providers:
        task = providers[GITHUB].resolve(key)
    else:
        provider = providers[default_source]
        task = provider.resolve(parse_ref(ref, provider.base_host))
    snapshots.put_many([task])
    return task


MAX_SEARCH = 100


def search_tasks(
    jql: str, limit: int, provider: TaskProvider, snapshots: SnapshotRepo
) -> tuple[list[Task], int]:
    tasks, total = provider.search(jql.strip(), min(limit, MAX_SEARCH))
    snapshots.put_many(tasks)
    return tasks, total


class NoTokenProvider:
    """Stands in for Jira while the person has no usable token of their own.

    Cards keep their key and say how to connect; nothing is fetched with anyone else's token.
    """

    source_id = "jira"
    source_name = "Jira Data Center"
    source_note = None

    def __init__(self, base_url: str | None, reason: DomainError) -> None:
        self._base_url = base_url or ""
        self._reason = reason

    @property
    def base_host(self) -> str:
        return urlparse(self._base_url).hostname or ""

    def poll(self, keys: list[str]) -> list[Task]:
        url = f"{self._base_url}/browse/" if self._base_url else ""
        return [
            Task(
                source=self.source_id,
                key=key,
                state="no_token",
                url=f"{url}{key}" if url else "",
                fetched_at=now_iso(),
            )
            for key in keys
        ]

    def _refuse(self, *_: object) -> NoReturn:
        raise self._reason

    resolve = check = search = jql_vocabulary = jql_values = _refuse
