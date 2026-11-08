"""Puts made-up task lists and tasks on a CalDAV server of the stand, written the way
Thunderbird, Apple Reminders and the Nextcloud Tasks app write them.

    uv run --project backend python scripts/caldav-stand/seed.py http://localhost:5232/ann/
    uv run --project backend python scripts/caldav-stand/seed.py \
        http://localhost:8089/remote.php/dav/calendars/ann/

Running it again replaces the same tasks. User and password: CALDAV_USER, CALDAV_PASSWORD
(the stand's made-up ones by default)."""

import os
import sys

import httpx

STAMP = "DTSTAMP:20261101T090000Z"

LISTS = {
    "tiko-personal": ("Home", "VTODO", "#0082C9"),
    "tiko-groceries": ("Groceries", "VTODO", "#E9322D"),
    "tiko-events": ("Events", "VEVENT", "#2ECC71"),
}


def calendar(*lines: str) -> str:
    return "\r\n".join(
        ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//tiko//caldav stand//EN", *lines]
        + ["END:VCALENDAR", ""]
    )


def todo(uid: str, *lines: str) -> str:
    return calendar("BEGIN:VTODO", f"UID:{uid}", STAMP, *lines, "END:VTODO")


TIMEZONE = [
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Berlin",
    "BEGIN:STANDARD",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
]

TASKS = {
    "tiko-personal": {
        # Thunderbird: in progress with a percentage, X-MOZ fields.
        "stand-thunderbird.ics": todo(
            "stand-thunderbird-1",
            "SUMMARY:Renew the passport",
            "STATUS:IN-PROCESS",
            "PERCENT-COMPLETE:30",
            "PRIORITY:5",
            "DUE;VALUE=DATE:20261120",
            "X-MOZ-GENERATION:3",
            "LAST-MODIFIED:20261105T101500Z",
        ),
        # Apple Reminders: a time-zoned due date, high priority, its own fields.
        "stand-apple.ics": calendar(
            *TIMEZONE,
            "BEGIN:VTODO",
            "UID:stand-apple-1",
            STAMP,
            "SUMMARY:Call the dentist",
            "PRIORITY:1",
            "DUE;TZID=Europe/Berlin:20261112T143000",
            "DTSTART;TZID=Europe/Berlin:20261112T090000",
            "X-APPLE-SORT-ORDER:612345678",
            "END:VTODO",
        ),
        # Nextcloud Tasks: a parent with a subtask and categories.
        "stand-parent.ics": todo(
            "stand-parent-1",
            "SUMMARY:Plan the holidays",
            "CATEGORIES:Family,Travel",
        ),
        "stand-child.ics": todo(
            "stand-child-1",
            "SUMMARY:Book the train",
            "RELATED-TO:stand-parent-1",
            "DUE:20261201T090000Z",
        ),
        "stand-weekly.ics": todo(
            "stand-weekly-1",
            "SUMMARY:Water the plants",
            "DTSTART;VALUE=DATE:20261102",
            "RRULE:FREQ=WEEKLY",
        ),
        "stand-done.ics": todo(
            "stand-done-1",
            "SUMMARY:Pay the rent",
            "STATUS:COMPLETED",
            "COMPLETED:20261101T080000Z",
            "PERCENT-COMPLETE:100",
        ),
        "stand-cancelled.ics": todo("stand-cancelled-1", "SUMMARY:Old idea", "STATUS:CANCELLED"),
    },
    "tiko-groceries": {
        "stand-milk.ics": todo("stand-milk-1", "SUMMARY:Oat milk"),
        "stand-bread.ics": todo("stand-bread-1", "SUMMARY:Bread"),
    },
    "tiko-events": {
        "stand-event.ics": calendar(
            "BEGIN:VEVENT",
            "UID:stand-event-1",
            STAMP,
            "SUMMARY:Team lunch",
            "DTSTART:20261113T110000Z",
            "DTEND:20261113T120000Z",
            "END:VEVENT",
        ),
    },
}


def mkcalendar(name: str, component: str, color: str) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"
  xmlns:a="http://apple.com/ns/ical/"><d:set><d:prop>
<d:displayname>{name}</d:displayname><a:calendar-color>{color}</a:calendar-color>
<c:supported-calendar-component-set><c:comp name="{component}"/>
</c:supported-calendar-component-set>
</d:prop></d:set></c:mkcalendar>"""


def rename(name: str) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><d:displayname>{name}</d:displayname>
</d:prop></d:set></d:propertyupdate>"""


def main() -> None:
    home = sys.argv[1].rstrip("/") + "/"
    auth = (
        os.environ.get("CALDAV_USER", "ann"),
        os.environ.get("CALDAV_PASSWORD", "made-up-stand-password"),
    )
    with httpx.Client(auth=auth, timeout=15) as client:
        # Radicale makes the person's home on their first request.
        client.request("PROPFIND", home, headers={"Depth": "0"})
        for slug, (name, component, color) in LISTS.items():
            made = client.request(
                "MKCALENDAR",
                f"{home}{slug}/",
                content=mkcalendar(name, component, color),
                headers={"Content-Type": "application/xml"},
            )
            # 405 or 409: the list is there from an earlier run; its name is set again.
            if made.status_code not in (201, 405, 409):
                sys.exit(f"MKCALENDAR {slug}: {made.status_code} {made.text[:200]}")
            client.request(
                "PROPPATCH",
                f"{home}{slug}/",
                content=rename(name),
                headers={"Content-Type": "application/xml"},
            )
            for resource, ics in TASKS[slug].items():
                put = client.put(
                    f"{home}{slug}/{resource}",
                    content=ics,
                    headers={"Content-Type": "text/calendar; charset=utf-8"},
                )
                if put.status_code not in (201, 204):
                    sys.exit(f"PUT {slug}/{resource}: {put.status_code} {put.text[:200]}")
    print(f"seeded {sum(len(t) for t in TASKS.values())} items in {len(LISTS)} lists at {home}")


if __name__ == "__main__":
    main()
