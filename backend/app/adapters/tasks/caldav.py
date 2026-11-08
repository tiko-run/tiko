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
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime
from typing import NoReturn
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit

import httpx
from icalendar import Calendar

from app.domain.caldav import CalDavAccount, ListTasks, TaskList, no_account
from app.domain.errors import (
    CalDavAddressRefused,
    CalDavRejected,
    TaskNotFound,
    TrackerRateLimited,
    TrackerUnavailable,
    TrackerUnreachable,
    ValidationFailed,
)
from app.domain.tasks import (
    CALDAV,
    StatusCategory,
    Task,
    TaskLabel,
    TaskRow,
    now_iso,
    valid_uid,
)

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


# NAT64 addresses carry an IPv4 address inside; the private one hides behind a global prefix.
_NAT64 = ipaddress.ip_network("64:ff9b::/96")


def same_site(host: str, home: str) -> bool:
    """Whether the password typed for `home` may go to `host`: the same host or a sibling one,
    as iCloud moves an account from caldav.icloud.com to pNN-caldav.icloud.com."""
    host, home = host.lower(), home.lower()
    if host == home:
        return True
    _, _, parent = home.partition(".")
    return parent.count(".") >= 1 and host.endswith(f".{parent}")


class CalDavHttp:
    """Requests to a person's server, pinned to the address that was checked."""

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
        # The host is resolved once and the request goes to that address, so a name cannot
        # turn into another address between the check and the connection.
        parts = urlsplit(url)
        host = parts.hostname or ""
        if parts.scheme not in ("http", "https") or not host:
            raise CalDavAddressRefused("address: only http and https addresses work")
        try:
            given = parts.port
        except ValueError as exc:
            raise CalDavAddressRefused("address: the port is not a number tiko can use") from exc
        port = given or (443 if parts.scheme == "https" else 80)
        try:
            found = [ipaddress.ip_address(a.split("%")[0]) for a in self._resolver(host, port)]
        except (OSError, ValueError) as exc:
            raise TrackerUnreachable(f"The CalDAV server {host} was not found.") from exc
        if not found:
            raise TrackerUnreachable(f"The CalDAV server {host} was not found.")
        private = any(not ip.is_global or (ip.version == 6 and ip in _NAT64) for ip in found)
        if private and not self._allow_private:
            raise CalDavAddressRefused(
                f"address: {host} is on a private network, which this tiko does not connect to"
            )
        if not private and parts.scheme != "https":
            # Every request carries the password; on a public network only TLS keeps it.
            raise CalDavAddressRefused("address: a server on the internet needs https://")
        ip = found[0]
        literal = f"[{ip}]" if ip.version == 6 else str(ip)
        netloc = f"{literal}:{given}" if given else literal
        named = f"[{host}]" if ":" in host else host
        target = urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, ""))
        return target, f"{named}:{given}" if given else named, host

    def request(
        self,
        method: str,
        url: str,
        auth: tuple[str, str],
        home: str,
        body: str | None = None,
        depth: str | None = None,
    ) -> tuple[httpx.Response, str]:
        """The answer and the URL that gave it, after redirects; `home` is the host the
        password was typed for."""
        for _ in range(MAX_REDIRECTS + 1):
            target, host_header, sni = self._pinned(url)
            if not same_site(sni, home):
                raise CalDavAddressRefused(
                    f"address: the server sent tiko on to {sni}, another server, and the"
                    " password stays with the one it was typed for"
                )
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
            # One client serves everyone: a cookie from one person's session must never ride
            # along with the next person's request.
            request.headers.pop("cookie", None)
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
            except httpx.TransportError as exc:
                raise TrackerUnreachable(f"The CalDAV server {sni} could not be reached.") from exc
            finally:
                response.close()
                self._client.cookies.clear()
            _raise_for(response)
            # The body is already decoded, so the answer keeps no header that would decode it
            # again.
            kept = [
                (name, value)
                for name, value in response.headers.items()
                if name.lower() not in ("content-encoding", "content-length", "transfer-encoding")
            ]
            read = httpx.Response(
                response.status_code, headers=kept, content=b"".join(chunks), request=request
            )
            return read, url
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
        absolute = urljoin(base, href)
        # A task or list lives on the server that answered; a link elsewhere is not followed.
        if _origin(absolute) != _origin(base):
            continue
        found.append(_Resource(href=absolute, status=status, props=props))
    return found


def _origin(url: str) -> tuple[str, str, int | None]:
    parts = urlsplit(url)
    try:
        port = parts.port
    except ValueError:
        port = -1
    return parts.scheme, (parts.hostname or "").lower(), port


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


def _by_title(words: str) -> str:
    return (
        '<c:prop-filter name="SUMMARY"><c:text-match collation="i;unicode-casemap">'
        f"{_xml_text(words)}</c:text-match></c:prop-filter>"
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


def _day(value: date | datetime | None) -> date | None:
    # The day as the task writes it, in its own time zone: the day its clients show.
    if isinstance(value, datetime):
        return value.date()
    return value


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
    # The task in the Nextcloud Tasks app; other servers have no page for a task.
    parts = urlsplit(href)
    if parts.scheme not in ("http", "https"):
        return ""
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
    rows: list[TaskRow] = []
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
        start=_day(start),
        due=_day(due),
        start_field="DTSTART" if start is not None else None,
        due_field="DUE" if due is not None else None,
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
    """One person's account, with the lists and tasks their boards show kept in memory."""

    # A list unchanged since the last look costs one small request.

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
        home = urlsplit(self._account.address).hostname or ""
        return self._http.request(method, url, self._auth(), home, body, depth)

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

    def find_tasks(self, query: str, list_id: str | None, done: bool, limit: int) -> ListTasks:
        """Tasks whose title holds `query`, in one list or in every shown one."""
        # The server does the matching, so a list of thousands sends only what matches. The
        # list is not marked as read: the cards on boards were not read again.
        with self._lock:
            self._refresh_lists()
            if list_id is None:
                lists = [kept for kept in self._lists.values() if kept.info.shown]
            else:
                kept = self._lists.get(list_id)
                if kept is None or not kept.info.shown:
                    raise TaskNotFound("This task list is not in your CalDAV account.")
                lists = [kept]
            words = query.strip()
            filters = ("" if done else _OPEN) + (_by_title(words) if words else "")
            needle = words.casefold()
            ranked = []
            for kept in lists:
                response, final = self._call("REPORT", kept.info.id, _query(filters), "1")
                for href, todo in self._read(kept, response, final):
                    task = to_task(todo, href, kept.info, kept.titles)
                    # Checked here too: a server may skip a filter it does not know.
                    if not done and task.status_category == "done":
                        continue
                    if needle and needle not in task.summary.casefold():
                        continue
                    kept.hrefs[task.key] = href
                    kept.tasks[task.key] = task
                    ranked.append(
                        (task.status_category == "done", _due_key(todo), task.summary.lower(), task)
                    )
            # Open ones first, then by due date, then by title: the order of a to-do app.
            ranked.sort(key=lambda item: item[:3])
            return ListTasks(tasks=[item[3] for item in ranked[:limit]], total=len(ranked))

    def _find(self, uid: str) -> Task | None:
        # Every list is asked, as when a client moved the task.
        for kept in self._lists.values():
            response, final = self._call("REPORT", kept.info.id, _query(_by_uid(uid)), "1")
            for href, todo in self._read(kept, response, final):
                if _text(todo, "UID") == uid:
                    # Only a list with no other cards is fully known after this read.
                    if set(kept.hrefs) <= {uid}:
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
        # Returns the UIDs no longer in the list.
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
        self._gone = {uid: at for uid, at in self._gone.items() if now - at < IDLE_S}
        # A task found nowhere is looked for again only now and then.
        lost = {
            uid
            for uid in wanted - known
            if uid in missing or now - self._gone.get(uid, -RECHECK_S) >= RECHECK_S
        } | missing
        if lost:
            found = self._locate(lost)
            for uid in lost:
                if uid in found:
                    self._gone.pop(uid, None)
                else:
                    self._gone[uid] = now
        answer = []
        for key in keys:
            task = next((k.tasks[key] for k in self._lists.values() if key in k.tasks), None)
            answer.append(task or _gone(key))
        return answer

    def _locate(self, uids: set[str]) -> set[str]:
        # One read of each whole list finds any number of cards, as after a restart, where
        # asking per card would cost cards times lists requests.
        found: set[str] = set()
        now = self._clock()
        for kept in self._lists.values():
            response, final = self._call("REPORT", kept.info.id, _query(""), "1")
            present = set()
            for href, todo in self._read(kept, response, final):
                uid = _text(todo, "UID")
                present.add(uid)
                if uid in uids or uid in kept.hrefs:
                    for other in self._lists.values():
                        if other is not kept:
                            other.hrefs.pop(uid, None)
                            other.tasks.pop(uid, None)
                    kept.hrefs[uid] = href
                    kept.tasks[uid] = to_task(todo, href, kept.info, kept.titles)
                    if uid in uids:
                        found.add(uid)
            for uid in set(kept.hrefs) - present:
                kept.hrefs.pop(uid, None)
                kept.tasks.pop(uid, None)
            _seen(kept, now)
        return found

    def set_hidden(self, hidden: frozenset[str]) -> None:
        """Takes the person's new list switches; what the reader learnt stays."""
        with self._lock:
            if hidden != self._account.hidden:
                self._account = replace(self._account, hidden=hidden)
                self._listed_at = None

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
    # The list's cards were just read: the next look only asks whether it changed.
    if kept.listed_tag is not None:
        kept.tag = kept.listed_tag
        kept.checked_at = now


def _due_key(todo) -> datetime:
    # A date alone counts as its midnight; a task without one sorts last.
    due = _when(todo, "DUE")
    if due is None:
        return datetime.max
    if not isinstance(due, datetime):
        return datetime(due.year, due.month, due.day)
    if due.tzinfo is not None:
        return due.astimezone(UTC).replace(tzinfo=None)
    return due


def _gone(key: str) -> Task:
    return Task(source=CALDAV, key=key, state="not_found", url="", fetched_at=now_iso())


class CalDavReaders:
    """One reader per person, kept between requests so its change tags and tasks last."""

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
        """A fresh reader that checks an account before it is saved."""
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
            else:
                kept[1].set_hidden(account.hidden)
            self._own[user_id] = (kept[0], kept[1], now)
            return kept[1]

    def forget(self, user_id: str) -> None:
        with self._lock:
            self._own.pop(user_id, None)
