"""A made-up CalDAV server laid out like Nextcloud, for httpx.MockTransport."""

import base64
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

import httpx

HOST = "cloud.example.com"
# Obviously fake, assembled so secret scanners do not flag it.
PASSWORD = "-".join(["fake", "app", "password"])
USER = "ann"
PUBLIC_IP = "93.184.216.34"
PRIVATE_IP = "192.168.1.20"
ROOT = "/remote.php/dav/"
PRINCIPAL = f"{ROOT}principals/users/{USER}/"
HOME = f"{ROOT}calendars/{USER}/"
DAV = "DAV:"
CAL = "urn:ietf:params:xml:ns:caldav"


def todo(uid: str, summary: str, *lines: str) -> str:
    body = "\r\n".join(lines)
    extra = f"{body}\r\n" if body else ""
    return (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//Tests//EN\r\n"
        "BEGIN:VTODO\r\n"
        f"UID:{uid}\r\nSUMMARY:{summary}\r\nDTSTAMP:20261101T090000Z\r\n{extra}"
        "END:VTODO\r\nEND:VCALENDAR\r\n"
    )


@dataclass
class FakeList:
    name: str
    components: tuple[str, ...] = ("VTODO",)
    ctag: int = 1
    color: str = "#0082C9FF"
    # Resource name -> iCalendar text.
    items: dict[str, str] = field(default_factory=dict)


def _status(ok: bool = True) -> str:
    return "HTTP/1.1 200 OK" if ok else "HTTP/1.1 404 Not Found"


class FakeCalDav:
    def __init__(self) -> None:
        self.lists: dict[str, FakeList] = {
            "personal": FakeList("Personal", items={"a1.ics": todo("task-1", "Buy milk")}),
            "work": FakeList("Work"),
            "calendar": FakeList("Calendar", components=("VEVENT",)),
        }
        self.requests: list[httpx.Request] = []
        self.password = PASSWORD
        self.down = False

    def methods(self) -> set[str]:
        return {request.method for request in self.requests}

    def count(self, method: str, path: str | None = None) -> int:
        return sum(
            1 for r in self.requests if r.method == method and (path is None or r.url.path == path)
        )

    def put(self, list_id: str, name: str, ics: str) -> None:
        self.lists[list_id].items[name] = ics
        self.lists[list_id].ctag += 1

    def move(self, uid_file: str, source: str, target: str) -> None:
        ics = self.lists[source].items.pop(uid_file)
        self.lists[source].ctag += 1
        self.put(target, uid_file, ics)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.down:
            raise httpx.ConnectError("down")
        expected = base64.b64encode(f"{USER}:{self.password}".encode()).decode()
        if request.headers.get("authorization") != f"Basic {expected}":
            return httpx.Response(401)
        path = request.url.path
        if path == "/.well-known/caldav":
            return httpx.Response(301, headers={"location": ROOT})
        if request.method == "PROPFIND" and path == ROOT:
            return self._ms(
                [
                    (
                        ROOT,
                        f"<d:current-user-principal><d:href>{PRINCIPAL}</d:href>"
                        "</d:current-user-principal>",
                    )
                ]
            )
        if request.method == "PROPFIND" and path == PRINCIPAL:
            return self._ms(
                [
                    (
                        PRINCIPAL,
                        f"<c:calendar-home-set><d:href>{HOME}</d:href>"
                        "</c:calendar-home-set><d:displayname>Ann Example</d:displayname>",
                    )
                ]
            )
        if request.method == "PROPFIND" and path == HOME:
            rows = [(HOME, "<d:resourcetype><d:collection/></d:resourcetype>")]
            for list_id, item in self.lists.items():
                comps = "".join(f'<c:comp name="{c}"/>' for c in item.components)
                rows.append(
                    (
                        f"{HOME}{list_id}/",
                        "<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>"
                        f"<d:displayname>{item.name}</d:displayname>"
                        f"<c:supported-calendar-component-set>{comps}"
                        "</c:supported-calendar-component-set>"
                        f"<cs:getctag>ctag-{item.ctag}</cs:getctag>"
                        f"<a:calendar-color>{item.color}</a:calendar-color>",
                    )
                )
            return self._ms(rows)
        for list_id, item in self.lists.items():
            base = f"{HOME}{list_id}/"
            if path != base:
                continue
            if request.method == "PROPFIND":
                return self._ms([(base, f"<cs:getctag>ctag-{item.ctag}</cs:getctag>")])
            if request.method == "REPORT":
                return self._report(base, item, ET.fromstring(request.content))
        return httpx.Response(404)

    def _report(self, base: str, item: FakeList, body: ET.Element) -> httpx.Response:
        if body.tag == f"{{{CAL}}}calendar-multiget":
            rows = []
            for href in body.iter(f"{{{DAV}}}href"):
                name = (href.text or "").rsplit("/", 1)[-1]
                ics = item.items.get(name)
                rows.append((href.text or "", _data(ics) if ics else None))
            return self._ms(rows)
        open_only = any(
            f.get("name") == "COMPLETED" and f.find(f"{{{CAL}}}is-not-defined") is not None
            for f in body.iter(f"{{{CAL}}}prop-filter")
        )
        uid = next(
            (
                (f.findtext(f"{{{CAL}}}text-match") or "")
                for f in body.iter(f"{{{CAL}}}prop-filter")
                if f.get("name") == "UID"
            ),
            None,
        )
        title = next(
            (
                (f.findtext(f"{{{CAL}}}text-match") or "")
                for f in body.iter(f"{{{CAL}}}prop-filter")
                if f.get("name") == "SUMMARY"
            ),
            None,
        )
        rows = []
        for name, ics in item.items.items():
            if open_only and "\r\nCOMPLETED:" in ics:
                continue
            if uid is not None and uid not in ics:
                continue
            summary = ics.split("SUMMARY:", 1)[1].split("\r\n", 1)[0]
            if title is not None and title.casefold() not in summary.casefold():
                continue
            rows.append((f"{base}{name}", _data(ics)))
        return self._ms(rows)

    def _ms(self, rows: list[tuple[str, str | None]]) -> httpx.Response:
        parts = []
        for href, props in rows:
            if props is None:
                parts.append(
                    f"<d:response><d:href>{href}</d:href><d:status>{_status(False)}</d:status>"
                    "</d:response>"
                )
                continue
            parts.append(
                f"<d:response><d:href>{href}</d:href><d:propstat><d:prop>{props}</d:prop>"
                f"<d:status>{_status()}</d:status></d:propstat></d:response>"
            )
        xml = (
            '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" '
            'xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" '
            f'xmlns:a="http://apple.com/ns/ical/">{"".join(parts)}</d:multistatus>'
        )
        return httpx.Response(207, content=xml.encode())


def _data(ics: str) -> str:
    escaped = ics.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f'<d:getetag>"1"</d:getetag><c:calendar-data>{escaped}</c:calendar-data>'


def resolver(table: dict[str, str] | None = None):
    hosts = {HOST: PUBLIC_IP} | (table or {})

    def resolve(host: str, _port: int) -> list[str]:
        if host in hosts:
            return [hosts[host]]
        raise OSError("unknown host")

    return resolve
