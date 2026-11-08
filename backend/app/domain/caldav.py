from dataclasses import dataclass, field
from typing import NoReturn, Protocol
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, Field, SecretStr

from app.domain.errors import ValidationFailed
from app.domain.ports import TaskProvider
from app.domain.tasks import CALDAV, Task, now_iso

# The most tasks one search sends, as many as the card tool adds at once for other trackers.
MAX_LIST_TASKS = 50
# What the card tool shows at once: enough to pick from, short enough to stay one glance.
PICKER_TASKS = 20


def normalize_address(value: str) -> str:
    """A typed domain or address as an https URL; a scheme the person typed is kept."""
    text = value.strip()
    if "://" not in text:
        text = f"https://{text}"
    parts = urlsplit(text)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValidationFailed("address: expected a server address like cloud.example.com")
    if parts.username or parts.password:
        raise ValidationFailed("address: put the user name and password in their own fields")
    return urlunsplit((parts.scheme, parts.netloc, parts.path or "/", parts.query, ""))


@dataclass(frozen=True)
class CalDavAccount:
    """A person's own CalDAV account; `hidden` are the ids of lists they switched off."""

    address: str
    username: str
    password: SecretStr
    hidden: frozenset[str] = field(default_factory=frozenset)


class TaskList(BaseModel):
    # The list's address on the server: the same list keeps it.
    id: str
    name: str
    # Six hex digits without "#", or empty when the server gives none.
    color: str = ""
    shown: bool = True


class CalDavIn(BaseModel):
    address: str = Field(min_length=1, max_length=500)
    username: str = Field(min_length=1, max_length=320)
    # Blank keeps the stored password for the same address and user name; a new one never
    # gets a password that was typed for another server.
    password: SecretStr | None = None


class FindTasksIn(BaseModel):
    # Words of the title; empty: every task, the soonest due first.
    query: str = Field(default="", max_length=200)
    # One list, or every list the person shows.
    list_id: str | None = Field(default=None, min_length=1, max_length=2000)
    done: bool = False
    limit: int = Field(default=PICKER_TASKS, ge=1, le=MAX_LIST_TASKS)


class ListTasks(BaseModel):
    tasks: list[Task]
    # Matches past `limit` are counted, not sent.
    total: int


class CalDavSource(TaskProvider, Protocol):
    """A person's CalDAV reader: a task provider that also lists its task lists."""

    def lists(self) -> list[TaskList]:
        """The account's task lists, without event-only calendars."""
        ...

    def find_tasks(self, query: str, list_id: str | None, done: bool, limit: int) -> ListTasks: ...


def no_account(key: str) -> Task:
    return Task(source=CALDAV, key=key, state="no_token", url="", fetched_at=now_iso())


class NoCalDav:
    """Stands in for CalDAV while the person has no account: cards say how to connect."""

    source_id = CALDAV
    source_name = "CalDAV"
    source_note = None
    base_host = ""

    def poll(self, keys: list[str]) -> list[Task]:
        return [no_account(key) for key in keys]

    def lists(self) -> list[TaskList]:
        return []

    def _refuse(self, *_: object) -> NoReturn:
        raise ValidationFailed("Connect your CalDAV account in Settings → My tracker.")

    resolve = check = search = jql_vocabulary = jql_values = find_tasks = _refuse
