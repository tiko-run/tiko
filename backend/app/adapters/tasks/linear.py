"""Linear issues read over the Linear GraphQL API with a person's own API key."""

import math
import re
import time
from collections.abc import Callable
from typing import NoReturn

import httpx

from app.adapters.tasks.readers import PersonalReaders
from app.domain.errors import (
    DomainError,
    LinearRejected,
    TaskNotFound,
    TrackerRateLimited,
    TrackerUnavailable,
    TrackerUnreachable,
    ValidationFailed,
)
from app.domain.tasks import (
    LINEAR,
    StatusCategory,
    Task,
    TaskLabel,
    TaskRow,
    linear_url,
    now_iso,
    tracker_day,
)

API_URL = "https://api.linear.app/graphql"
# Linear's own page cap is 250; 100 keeps a page well under its 10,000-point query limit.
PAGE = 100
# A tenth of the person's hourly requests and points stays for their other tools.
KEEP = 0.1
# Cards on several open boards ask for the same issues; one answer serves them for this long.
FRESH_S = 25
# Identifiers the list filter missed are asked one by one, a few each poll.
SINGLES_PER_POLL = 5
# An identifier Linear does not know is not asked again for this long.
MISS_S = 600
# The person's workspace and teams are read again after this long.
VIEWER_S = 3600
DEFAULT_RETRY_AFTER_S = 60
REJECTED = "Linear rejected your key. Enter a new one in Settings → My tracker."

_ISSUE_FIELDS = """
  id identifier title url updatedAt priority priorityLabel dueDate estimate trashed
  state { name type }
  assignee { name }
  project { name }
  cycle { name number }
  parent { identifier title }
  labels(first: 10) { nodes { name color } }
"""
_ISSUES = (
    "query($ids: [ID!], $first: Int) { issues(first: $first, includeArchived: true,"
    " filter: {id: {in: $ids}}) { nodes {" + _ISSUE_FIELDS + "} } }"
)
_ISSUE = "query($id: String!) { issue(id: $id) {" + _ISSUE_FIELDS + "} }"
_VIEWER = "{ viewer { name } organization { name urlKey previousUrlKeys } }"
_TEAMS = (
    "query($after: String) { teams(first: 250, after: $after) {"
    " nodes { key } pageInfo { hasNextPage endCursor } } }"
)
# Pages of teams read at most, so a broken cursor cannot loop.
TEAM_PAGES = 20

_CATEGORY: dict[str, StatusCategory] = {
    "triage": "new",
    "backlog": "new",
    "unstarted": "new",
    "started": "indeterminate",
    "completed": "done",
    "canceled": "done",
    "duplicate": "done",
}
_HEX = re.compile(r"^#?([0-9a-fA-F]{6})$")


def _number(value: object) -> str:
    """An estimate as Linear shows it: 3, not 3.0."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def to_task(key: str, issue: dict) -> Task:
    state = issue.get("state") or {}
    parent = issue.get("parent")
    rows = []
    if project := (issue.get("project") or {}).get("name"):
        rows.append(TaskRow(label="Project", value=project))
    if cycle := issue.get("cycle"):
        rows.append(TaskRow(label="Cycle", value=cycle.get("name") or f"Cycle {cycle['number']}"))
    if issue.get("estimate") is not None:
        rows.append(TaskRow(label="Estimate", value=_number(issue["estimate"])))
    if parent:
        rows.append(TaskRow(label="Parent", value=f"{parent['identifier']} {parent['title']}"))
    labels = []
    for label in (issue.get("labels") or {}).get("nodes") or []:
        name = (label.get("name") or "").strip()
        color = _HEX.match(label.get("color") or "")
        if name:
            labels.append(TaskLabel(name=name, color=color.group(1).lower() if color else ""))
    due = tracker_day(issue.get("dueDate"))
    return Task(
        source=LINEAR,
        key=key,
        summary=issue.get("title") or "",
        status_name=state.get("name") or "",
        status_category=_CATEGORY.get(state.get("type") or "", "new"),
        type_name="Sub-issue" if parent else "Issue",
        assignee_name=(issue.get("assignee") or {}).get("name"),
        priority_name=issue.get("priorityLabel") if issue.get("priority") else None,
        updated=issue.get("updatedAt"),
        url=issue.get("url") or linear_url(key),
        fetched_at=now_iso(),
        labels=labels,
        rows=rows,
        due=due,
        due_field="dueDate" if due else None,
    )


def _task(key: str, issue: dict) -> Task:
    try:
        return to_task(key, issue)
    except (KeyError, TypeError, AttributeError) as exc:
        raise TrackerUnavailable("Linear returned an issue in an unexpected format.") from exc


def _not_found(errors: list) -> bool:
    return bool(errors) and all(
        isinstance(e, dict)
        and (e.get("extensions") or {}).get("code") == "INPUT_ERROR"
        and "not found" in str(e.get("message", "")).lower()
        for e in errors
    )


class LinearApi:
    """GraphQL requests with one API key, kept inside the limits Linear reports."""

    def __init__(
        self, client: httpx.Client, key: str, clock: Callable[[], float] = time.time
    ) -> None:
        self._client = client
        self._key = key
        self._clock = clock
        self._blocked_until = 0.0

    def _limited(self, wait: float) -> NoReturn:
        raise TrackerRateLimited(
            "The request limit of your Linear account is nearly used up.", math.ceil(wait)
        )

    def _keep(self, response: httpx.Response, now: float) -> None:
        """Waits for the reset once a tenth of the requests or the points is left."""
        for kind in ("requests", "complexity"):
            limit = response.headers.get(f"x-ratelimit-{kind}-limit", "")
            left = response.headers.get(f"x-ratelimit-{kind}-remaining", "")
            reset = response.headers.get(f"x-ratelimit-{kind}-reset", "")
            readable = limit.isdigit() and left.isdigit() and reset.isdigit()
            if readable and int(left) <= int(limit) * KEEP:
                self._blocked_until = max(self._blocked_until, int(reset) / 1000)
        if self._blocked_until <= now:
            self._blocked_until = 0.0

    def query(self, text: str, variables: dict | None = None) -> tuple[dict | None, list]:
        """The answer's data and errors; raises on what no caller can use."""
        now = self._clock()
        if now < self._blocked_until:
            self._limited(self._blocked_until - now)
        try:
            response = self._client.post(
                API_URL,
                json={"query": text, "variables": variables or {}},
                headers={"Authorization": self._key, "User-Agent": "tiko"},
            )
        except httpx.TimeoutException as exc:
            raise TrackerUnreachable("Linear did not answer in time.") from exc
        except httpx.TransportError as exc:
            raise TrackerUnreachable("Linear is unreachable. Check your network.") from exc
        try:
            body = response.json()
        except ValueError:
            body = {}
        if not isinstance(body, dict):
            body = {}
        errors = body.get("errors") or []
        codes = {(e.get("extensions") or {}).get("code") for e in errors if isinstance(e, dict)}
        if response.status_code == 401 or "AUTHENTICATION_ERROR" in codes:
            raise LinearRejected(REJECTED)
        if response.status_code == 429 or "RATELIMITED" in codes:
            retry = response.headers.get("retry-after", "")
            resets = [
                int(r) / 1000 - now
                for kind in ("requests", "complexity")
                if (r := response.headers.get(f"x-ratelimit-{kind}-reset", "")).isdigit()
            ]
            if retry.isdigit():
                wait = float(retry)
            elif resets and max(resets) > 0:
                wait = max(resets)
            else:
                wait = DEFAULT_RETRY_AFTER_S
            self._blocked_until = now + wait
            self._limited(wait)
        if response.status_code >= 500:
            raise TrackerUnavailable(f"Linear returned {response.status_code}")
        self._keep(response, now)
        data = body.get("data")
        # Linear may answer part of a query with an error for the rest; a partial issue is not one.
        if (errors and not _not_found(errors)) or (data is None and not errors):
            raise TrackerUnavailable("Linear returned an unexpected response.")
        return data, errors


class LinearProvider:
    """A person's Linear workspace, read with their own API key."""

    source_id = LINEAR
    source_name = "Linear"
    source_note = None
    base_host = "linear.app"

    def __init__(self, api: LinearApi, clock: Callable[[], float] = time.time) -> None:
        self._api = api
        self._clock = clock
        # The workspace's slug and its old ones, with when they were read.
        self._workspaces: tuple[set[str], float] = (set(), 0.0)
        self._slug = ""
        # The person's team keys, with when they were read.
        self._teams: tuple[set[str], float] = (set(), 0.0)
        # By a card's identifier: the last answer, when it was read (ISO) and when (clock).
        self._seen: dict[str, tuple[dict, str, float]] = {}
        # A card's identifier after its issue moved to another team: the issue's new one.
        self._moved: dict[str, str] = {}
        # Identifiers Linear answered "not found" for, and when.
        self._missing: dict[str, float] = {}

    def _viewer(self) -> dict:
        data, _ = self._api.query(_VIEWER)
        try:
            viewer, org = data["viewer"], data["organization"]
            slugs = {org["urlKey"], *(org.get("previousUrlKeys") or [])}
        except (KeyError, TypeError) as exc:
            raise TrackerUnavailable("Linear returned an unexpected response.") from exc
        self._workspaces = ({str(s).lower() for s in slugs}, self._clock())
        self._slug = str(org["urlKey"]).lower()
        return {"viewer": viewer, "organization": org}

    def _mine(self, workspace: str) -> bool:
        slugs, read_at = self._workspaces
        if not slugs or self._clock() - read_at > VIEWER_S:
            self._viewer()
            slugs = self._workspaces[0]
        return workspace in slugs

    def has_prefix(self, prefix: str) -> bool | None:
        """Whether one of the person's teams has this key; None when Linear could not be asked."""
        teams, read_at = self._teams
        if not read_at or self._clock() - read_at > VIEWER_S:
            try:
                teams = self._team_keys()
            except DomainError:
                return None
            self._teams = (teams, self._clock())
        return prefix in teams

    def _team_keys(self) -> set[str]:
        keys: set[str] = set()
        after = None
        for _ in range(TEAM_PAGES):
            data, _ = self._api.query(_TEAMS, {"after": after})
            page = (data or {}).get("teams") or {}
            keys |= {
                t["key"] for t in page.get("nodes") or [] if isinstance(t, dict) and t.get("key")
            }
            info = page.get("pageInfo") or {}
            after = info.get("endCursor")
            if not info.get("hasNextPage") or not after:
                break
        return keys

    def key_for(self, identifier: str) -> str:
        if not self._slug or self._clock() - self._workspaces[1] > VIEWER_S:
            self._viewer()
        return f"{self._slug}/{identifier}"

    def check(self) -> str:
        data = self._viewer()
        return f"{data['viewer']['name']} in {data['organization']['name']}"

    def _keep(self, identifier: str, issue: dict) -> None:
        self._seen[identifier] = (issue, now_iso(), self._clock())
        self._missing.pop(identifier, None)
        current = issue.get("identifier")
        if isinstance(current, str) and current != identifier:
            self._moved[identifier] = current

    def _single(self, identifier: str) -> dict | None:
        data, _ = self._api.query(_ISSUE, {"id": identifier})
        issue = (data or {}).get("issue")
        # A deleted issue waits in Linear's trash, still answered; for a card it is gone.
        return None if not isinstance(issue, dict) or issue.get("trashed") else issue

    def resolve(self, key: str) -> Task:
        workspace, _, identifier = key.partition("/")
        if not self._mine(workspace):
            raise TaskNotFound("This issue is in another Linear workspace.")
        issue = self._single(identifier)
        if issue is None:
            raise TaskNotFound(f"Linear has no issue {identifier} that you can read.")
        self._keep(identifier, issue)
        return _task(key, issue)

    def _fetch(self, identifiers: list[str]) -> None:
        """One request per hundred cards; what the list misses is asked by its card's identifier."""
        current = {i: self._moved.get(i, i) for i in identifiers}
        answered: dict[str, dict] = {}
        wanted = sorted(set(current.values()))
        for start in range(0, len(wanted), PAGE):
            data, _ = self._api.query(_ISSUES, {"ids": wanted[start : start + PAGE], "first": PAGE})
            for issue in ((data or {}).get("issues") or {}).get("nodes") or []:
                if (
                    isinstance(issue, dict)
                    and isinstance(issue.get("identifier"), str)
                    and not issue.get("trashed")
                ):
                    answered[issue["identifier"]] = issue
        unanswered = []
        for identifier in identifiers:
            if issue := answered.get(current[identifier]):
                self._keep(identifier, issue)
            else:
                unanswered.append(identifier)
        # A moved or deleted issue is asked by its card's identifier, the longest-waiting first.
        unanswered.sort(key=lambda i: self._seen.get(i, ({}, "", 0.0))[2])
        for identifier in unanswered[:SINGLES_PER_POLL]:
            if issue := self._single(identifier):
                self._keep(identifier, issue)
            else:
                self._seen.pop(identifier, None)
                self._moved.pop(identifier, None)
                self._missing[identifier] = self._clock()

    def poll(self, keys: list[str]) -> list[Task]:
        now = self._clock()
        mine = {k for k in keys if self._mine(k.partition("/")[0])}
        identifiers = sorted({k.partition("/")[2] for k in mine})
        missing = {i for i in identifiers if now - self._missing.get(i, -MISS_S) < MISS_S}
        stale = [
            i
            for i in identifiers
            if i not in missing and now - self._seen.get(i, ({}, "", -FRESH_S))[2] >= FRESH_S
        ]
        if stale:
            self._fetch(stale)
        found = []
        for key in keys:
            identifier = key.partition("/")[2]
            seen = self._seen.get(identifier) if key in mine else None
            if seen and identifier not in self._missing:
                found.append(_task(key, seen[0]).model_copy(update={"fetched_at": seen[1]}))
            else:
                found.append(
                    Task(
                        source=LINEAR,
                        key=key,
                        state="not_found",
                        url=linear_url(key),
                        fetched_at=now_iso(),
                    )
                )
        return found

    def _no_query(self, *_: object) -> NoReturn:
        raise ValidationFailed("Linear has no query here yet: add a card by its link.")

    search = jql_vocabulary = jql_values = _no_query


class LinearReaders:
    """One provider per person, kept between requests so its answers and pace last."""

    def __init__(self, client: httpx.Client, clock: Callable[[], float] = time.time) -> None:
        self._client = client
        self._clock = clock
        self._own: PersonalReaders[LinearProvider] = PersonalReaders(clock)

    def of(self, user_id: str, key: str) -> LinearProvider:
        return self._own.of(user_id, key, lambda: self._provider(key))

    def _provider(self, key: str) -> LinearProvider:
        return LinearProvider(LinearApi(self._client, key, self._clock), self._clock)

    def login(self, key: str) -> str:
        """Who the key signs in as, asked before it is saved."""
        try:
            return self._provider(key).check()
        except LinearRejected as exc:
            raise ValidationFailed("token: Linear did not accept this key") from exc
