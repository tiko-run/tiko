import hashlib
import html
import re
import time
from collections.abc import Callable
from typing import NamedTuple
from urllib.parse import quote, urlparse

import httpx

from app.domain.errors import (
    InvalidJql,
    JiraRateLimited,
    JiraUnauthorized,
    JiraUnavailable,
    JiraUnreachable,
    TaskNotFound,
)
from app.domain.jql import JqlField, JqlValue, JqlVocabulary
from app.domain.settings import JiraCredentials
from app.domain.tasks import SearchResult, StatusCategory, Task, now_iso, tracker_day

DUE_FIELD = "duedate"
FIELDS = ["summary", "status", "issuetype", "assignee", "priority", "updated", DUE_FIELD]
# Jira has no start field of its own; these are the names Jira Software and Plans give it,
# in the order they are tried.
START_NAMES = ("start date", "target start")
DATE_TYPES = ("date", "datetime")
# A site's fields change only when an admin adds one.
DATE_FIELDS_TTL_S = 600
SEARCH_CHUNK = 500
SOURCE_ID = "jira"
_KEY_IN_ERROR = re.compile(r"'([A-Z][A-Z0-9_]+-\d+)'")
DEFAULT_RETRY_AFTER_S = 60
# The vocabulary is a few hundred KB and changes only when an admin adds a field.
VOCABULARY_TTL_S = 600
_TAGS = re.compile(r"<[^>]+>")

_CATEGORIES: dict[str, StatusCategory] = {
    "new": "new",
    "indeterminate": "indeterminate",
    "done": "done",
}


def _name(value: dict | None, field: str = "name") -> str | None:
    return value.get(field) if value else None


class DateField(NamedTuple):
    id: str
    name: str


class JiraDateFields:
    """The date fields each token sees on its Jira site, kept across the providers built per
    request: Jira lists only the fields the account may view."""

    def __init__(self) -> None:
        self._sites: dict[str, tuple[float, list[DateField]]] = {}

    def get(self, base_url: str) -> list[DateField] | None:
        cached = self._sites.get(base_url)
        return cached[1] if cached and cached[0] > time.monotonic() else None

    def put(self, base_url: str, fields: list[DateField]) -> None:
        self._sites[base_url] = (time.monotonic() + DATE_FIELDS_TTL_S, fields)


def start_fields(fields: list[DateField], chosen: str | None) -> list[str]:
    """The fields a task's start is read from, first filled wins: the admin's choice while the
    site has it, else every field named as in START_NAMES, so projects that fill different
    ones all work."""
    if chosen and any(f.id == chosen for f in fields):
        return [chosen]
    named = [f for f in fields if f.name.strip().lower() in START_NAMES]
    return [f.id for f in sorted(named, key=lambda f: START_NAMES.index(f.name.strip().lower()))]


def to_task(base_url: str, issue: dict, starts: list[str] | tuple[str, ...] = ()) -> Task:
    fields = issue["fields"]
    status = fields.get("status") or {}
    category = (status.get("statusCategory") or {}).get("key", "new")
    start_field = next((f for f in starts if tracker_day(fields.get(f))), None)
    due = tracker_day(fields.get(DUE_FIELD))
    return Task(
        source=SOURCE_ID,
        key=issue["key"],
        summary=fields.get("summary") or "",
        status_name=status.get("name") or "",
        status_category=_CATEGORIES.get(category, "new"),
        type_name=_name(fields.get("issuetype")) or "",
        assignee_name=_name(fields.get("assignee"), "displayName"),
        priority_name=_name(fields.get("priority")),
        updated=fields.get("updated"),
        url=f"{base_url}/browse/{issue['key']}",
        fetched_at=now_iso(),
        start=tracker_day(fields.get(start_field)) if start_field else None,
        start_field=start_field,
        due=due,
        due_field=DUE_FIELD if due else None,
    )


def _plain(text: str) -> str:
    """Suggestion labels come with <b> highlights; the UI shows plain text only."""
    return html.unescape(_TAGS.sub("", text)).strip()


def _json(response: httpx.Response) -> dict:
    # An SSO login page or a wrong base path answers 200 with HTML.
    try:
        body = response.json()
    except ValueError as exc:
        raise JiraUnavailable("Jira returned an unexpected response. Check the URL.") from exc
    if not isinstance(body, dict):
        raise JiraUnavailable("Jira returned an unexpected response. Check the URL.")
    return body


def query_answer(response: httpx.Response) -> dict:
    """The body of an answer to a query; Jira's own message when it rejects the query."""
    if response.status_code == 400:
        messages = _json(response).get("errorMessages") or ["Jira rejected the query."]
        raise InvalidJql(" ".join(messages))
    if response.status_code != 200:
        raise JiraUnavailable(f"Jira returned {response.status_code}")
    return _json(response)


def _task(base_url: str, issue: dict, starts: list[str] | tuple[str, ...] = ()) -> Task:
    try:
        return to_task(base_url, issue, starts)
    except (KeyError, TypeError, AttributeError) as exc:
        raise JiraUnavailable("Jira returned an issue in an unexpected format.") from exc


class JiraDcProvider:
    """Jira Data Center REST v2 with a personal access token (Bearer)."""

    source_id = SOURCE_ID
    source_name = "Jira Data Center"
    source_note = None
    # Keys read in one request of a poll.
    poll_chunk = SEARCH_CHUNK

    def __init__(
        self,
        credentials: Callable[[], JiraCredentials],
        client: httpx.Client,
        date_fields: JiraDateFields | None = None,
    ) -> None:
        self._credentials = credentials
        self._client = client
        self._vocabulary: tuple[str, float, JqlVocabulary] | None = None
        self._date_fields = date_fields or JiraDateFields()

    def date_fields(self) -> list[DateField]:
        """The site's date fields this token sees; none when Jira does not list them, so tasks
        still load."""
        creds = self._credentials()
        # The token's hash, never the token, keys the cache: one person's fields stay theirs.
        token = hashlib.sha256(creds.token.get_secret_value().encode()).hexdigest()[:16]
        site = f"{creds.base_url} {token}"
        cached = self._date_fields.get(site)
        if cached is not None:
            return cached
        try:
            _, response = self._request("GET", "/rest/api/2/field")
        except (JiraUnavailable, JiraUnreachable):
            # Asked again next time: a site that is down now may list them in a minute.
            return []
        try:
            body = response.json() if response.status_code == 200 else None
        except ValueError:
            body = None
        fields = (
            [
                DateField(item["id"], item["name"])
                for item in body
                if isinstance(item, dict)
                and isinstance(item.get("id"), str)
                and isinstance(item.get("name"), str)
                # Jira's own date fields (created, due date, resolved) never hold a start.
                and item.get("custom") is True
                and (item.get("schema") or {}).get("type") in DATE_TYPES
            ]
            if isinstance(body, list)
            else []
        )
        self._date_fields.put(site, fields)
        return fields

    def _starts(self) -> list[str]:
        return start_fields(self.date_fields(), self._credentials().start_field)

    @property
    def base_host(self) -> str:
        return urlparse(self._credentials().base_url).hostname or ""

    def _authorization(self, creds: JiraCredentials) -> str:
        return f"Bearer {creds.token.get_secret_value()}"

    def _request(self, method: str, path: str, **kwargs) -> tuple[str, httpx.Response]:
        creds = self._credentials()
        headers = {"Authorization": self._authorization(creds), "Accept": "application/json"}
        try:
            response = self._client.request(
                method, f"{creds.base_url}{path}", headers=headers, **kwargs
            )
        except httpx.TimeoutException as exc:
            raise JiraUnreachable("Jira did not answer in time.") from exc
        except httpx.TransportError as exc:
            raise JiraUnreachable("Jira is unreachable. Check the URL and your network.") from exc
        if response.status_code in (401, 403):
            raise JiraUnauthorized(
                f"Jira returned {response.status_code}. Check your token in Settings."
            )
        if response.status_code == 429:
            # Jira Cloud may send only the beta header while its new limits are rolled out.
            retry_after = response.headers.get("retry-after") or response.headers.get(
                "beta-retry-after", ""
            )
            seconds = int(retry_after) if retry_after.isdigit() else DEFAULT_RETRY_AFTER_S
            raise JiraRateLimited("Jira is rate limiting requests", seconds)
        if response.status_code >= 500:
            raise JiraUnavailable(f"Jira returned {response.status_code}")
        return creds.base_url, response

    def check(self) -> str:
        _, response = self._request("GET", "/rest/api/2/myself")
        if response.status_code != 200:
            raise JiraUnavailable(f"Jira returned {response.status_code}")
        body = _json(response)
        return body.get("displayName") or body.get("name") or "unknown user"

    def resolve(self, key: str) -> Task:
        starts = self._starts()
        base_url, response = self._request(
            "GET", f"/rest/api/2/issue/{quote(key)}", params={"fields": ",".join(FIELDS + starts)}
        )
        # Jira DC answers 404 both for missing issues and for issues the token cannot see.
        if response.status_code == 404:
            raise TaskNotFound(f"{key} not found or you have no access")
        if response.status_code != 200:
            raise JiraUnavailable(f"Jira returned {response.status_code}")
        return _task(base_url, _json(response), starts)

    def _fetch(self, keys: list[str], starts: list[str]) -> tuple[str, list[dict]]:
        base_url, response = self._request(
            "POST",
            "/rest/api/2/search",
            # false skips JQL validation so unknown or hidden keys do not fail the whole search.
            # Jira DC's POST /search takes a boolean here and rejects "warn" with a 400.
            json={
                "jql": f"key in ({','.join(keys)})",
                "fields": FIELDS + starts,
                "maxResults": len(keys),
                "validateQuery": False,
            },
        )
        if response.status_code == 400:
            # In case a Jira version validates anyway: drop the keys named in the error, retry.
            messages = " ".join(_json(response).get("errorMessages", []))
            bad = set(_KEY_IN_ERROR.findall(messages))
            rest = [key for key in keys if key not in bad]
            if bad and rest and len(rest) < len(keys):
                return self._fetch(rest, starts)
            if bad and not rest:
                return base_url, []
        if response.status_code != 200:
            raise JiraUnavailable(f"Jira returned {response.status_code}")
        issues = _json(response).get("issues", [])
        return base_url, issues if isinstance(issues, list) else []

    def search(self, jql: str, limit: int) -> SearchResult:
        starts = self._starts()
        base_url, response = self._request(
            "POST",
            "/rest/api/2/search",
            json={"jql": jql, "fields": FIELDS + starts, "maxResults": limit},
        )
        body = query_answer(response)
        issues = body.get("issues")
        tasks = (
            [_task(base_url, issue, starts) for issue in issues] if isinstance(issues, list) else []
        )
        total = body.get("total")
        return SearchResult(tasks, total if isinstance(total, int) else len(tasks))

    def jql_vocabulary(self) -> JqlVocabulary:
        base_url = self._credentials().base_url
        cached = self._vocabulary
        if cached and cached[0] == base_url and cached[1] > time.monotonic():
            return cached[2]
        _, response = self._request("GET", "/rest/api/2/jql/autocompletedata")
        if response.status_code != 200:
            raise JiraUnavailable(f"Jira returned {response.status_code}")
        body = _json(response)
        fields = [
            JqlField(
                name=item["value"],
                label=_plain(item.get("displayName") or item["value"]),
                operators=item.get("operators") or [],
            )
            for item in body.get("visibleFieldNames") or []
            if isinstance(item, dict) and item.get("value")
        ]
        functions = {
            item["value"]
            for item in body.get("visibleFunctionNames") or []
            if isinstance(item, dict) and item.get("value")
        }
        vocabulary = JqlVocabulary(fields=fields, functions=sorted(functions))
        self._vocabulary = (base_url, time.monotonic() + VOCABULARY_TTL_S, vocabulary)
        return vocabulary

    def jql_values(self, field: str, prefix: str) -> list[JqlValue]:
        _, response = self._request(
            "GET",
            "/rest/api/2/jql/autocompletedata/suggestions",
            params={"fieldName": field.strip('"'), "fieldValue": prefix},
        )
        # Fields without value suggestions (text, dates) answer with an error, not an empty list.
        if response.status_code != 200:
            return []
        return [
            JqlValue(value=item["value"], label=_plain(item.get("displayName") or item["value"]))
            for item in _json(response).get("results") or []
            if isinstance(item, dict) and item.get("value")
        ]

    def poll(self, keys: list[str]) -> list[Task]:
        found: dict[str, Task] = {}
        base_url = self._credentials().base_url
        starts = self._starts()
        for start in range(0, len(keys), self.poll_chunk):
            base_url, issues = self._fetch(keys[start : start + self.poll_chunk], starts)
            for issue in issues:
                task = _task(base_url, issue, starts)
                found[task.key] = task
        return [
            found.get(key)
            or Task(
                source=SOURCE_ID,
                key=key,
                state="not_found",
                url=f"{base_url}/browse/{key}",
                fetched_at=now_iso(),
            )
            for key in keys
        ]
