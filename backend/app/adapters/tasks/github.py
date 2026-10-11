import hashlib
import math
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import urlparse

import httpx

from app.domain.errors import (
    TaskNotFound,
    TooManyRepositories,
    TrackerRateLimited,
    TrackerUnavailable,
    TrackerUnreachable,
    ValidationFailed,
)
from app.domain.tasks import GITHUB, StatusCategory, Task, TaskLabel, TaskRow, now_iso

API_URL = "https://api.github.com"
WEB_URL = "https://github.com"
PAGE = 100
LIMIT_WITHOUT_TOKEN = 60
LIMIT_WITH_TOKEN = 5000
# The share of the hourly limit left for adding cards.
RESERVE = 0.2
MIN_POLL_S = 30
# A repository no board asked about for this long is forgotten.
IDLE_S = 3600
MAX_REPOS = 500
# A task the list of its repository does not reach is read again this often: a deleted issue
# changes nothing in that list.
RECHECK_S = 6 * 3600
# A long list of due repositories is spread over several refreshes.
REPOS_PER_POLL = 10
DEFAULT_RETRY_AFTER_S = 60
# The share of a person's hourly limit their own token leaves alone: their other tools spend
# the same limit.
PERSONAL_KEEP = 0.1
# How long a token GitHub rejected is left alone before it is tried again.
REJECTED_RETRY_S = 300

# Labels that projects use as a status, compared without case; the label's name is shown.
_LABEL_STATUS: dict[str, StatusCategory] = {
    "planned": "new",
    "todo": "new",
    "to do": "new",
    "backlog": "new",
    "in progress": "indeterminate",
    "in-progress": "indeterminate",
    "wip": "indeterminate",
    "doing": "indeterminate",
    "in review": "indeterminate",
    "shipped": "done",
    "done": "done",
    "released": "done",
}
_CLOSED_AS = {"not_planned": "Not planned", "duplicate": "Duplicate"}


def _status(issue: dict) -> tuple[str, StatusCategory]:
    pull = issue.get("pull_request")
    closed = issue.get("state") == "closed"
    if pull is not None:
        if pull.get("merged_at"):
            return "Merged", "done"
        if closed:
            return "Closed", "done"
        return ("Draft" if issue.get("draft") else "Open"), "indeterminate"
    if closed:
        return _CLOSED_AS.get(issue.get("state_reason") or "", "Closed"), "done"
    for label in issue.get("labels") or []:
        name = label.get("name") if isinstance(label, dict) else label
        if isinstance(name, str) and (category := _LABEL_STATUS.get(name.strip().lower())):
            return name.strip(), category
    return "Open", "new"


_HEX = re.compile(r"^[0-9a-fA-F]{6}$")


def _labels(issue: dict) -> list[TaskLabel]:
    labels = []
    for label in issue.get("labels") or []:
        name = label.get("name") if isinstance(label, dict) else label
        color = label.get("color") if isinstance(label, dict) else None
        if isinstance(name, str) and name.strip():
            hexed = color if isinstance(color, str) and _HEX.match(color) else ""
            labels.append(TaskLabel(name=name.strip(), color=hexed.lower()))
    return labels


def to_task(key: str, issue: dict) -> Task:
    status_name, category = _status(issue)
    author = (issue.get("user") or {}).get("login")
    return Task(
        source=GITHUB,
        key=key,
        summary=issue.get("title") or "",
        status_name=status_name,
        status_category=category,
        type_name="Pull request" if issue.get("pull_request") is not None else "Issue",
        assignee_name=(issue.get("assignee") or {}).get("login"),
        updated=issue.get("updated_at"),
        url=issue["html_url"],
        fetched_at=now_iso(),
        labels=_labels(issue),
        rows=[TaskRow(label="Author", value=author)] if author else [],
    )


def _split(key: str) -> tuple[str, int]:
    repo, _, number = key.rpartition("#")
    return repo, int(number)


class TokenRejected(TrackerUnavailable):
    pass


class GitHubApi:
    """GET requests to the GitHub REST API, with the limit GitHub reports for them."""

    def __init__(
        self,
        client: httpx.Client,
        token: str | None = None,
        clock: Callable[[], float] = time.time,
        personal: bool = False,
    ) -> None:
        self._client = client
        self._token = token
        self._clock = clock
        # Whether the token is a person's own and not the server's.
        self._personal = personal
        self.limit = LIMIT_WITH_TOKEN if token else LIMIT_WITHOUT_TOKEN
        # Requests that counted against the limit.
        self.spent = 0
        self._blocked_until = 0.0

    @property
    def has_token(self) -> bool:
        return self._token is not None

    def _limited(self, wait: float) -> TrackerRateLimited:
        if self._personal:
            return TrackerRateLimited(
                "The request limit of your GitHub account is nearly used up.", math.ceil(wait)
            )
        hint = "" if self._token else " Set GITHUB_TOKEN on the server to raise it."
        return TrackerRateLimited(f"GitHub's request limit is used up.{hint}", math.ceil(wait))

    def get(self, path: str, params: dict | None = None, etag: str | None = None) -> httpx.Response:
        now = self._clock()
        if now < self._blocked_until:
            raise self._limited(self._blocked_until - now)
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "tiko"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        if etag:
            headers["If-None-Match"] = etag
        try:
            response = self._client.get(f"{API_URL}{path}", params=params, headers=headers)
        except httpx.TimeoutException as exc:
            raise TrackerUnreachable("GitHub did not answer in time.") from exc
        except httpx.TransportError as exc:
            raise TrackerUnreachable("GitHub is unreachable. Check your network.") from exc
        reported = response.headers.get("x-ratelimit-limit", "")
        if reported.isdigit() and int(reported) > 0:
            self.limit = int(reported)
        status = response.status_code
        # GitHub does not count an unchanged answer to a request that carries a token.
        if not (status == 304 and self._token):
            self.spent += 1
        remaining = response.headers.get("x-ratelimit-remaining", "")
        used_up = remaining == "0"
        retry_after = response.headers.get("retry-after", "")
        reset = response.headers.get("x-ratelimit-reset", "")
        if status == 429 or (status == 403 and (used_up or retry_after)):
            if retry_after.isdigit():
                wait = float(retry_after)
            elif used_up and reset.isdigit():
                wait = max(1.0, int(reset) - now)
            else:
                wait = DEFAULT_RETRY_AFTER_S
            self._blocked_until = now + wait
            raise self._limited(wait)
        if status == 401:
            if self._personal:
                raise TokenRejected("GitHub rejected your token.")
            raise TrackerUnavailable("GitHub rejected the token in GITHUB_TOKEN.")
        nearly_out = remaining.isdigit() and int(remaining) <= self.limit * PERSONAL_KEEP
        if self._personal and nearly_out and reset.isdigit():
            # This answer is still served; the next request waits for the reset.
            self._blocked_until = max(self._blocked_until, float(reset))
        if status >= 500:
            raise TrackerUnavailable(f"GitHub returned {status}")
        return response


def _json(response: httpx.Response, kind: type) -> dict | list:
    try:
        body = response.json()
    except ValueError as exc:
        raise TrackerUnavailable("GitHub returned an unexpected response.") from exc
    if not isinstance(body, kind):
        raise TrackerUnavailable("GitHub returned an unexpected response.")
    return body


def _task(key: str, issue: dict) -> Task:
    try:
        return to_task(key, issue)
    except (KeyError, TypeError, AttributeError) as exc:
        raise TrackerUnavailable("GitHub returned an issue in an unexpected format.") from exc


@dataclass
class _Repo:
    name: str
    asked_at: float
    # Whether the reader was refused the repository itself, not one number in it.
    unreadable: bool = False
    polled_at: float | None = None
    etag: str | None = None
    # The newest change seen; a later page that reaches back to it has missed nothing.
    since: str = ""
    # None until known. A private repository is never served: its reader is shared by everyone.
    hidden: bool | None = None
    visibility_etag: str | None = None
    # Whether the last list held the whole repository.
    covered: bool = False
    read_at: dict[int, float] = field(default_factory=dict)
    wanted: set[int] = field(default_factory=set)
    # None for a number GitHub does not have.
    tasks: dict[int, Task | None] = field(default_factory=dict)
    # Wanted numbers the list did not cover, read one by one.
    stale: set[int] = field(default_factory=set)


def _no_query(*_: object):
    raise ValidationFailed("GitHub tasks are added by their link or by owner/repo#number.")


class GitHubReader:
    """Issues and pull requests read with one token and kept in memory: a person's own reader."""

    # A board asks on every refresh and is answered from memory; GitHub is asked only for a
    # repository whose turn has come. The hourly limit is spread over the tracked repositories,
    # the longest-waiting first, so more repositories mean older data and never a burst.

    source_id = GITHUB
    source_name = "GitHub"
    base_host = "github.com"
    source_note: str | None = None
    # What a task of a repository the reader was refused comes back as.
    _refused_state: Literal["not_found", "no_token"] = "not_found"
    _refused = "or your token cannot read its repository"

    def __init__(self, api: GitHubApi, clock: Callable[[], float] = time.time) -> None:
        self._api = api
        self._clock = clock
        self._repos: dict[str, _Repo] = {}
        # Requests run under the lock: two boards must not ask about one repository twice.
        self._lock = threading.Lock()
        self._singles_per_turn = 30 if api.has_token else 3

    def _slot(self) -> float:
        """Seconds one request takes out of the hourly limit, less the reserve."""
        return 3600 / (self._api.limit * (1 - RESERVE))

    def _turn_cost(self) -> int:
        return 1

    def _interval(self) -> float:
        return max(MIN_POLL_S, len(self._repos) * self._turn_cost() * self._slot())

    def _forget(self, now: float) -> None:
        # Repositories of closed or deleted boards must not slow the ones still watched.
        for key in [k for k, r in self._repos.items() if now - r.asked_at > IDLE_S]:
            del self._repos[key]

    def _track(self, name: str, now: float) -> _Repo | None:
        repo = self._repos.get(name.lower())
        if repo is None:
            if len(self._repos) >= MAX_REPOS:
                return None
            repo = self._repos[name.lower()] = _Repo(name=name, asked_at=now)
        repo.asked_at = now
        return repo

    def _visible(self, repo: _Repo) -> bool:
        """Whether the repository may be served; a person's token decides that by itself."""
        return True

    def _single(self, repo: _Repo, number: int) -> Task | None:
        response = self._api.get(f"/repos/{repo.name}/issues/{number}")
        repo.stale.discard(number)
        if response.status_code in (404, 410):
            repo.tasks[number] = None
            return None
        if response.status_code != 200:
            raise TrackerUnavailable(f"GitHub returned {response.status_code}")
        task = repo.tasks[number] = _task(f"{repo.name}#{number}", _json(response, dict))
        repo.read_at[number] = self._clock()
        return task

    def _refresh(self, repo: _Repo, now: float) -> None:
        spent = self._api.spent
        if not self._visible(repo):
            repo.unreadable = True
            repo.polled_at = now
            return
        response = self._api.get(
            f"/repos/{repo.name}/issues",
            params={"state": "all", "sort": "updated", "direction": "desc", "per_page": PAGE},
            etag=repo.etag,
        )
        if response.status_code == 404:
            repo.unreadable = True
            repo.tasks = dict.fromkeys(repo.wanted)
            repo.stale.clear()
        elif response.status_code == 200:
            repo.unreadable = False
            page = [issue for issue in _json(response, list) if isinstance(issue, dict)]
            listed: set[int] = set()
            for issue in page:
                number = issue.get("number")
                if number in repo.wanted:
                    repo.tasks[number] = _task(f"{repo.name}#{number}", issue)
                    repo.read_at[number] = now
                    listed.add(number)
            repo.stale -= listed
            rest = repo.wanted - listed
            repo.covered = len(page) < PAGE
            if repo.covered:
                # The whole repository fits the page: what is not on it does not exist.
                for number in rest:
                    repo.tasks[number] = None
                repo.stale.clear()
            elif not repo.since or min(i.get("updated_at") or "" for i in page) > repo.since:
                repo.stale |= rest
            if page:
                repo.since = page[0].get("updated_at") or repo.since
            repo.etag = response.headers.get("etag")
        elif response.status_code != 304:
            raise TrackerUnavailable(f"GitHub returned {response.status_code}")
        if not repo.covered:
            repo.stale |= {
                number
                for number, read_at in repo.read_at.items()
                if number in repo.wanted and now - read_at > RECHECK_S
            }
        for number in sorted(repo.stale)[: self._singles_per_turn]:
            self._single(repo, number)
        # Reads beyond the turn's share push the next turn back, so the hour stays in budget.
        extra = max(0, self._api.spent - spent - self._turn_cost())
        repo.polled_at = now + extra * self._slot()

    def _answer(self, key: str) -> Task | None:
        name, number = _split(key)
        repo = self._repos.get(name.lower())
        if repo is None or number not in repo.tasks:
            return None
        task = repo.tasks[number]
        if task is None:
            return Task(
                source=GITHUB,
                key=key,
                state=self._refused_state if repo.unreadable else "not_found",
                url=f"{WEB_URL}/{name}/issues/{number}",
                fetched_at=now_iso(),
            )
        # A card keeps the key it was added with, whatever case or name GitHub answers with.
        return task.model_copy(update={"key": key})

    def poll(self, keys: list[str]) -> list[Task]:
        """Tasks from memory; one not read yet is left out and comes with a later poll."""
        with self._lock:
            now = self._clock()
            self._forget(now)
            asked: dict[str, _Repo] = {}
            for key in keys:
                name, number = _split(key)
                repo = self._track(name, now)
                if repo is None:
                    continue
                asked[name.lower()] = repo
                if number not in repo.wanted:
                    repo.wanted.add(number)
                    repo.stale.add(number)
            interval = self._interval()
            due = [
                r for r in asked.values() if r.polled_at is None or now - r.polled_at >= interval
            ]
            due.sort(key=lambda r: r.polled_at or 0.0)
            for repo in due[:REPOS_PER_POLL]:
                self._refresh(repo, now)
            return [task for key in keys if (task := self._answer(key))]

    def resolve(self, key: str) -> Task:
        with self._lock:
            name, number = _split(key)
            now = self._clock()
            self._forget(now)
            repo = self._track(name, now)
            if repo is None:
                raise TooManyRepositories(
                    "This tiko already follows as many GitHub repositories as it can."
                )
            task = self._single(repo, number) if self._visible(repo) else None
            if task is None:
                raise TaskNotFound(f"{key} was not found on GitHub, {self._refused}")
            repo.wanted.add(number)
            # A new card takes the name GitHub uses for the repository, read from the link.
            canonical = "/".join(urlparse(task.url).path.split("/")[1:3]) or name
            return task.model_copy(update={"key": f"{canonical}#{number}"})

    def check(self) -> str:
        if not self._api.has_token:
            return "public access"
        response = self._api.get("/user")
        if response.status_code != 200:
            raise TrackerUnavailable(f"GitHub returned {response.status_code}")
        return str(_json(response, dict).get("login") or "unknown user")

    search = jql_vocabulary = jql_values = _no_query


class SharedGitHub(GitHubReader):
    """Public issues and pull requests, read once for everyone without a token of their own."""

    _refused_state = "no_token"
    _refused = "or its repository is private"

    @property
    def source_note(self) -> str | None:
        return None if self._api.has_token else "Updates every few minutes without a token"

    def _turn_cost(self) -> int:
        # With a token every turn also asks whether the repository is still public.
        return 2 if self._api.has_token else 1

    def _visible(self, repo: _Repo) -> bool:
        was_hidden = repo.hidden
        if not self._api.has_token:
            # Without a token GitHub itself answers 404 for a private repository.
            repo.hidden = False
        else:
            # Asked before every read: a repository made private must stop being served at
            # once, and the token may still open it.
            response = self._api.get(f"/repos/{repo.name}", etag=repo.visibility_etag)
            if response.status_code != 304:
                public = response.status_code == 200 and not _json(response, dict).get(
                    "private", True
                )
                repo.hidden = not public
                repo.visibility_etag = response.headers.get("etag") if public else None
        if repo.hidden:
            repo.tasks = dict.fromkeys(repo.wanted)
            repo.stale.clear()
            repo.etag = None
            repo.since = ""
        elif was_hidden:
            repo.tasks.clear()
            repo.stale = set(repo.wanted)
        return not repo.hidden


class PersonalGitHub:
    """A person's own reader. While GitHub rejects their token, public tasks come from the
    shared reader, so a revoked token does not empty the board."""

    source_id = GITHUB
    source_name = "GitHub"
    base_host = "github.com"

    def __init__(
        self, own: GitHubReader, shared: SharedGitHub, clock: Callable[[], float] = time.time
    ) -> None:
        self._own = own
        self._shared = shared
        self._clock = clock
        self._rejected_until = 0.0

    @property
    def source_note(self) -> str | None:
        if self._clock() < self._rejected_until:
            return "GitHub rejected your token. Enter a new one in Settings → My tracker"
        return self._own.source_note

    def _reader(self) -> GitHubReader:
        return self._shared if self._clock() < self._rejected_until else self._own

    def poll(self, keys: list[str]) -> list[Task]:
        try:
            return self._reader().poll(keys)
        except TokenRejected:
            self._rejected_until = self._clock() + REJECTED_RETRY_S
            return self._shared.poll(keys)

    def resolve(self, key: str) -> Task:
        try:
            return self._reader().resolve(key)
        except TokenRejected:
            self._rejected_until = self._clock() + REJECTED_RETRY_S
            return self._shared.resolve(key)

    def check(self) -> str:
        return self._own.check()

    search = jql_vocabulary = jql_values = _no_query


class GitHubReaders:
    """The shared reader and one reader for each person with a token of their own."""

    def __init__(
        self,
        client: httpx.Client,
        server_token: str | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._client = client
        self._clock = clock
        self.shared = SharedGitHub(GitHubApi(client, server_token, clock), clock)
        # By person: the digest of the token the reader was made for, the reader, its last use.
        self._own: dict[str, tuple[bytes, PersonalGitHub, float]] = {}
        self._lock = threading.Lock()

    def _api(self, token: str) -> GitHubApi:
        return GitHubApi(self._client, token, self._clock, personal=True)

    def of(self, user_id: str, token: str) -> PersonalGitHub:
        """The person's reader, kept between requests so its pace and memory last."""
        digest = hashlib.sha256(token.encode()).digest()
        now = self._clock()
        with self._lock:
            for idle in [u for u, (_, _, used) in self._own.items() if now - used > IDLE_S]:
                del self._own[idle]
            kept = self._own.get(user_id)
            if kept is None or kept[0] != digest:
                own = GitHubReader(self._api(token), self._clock)
                kept = (digest, PersonalGitHub(own, self.shared, self._clock), now)
            self._own[user_id] = (kept[0], kept[1], now)
            return kept[1]

    def login(self, token: str) -> str:
        """Whose token this is, asked before it is saved."""
        try:
            return GitHubReader(self._api(token), self._clock).check()
        except TokenRejected as exc:
            raise ValidationFailed("token: GitHub did not accept this token") from exc
