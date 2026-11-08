"""Tasks (VTODO) of a CalDAV server, read with a person's own account. Read-only: only
PROPFIND, REPORT and GET are ever sent."""

import base64
import hashlib
import ipaddress
import re
import socket
import threading
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import NoReturn
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit

import httpx
from icalendar import Calendar

from app.domain.caldav import CALDAV, CalDavAccount, ListTasks, TaskList, no_account
from app.domain.errors import (
    CalDavAddressRefused,
    CalDavRejected,
    TaskNotFound,
    TrackerRateLimited,
    TrackerUnavailable,
    TrackerUnreachable,
    ValidationFailed,
)
from app.domain.tasks import StatusCategory, Task, TaskLabel, TaskRow, now_iso, valid_uid

DAV = "DAV:"
CAL = "urn:ietf:params:xml:ns:caldav"
CS = "http://calendarserver.org/ns/"
APPLE = "http://apple.com/ns/ical/"
_NS = f'xmlns:d="{DAV}" xmlns:c="{CAL}" xmlns:cs="{CS}" xmlns:a="{APPLE}"'

MAX_REDIRECTS = 5
# A server answer bigger than this is refused rather than read into memory.
MAX_BODY = 20 * 1024 * 1024
# A list is asked whether it changed at most this often, however many boards show it.
MIN_POLL_S = 30
# A person's reader no board asked for this long is dropped.
IDLE_S = 3600
DEFAULT_RETRY_AFTER_S = 60
# A task found in none of the lists is looked for again this often.
RECHECK_S = 600

_STATUS: dict[str, tuple[str, StatusCategory]] = {
    "NEEDS-ACTION": ("To do", "new"),
    "IN-PROCESS": ("In progress", "indeterminate"),
    "COMPLETED": ("Done", "done"),
    "CANCELLED": ("Cancelled", "done"),
}
_HEX = re.compile(r"^#?([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$")


Resolver = Callable[[str, int], list[str]]


def resolve_host(host: str, port: int) -> list[str]:
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


class CalDavHttp:
    """Requests to a person's server. The host is resolved and checked first, and the request
    goes to the checked address, so a name cannot turn into another address in between."""

    def __init__(
        self,
        client: httpx.Client,
        allow_private: bool,
        resolver: Resolver = resolve_host,
    ) -> None:
        self._client = client
        self._allow_private = allow_private
        self._resolver = resolver

    def _pinned(self, url: str) -> tuple[str, str, str]:
        """The URL with its host replaced by a checked address, the Host header and the name
        TLS must verify."""
        parts = urlsplit(url)
        host = parts.hostname or ""
        if parts.scheme not in ("http", "https") or not host:
            raise CalDavAddressRefused("address: only http and https addresses work")
        port = parts.port or (443 if parts.scheme == "https" else 80)
        try:
            found = [ipaddress.ip_address(a.split("%")[0]) for a in self._resolver(host, port)]
        except (OSError, ValueError) as exc:
            raise TrackerUnreachable(f"The CalDAV server {host} was not found.") from exc
        if not found:
            raise TrackerUnreachable(f"The CalDAV server {host} was not found.")
        private = any(not ip.is_global for ip in found)
        if private and not self._allow_private:
            raise CalDavAddressRefused(
                f"address: {host} is on a private network, which this tiko does not connect to"
            )
        if not private and parts.scheme != "https":
            # Every request carries the password; on a public network only TLS keeps it.
            raise CalDavAddressRefused("address: a server on the internet needs https://")
        ip = found[0]
        literal = f"[{ip}]" if ip.version == 6 else str(ip)
        netloc = f"{literal}:{parts.port}" if parts.port else literal
        target = urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, ""))
        return target, parts.netloc, host

    def request(
        self,
        method: str,
        url: str,
        auth: tuple[str, str],
        body: str | None = None,
        depth: str | None = None,
    ) -> tuple[httpx.Response, str]:
        """The answer and the URL that gave it, after redirects."""
        for _ in range(MAX_REDIRECTS + 1):
            target, host_header, sni = self._pinned(url)
            headers = {"Host": host_header}
            if depth is not None:
                headers["Depth"] = depth
            if body is not None:
                headers["Content-Type"] = "application/xml; charset=utf-8"
            request = self._client.build_request(
                method,
                target,
                headers=headers,
                content=body.encode() if body is not None else None,
                extensions={"sni_hostname": sni},
            )
            token = base64.b64encode(f"{auth[0]}:{auth[1]}".encode()).decode()
            request.headers["Authorization"] = f"Basic {token}"
            try:
                response = self._client.send(request, stream=True)
            except httpx.TimeoutException as exc:
                raise TrackerUnreachable(
                    f"The CalDAV server {sni} did not answer in time."
                ) from exc
            except httpx.TransportError as exc:
                raise TrackerUnreachable(f"The CalDAV server {sni} could not be reached.") from exc
            try:
                if response.is_redirect and (location := response.headers.get("location")):
                    url = urljoin(url, location)
                    continue
                size = 0
                chunks = []
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_BODY:
                        raise TrackerUnavailable("The CalDAV server sent too much at once.")
                    chunks.append(chunk)
                response._content = b"".join(chunks)
            except httpx.TransportError as exc:
                raise TrackerUnreachable(f"The CalDAV server {sni} could not be reached.") from exc
            finally:
                response.close()
            _raise_for(response)
            return response, url
        raise TrackerUnavailable("The CalDAV server redirected too many times.")


def _raise_for(response: httpx.Response) -> None:
    status = response.status_code
    if status in (401, 403):
        raise CalDavRejected("The CalDAV server did not accept the user name or the password.")
    if status == 429:
        retry = response.headers.get("retry-after", "")
        raise TrackerRateLimited(
            "The CalDAV server asks to slow down.",
            int(retry) if retry.isdigit() else DEFAULT_RETRY_AFTER_S,
        )
    if status >= 500:
        raise TrackerUnavailable(f"The CalDAV server returned {status}.")


@dataclass
class _Resource:
    href: str
    status: int
    props: dict[str, ET.Element]


def _multistatus(response: httpx.Response, base: str) -> list[_Resource]:
    if response.status_code != 207:
        return []
    try:
        root = ET.fromstring(response.content)
    except ET.ParseError as exc:
        raise TrackerUnavailable("The CalDAV server sent an answer tiko cannot read.") from exc
    found = []
    for item in root.iter(f"{{{DAV}}}response"):
        href = (item.findtext(f"{{{DAV}}}href") or "").strip()
        if not href:
            continue
        props: dict[str, ET.Element] = {}
        status = 200
        for propstat in item.iter(f"{{{DAV}}}propstat"):
            if not _ok(propstat.findtext(f"{{{DAV}}}status")):
                continue
            for prop in propstat.iter(f"{{{DAV}}}prop"):
                for child in prop:
                    props[child.tag] = child
        if not item.findall(f"{{{DAV}}}propstat"):
            status = 200 if _ok(item.findtext(f"{{{DAV}}}status")) else 404
        found.append(_Resource(href=urljoin(base, href), status=status, props=props))
    return found


def _ok(status_line: str | None) -> bool:
    return bool(status_line) and " 200 " in f"{status_line} "


def _href_of(props: dict[str, ET.Element], tag: str, base: str) -> str | None:
    element = props.get(tag)
    href = element.findtext(f"{{{DAV}}}href") if element is not None else None
    return urljoin(base, href.strip()) if href and href.strip() else None


_PRINCIPAL = f"""<?xml version="1.0" encoding="utf-8"?>
<d:propfind {_NS}><d:prop><d:current-user-principal/></d:prop></d:propfind>"""

_HOME = f"""<?xml version="1.0" encoding="utf-8"?>
<d:propfind {_NS}><d:prop><c:calendar-home-set/><d:displayname/></d:prop></d:propfind>"""

_LISTS = f"""<?xml version="1.0" encoding="utf-8"?>
<d:propfind {_NS}><d:prop>
<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><cs:getctag/>
<d:sync-token/><a:calendar-color/>
</d:prop></d:propfind>"""

_CTAG = f"""<?xml version="1.0" encoding="utf-8"?>
<d:propfind {_NS}><d:prop><cs:getctag/><d:sync-token/></d:prop></d:propfind>"""


def _query(filters: str) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query {_NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>
<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO">{filters}</c:comp-filter>
</c:comp-filter></c:filter></c:calendar-query>"""


def _multiget(hrefs: list[str]) -> str:
    items = "".join(f"<d:href>{_xml_text(urlsplit(h).path)}</d:href>" for h in hrefs)
    return f"""<?xml version="1.0" encoding="utf-8"?>
<c:calendar-multiget {_NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>{items}
</c:calendar-multiget>"""


def _xml_text(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


_OPEN = '<c:prop-filter name="COMPLETED"><c:is-not-defined/></c:prop-filter>'


def _by_uid(uid: str) -> str:
    return (
        '<c:prop-filter name="UID"><c:text-match collation="i;octet">'
        f"{_xml_text(uid)}</c:text-match></c:prop-filter>"
    )


@dataclass
class _List:
    info: TaskList
    tag: str | None = None
    checked_at: float | None = None
    # The change tag of the last listing: what a read of the list's tasks is at least as new as.
    listed_tag: str | None = None
    # Wanted tasks by UID: the resource they were found at, the task read from it.
    hrefs: dict[str, str] = field(default_factory=dict)
    tasks: dict[str, Task] = field(default_factory=dict)
    # Titles of the list's tasks seen so far, for the parent row of a subtask.
    titles: dict[str, str] = field(default_factory=dict)


def _fmt(value: date | datetime) -> str:
    """In the task's own time zone, as its clients show it; a date alone has no time."""
    if isinstance(value, datetime):
        zone = " UTC" if value.tzname() == "UTC" else ""
        return f"{value.day} {value.strftime('%b %Y, %H:%M')}{zone}"
    return f"{value.day} {value.strftime('%b %Y')}"


def _when(todo, name: str) -> date | datetime | None:
    prop = todo.get(name)
    value = getattr(prop, "dt", None)
    return value if isinstance(value, date) else None


def _text(todo, name: str) -> str:
    value = todo.get(name)
    return str(value).strip() if value is not None else ""


def _categories(todo) -> list[TaskLabel]:
    names: list[str] = []
    found = todo.get("CATEGORIES")
    for item in found if isinstance(found, list) else [found] if found is not None else []:
        cats = getattr(item, "cats", None)
        for name in cats if cats is not None else [str(item)]:
            text = str(name).strip()
            if text and text not in names:
                names.append(text)
    return [TaskLabel(name=name) for name in names]


def _parent(todo) -> str | None:
    found = todo.get("RELATED-TO")
    for item in found if isinstance(found, list) else [found] if found is not None else []:
        reltype = str(getattr(item, "params", {}).get("RELTYPE", "PARENT")).upper()
        if reltype == "PARENT" and str(item).strip():
            return str(item).strip()
    return None


def _priority(todo) -> str | None:
    try:
        value = int(str(todo.get("PRIORITY", "0")).strip() or 0)
    except ValueError:
        return None
    if 1 <= value <= 4:
        return "High"
    if value == 5:
        return "Medium"
    if 6 <= value <= 9:
        return "Low"
    return None


def _status(todo) -> tuple[str, StatusCategory]:
    status = _text(todo, "STATUS").upper()
    if status in _STATUS:
        return _STATUS[status]
    if todo.get("COMPLETED") is not None:
        return _STATUS["COMPLETED"]
    return _STATUS["NEEDS-ACTION"]


def _nextcloud_link(href: str) -> str:
    """The task in the Nextcloud Tasks app; empty for other servers."""
    parts = urlsplit(href)
    marker = "/remote.php/dav/calendars/"
    if marker not in parts.path:
        return ""
    root, _, rest = parts.path.partition(marker)
    segments = rest.split("/")
    if len(segments) < 3 or not segments[1] or not segments[2]:
        return ""
    calendar, resource = segments[1], segments[2]
    base = urlunsplit((parts.scheme, parts.netloc, root, "", ""))
    return f"{base}/apps/tasks/#/calendars/{calendar}/tasks/{resource}"


def todos(data: str) -> list:
    try:
        calendar = Calendar.from_ical(data)
    except ValueError:
        return []
    return [c for c in calendar.walk("VTODO")]


def to_task(todo, href: str, task_list: TaskList, titles: dict[str, str]) -> Task:
    uid = _text(todo, "UID")
    status_name, category = _status(todo)
    rows = [TaskRow(label="List", value=task_list.name)]
    if (due := _when(todo, "DUE")) is not None:
        rows.append(TaskRow(label="Due", value=_fmt(due)))
    if (start := _when(todo, "DTSTART")) is not None:
        rows.append(TaskRow(label="Starts", value=_fmt(start)))
    percent = _text(todo, "PERCENT-COMPLETE")
    if percent.isdigit() and 0 < int(percent) < 100 and category != "done":
        rows.append(TaskRow(label="Progress", value=f"{int(percent)}%"))
    if todo.get("RRULE") is not None:
        rows.append(TaskRow(label="Repeats", value="Yes"))
    if (parent := _parent(todo)) and (title := titles.get(parent)):
        rows.append(TaskRow(label="Part of", value=title))
    modified = _when(todo, "LAST-MODIFIED")
    return Task(
        source=CALDAV,
        key=uid,
        summary=_text(todo, "SUMMARY") or "Untitled task",
        status_name=status_name,
        status_category=category,
        type_name=task_list.name,
        priority_name=_priority(todo),
        updated=modified.isoformat() if isinstance(modified, datetime) else None,
        url=_nextcloud_link(href),
        fetched_at=now_iso(),
        labels=_categories(todo),
        rows=rows,
    )


@dataclass(frozen=True)
class Discovery:
    display_name: str
    home: str


class CalDavReader:
    """One person's account: their lists and the tasks their boards show, kept in memory so a
    list unchanged since the last look costs one small request."""

    source_id = CALDAV
    source_name = "CalDAV"
    source_note: str | None = None
    base_host = ""

    def __init__(
        self, http: CalDavHttp, account: CalDavAccount, clock: Callable[[], float] = time.time
    ) -> None:
        self._http = http
        self._account = account
        self._clock = clock
        self._found: Discovery | None = None
        self._lists: dict[str, _List] = {}
        self._listed_at: float | None = None
        # When a task was last looked for in every list and not found.
        self._gone: dict[str, float] = {}
        self._lock = threading.Lock()

    def _auth(self) -> tuple[str, str]:
        return self._account.username, self._account.password.get_secret_value()

    def _call(self, method: str, url: str, body: str, depth: str) -> tuple[httpx.Response, str]:
        return self._http.request(method, url, self._auth(), body, depth)

    def _discover(self) -> Discovery:
        if self._found is not None:
            return self._found
        address = self._account.address
        parts = urlsplit(address)
        starts = [address]
        if parts.path in ("", "/"):
            starts = [
                urljoin(address, "/.well-known/caldav"),
                urljoin(address, "/remote.php/dav/"),
                address,
            ]
        principal = None
        for start in starts:
            response, final = self._call("PROPFIND", start, _PRINCIPAL, "0")
            for resource in _multistatus(response, final):
                principal = _href_of(resource.props, f"{{{DAV}}}current-user-principal", final)
                if principal:
                    break
            if principal:
                break
        if not principal:
            raise ValidationFailed(
                "address: no CalDAV account was found there. Check the address of your server"
            )
        response, final = self._call("PROPFIND", principal, _HOME, "0")
        home = None
        name = ""
        for resource in _multistatus(response, final):
            home = home or _href_of(resource.props, f"{{{CAL}}}calendar-home-set", final)
            shown = resource.props.get(f"{{{DAV}}}displayname")
            if shown is not None and not name:
                name = (shown.text or "").strip()
        if not home:
            raise ValidationFailed("address: the server did not say where the task lists are")
        self._found = Discovery(display_name=name or self._account.username, home=home)
        return self._found

    def _refresh_lists(self) -> None:
        now = self._clock()
        if self._listed_at is not None and now - self._listed_at < MIN_POLL_S:
            return
        home = self._discover().home
        response, final = self._call("PROPFIND", home, _LISTS, "1")
        seen: dict[str, _List] = {}
        for resource in _multistatus(response, final):
            kind = resource.props.get(f"{{{DAV}}}resourcetype")
            if kind is None or kind.find(f"{{{CAL}}}calendar") is None:
                continue
            components = resource.props.get(f"{{{CAL}}}supported-calendar-component-set")
            if components is not None:
                names = {c.get("name", "").upper() for c in components}
                if "VTODO" not in names:
                    continue
            shown = resource.props.get(f"{{{DAV}}}displayname")
            name = (shown.text or "").strip() if shown is not None else ""
            if not name:
                name = unquote(urlsplit(resource.href).path.rstrip("/").rsplit("/", 1)[-1])
            color_el = resource.props.get(f"{{{APPLE}}}calendar-color")
            color = _HEX.match((color_el.text or "").strip()) if color_el is not None else None
            list_id = resource.href
            kept = self._lists.get(list_id) or _List(info=TaskList(id=list_id, name=name))
            kept.listed_tag = _tag(resource)
            kept.info = TaskList(
                id=list_id,
                name=name,
                color=color.group(1).lower() if color else "",
                shown=list_id not in self._account.hidden,
            )
            seen[list_id] = kept
        self._lists = seen
        self._listed_at = now

    def check(self) -> str:
        with self._lock:
            found = self._discover()
            self._refresh_lists()
            if not self._lists:
                raise ValidationFailed("address: this account has no task lists")
            return found.display_name

    def lists(self) -> list[TaskList]:
        with self._lock:
            self._refresh_lists()
            return sorted(
                (kept.info for kept in self._lists.values()), key=lambda i: i.name.lower()
            )

    def _read(self, kept: _List, response: httpx.Response, final: str) -> list[tuple[str, object]]:
        found = []
        for resource in _multistatus(response, final):
            data = resource.props.get(f"{{{CAL}}}calendar-data")
            if resource.status != 200 or data is None or not data.text:
                continue
            for todo in todos(data.text):
                uid = _text(todo, "UID")
                if not valid_uid(uid) or todo.get("RECURRENCE-ID") is not None:
                    continue
                kept.titles[uid] = _text(todo, "SUMMARY") or "Untitled task"
                found.append((resource.href, todo))
        return found

    def list_tasks(self, list_id: str, done: bool, limit: int) -> ListTasks:
        with self._lock:
            self._refresh_lists()
            kept = self._lists.get(list_id)
            if kept is None or not kept.info.shown:
                raise TaskNotFound("This task list is not in your CalDAV account.")
            response, final = self._call("REPORT", list_id, _query("" if done else _OPEN), "1")
            tasks = []
            _seen(kept, self._clock())
            for href, todo in self._read(kept, response, final):
                task = to_task(todo, href, kept.info, kept.titles)
                if not done and task.status_category == "done":
                    continue
                kept.hrefs[task.key] = href
                tasks.append(task)
            # Open ones first, then by due date, then by title: the order of a to-do app.
            tasks.sort(key=lambda t: (t.status_category == "done", _due_key(t), t.summary.lower()))
            for task in tasks[:limit]:
                kept.tasks[task.key] = task
            return ListTasks(tasks=tasks[:limit], total=len(tasks))

    def _find(self, uid: str) -> Task | None:
        """Looks for the task in every list, as when a client moved it."""
        for kept in self._lists.values():
            response, final = self._call("REPORT", kept.info.id, _query(_by_uid(uid)), "1")
            for href, todo in self._read(kept, response, final):
                if _text(todo, "UID") == uid:
                    if kept.checked_at is None:
                        _seen(kept, self._clock())
                    for other in self._lists.values():
                        other.hrefs.pop(uid, None)
                        other.tasks.pop(uid, None)
                    task = to_task(todo, href, kept.info, kept.titles)
                    kept.hrefs[uid] = href
                    kept.tasks[uid] = task
                    return task
        return None

    def resolve(self, key: str) -> Task:
        with self._lock:
            self._refresh_lists()
            task = self._find(key) if valid_uid(key) else None
            if task is None:
                raise TaskNotFound("This task was not found in your CalDAV account.")
            return task

    def _changed(self, kept: _List, now: float) -> bool:
        if kept.checked_at is not None and now - kept.checked_at < MIN_POLL_S:
            return False
        response, final = self._call("PROPFIND", kept.info.id, _CTAG, "0")
        tag = next((t for r in _multistatus(response, final) if (t := _tag(r))), None)
        kept.checked_at = now
        # A server without a change tag is read every time.
        changed = tag is None or tag != kept.tag
        kept.tag = tag
        return changed

    def _reread(self, kept: _List, uids: set[str]) -> set[str]:
        """Reads these tasks of the list again; returns the UIDs no longer there."""
        hrefs = sorted({kept.hrefs[uid] for uid in uids if uid in kept.hrefs})
        if not hrefs:
            return set()
        response, final = self._call("REPORT", kept.info.id, _multiget(hrefs), "1")
        present: set[str] = set()
        for href, todo in self._read(kept, response, final):
            uid = _text(todo, "UID")
            if uid in kept.hrefs:
                kept.hrefs[uid] = href
                kept.tasks[uid] = to_task(todo, href, kept.info, kept.titles)
                present.add(uid)
        gone = {uid for uid in uids if uid in kept.hrefs} - present
        for uid in gone:
            kept.hrefs.pop(uid, None)
            kept.tasks.pop(uid, None)
        return gone

    def poll(self, keys: list[str]) -> list[Task]:
        with self._lock:
            try:
                return self._poll(keys)
            except CalDavRejected:
                return [no_account(key) for key in keys]

    def _poll(self, keys: list[str]) -> list[Task]:
        self._refresh_lists()
        now = self._clock()
        wanted = {key for key in keys if valid_uid(key)}
        missing: set[str] = set()
        for kept in self._lists.values():
            here = wanted & set(kept.hrefs)
            if here and self._changed(kept, now):
                missing |= self._reread(kept, here)
        known = {uid for kept in self._lists.values() for uid in kept.tasks}
        for uid in sorted(wanted):
            # A task found nowhere is looked for again only now and then: each look asks
            # every list.
            if uid in known and uid not in missing:
                continue
            if uid not in missing and now - self._gone.get(uid, -RECHECK_S) < RECHECK_S:
                continue
            if self._find(uid) is None:
                self._gone[uid] = now
            else:
                self._gone.pop(uid, None)
        answer = []
        for key in keys:
            task = next((k.tasks[key] for k in self._lists.values() if key in k.tasks), None)
            answer.append(task or _gone(key))
        return answer

    def search(self, *_: object) -> NoReturn:
        raise ValidationFailed("CalDAV tasks are added from their list in the card tool.")

    jql_vocabulary = jql_values = search


def _tag(resource: _Resource) -> str | None:
    for name in (f"{{{CS}}}getctag", f"{{{DAV}}}sync-token"):
        element = resource.props.get(name)
        if element is not None and (element.text or "").strip():
            return (element.text or "").strip()
    return None


def _seen(kept: _List, now: float) -> None:
    """The list's tasks were just read: the next look only asks whether it changed."""
    if kept.listed_tag is not None:
        kept.tag = kept.listed_tag
        kept.checked_at = now


def _due_key(task: Task) -> str:
    return next((row.value for row in task.rows if row.label == "Due"), "~")


def _gone(key: str) -> Task:
    return Task(source=CALDAV, key=key, state="not_found", url="", fetched_at=now_iso())


class CalDavReaders:
    """One reader per person, kept between requests so the change tags and tasks last."""

    def __init__(
        self,
        client: httpx.Client,
        allow_private: bool,
        resolver: Resolver = resolve_host,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._http = CalDavHttp(client, allow_private, resolver)
        self._clock = clock
        self._own: dict[str, tuple[bytes, CalDavReader, float]] = {}
        self._lock = threading.Lock()

    def reader(self, account: CalDavAccount) -> CalDavReader:
        """A fresh reader, used to check an account before it is saved."""
        return CalDavReader(self._http, account, self._clock)

    def of(self, user_id: str, account: CalDavAccount) -> CalDavReader:
        password = account.password.get_secret_value()
        digest = hashlib.sha256(
            "\0".join((account.address, account.username, password)).encode()
        ).digest()
        now = self._clock()
        with self._lock:
            for idle in [u for u, (_, _, used) in self._own.items() if now - used > IDLE_S]:
                del self._own[idle]
            kept = self._own.get(user_id)
            if kept is None or kept[0] != digest:
                kept = (digest, CalDavReader(self._http, account, self._clock), now)
            elif kept[1]._account.hidden != account.hidden:
                # The switches changed: the same reader, so what it learnt stays.
                kept[1]._account = account
                kept[1]._listed_at = None
            self._own[user_id] = (kept[0], kept[1], now)
            return kept[1]

    def forget(self, user_id: str) -> None:
        with self._lock:
            self._own.pop(user_id, None)
