"""Spec 040 against a real CalDAV server of scripts/caldav-stand, seeded by its seed.py.

Skipped unless TIKO_CALDAV_STAND_URL is set, for example http://localhost:5232 for Radicale or
http://localhost:8089 for Nextcloud. User and password: CALDAV_USER, CALDAV_PASSWORD."""

import os

import httpx
import pytest
from pydantic import SecretStr

from app.adapters.tasks.caldav import CalDavHttp, CalDavReader
from app.domain.caldav import CalDavAccount, normalize_address

URL = os.environ.get("TIKO_CALDAV_STAND_URL", "")

pytestmark = pytest.mark.skipif(not URL, reason="needs the CalDAV stand: TIKO_CALDAV_STAND_URL")


@pytest.fixture
def reader() -> CalDavReader:
    account = CalDavAccount(
        address=normalize_address(URL),
        username=os.environ.get("CALDAV_USER", "ann"),
        password=SecretStr(os.environ.get("CALDAV_PASSWORD", "made-up-stand-password")),
    )
    return CalDavReader(CalDavHttp(httpx.Client(timeout=15), allow_private=True), account)


def by_name(reader: CalDavReader) -> dict[str, str]:
    return {item.name: item.id for item in reader.lists()}


def test_finds_the_task_lists_and_skips_event_calendars(reader):
    assert reader.check()
    names = by_name(reader)
    assert {"Home", "Groceries"} <= set(names)
    assert "Events" not in names


def test_reads_tasks_as_their_clients_wrote_them(reader):
    personal = by_name(reader)["Home"]
    open_tasks = {t.key: t for t in reader.list_tasks(personal, done=False, limit=50).tasks}
    assert "stand-done-1" not in open_tasks
    assert "stand-cancelled-1" not in open_tasks
    apple = open_tasks["stand-apple-1"]
    assert apple.priority_name == "High"
    assert {r.label: r.value for r in apple.rows}["Due"] == "12 Nov 2026, 14:30"
    thunderbird = open_tasks["stand-thunderbird-1"]
    assert (thunderbird.status_name, thunderbird.status_category) == (
        "In progress",
        "indeterminate",
    )
    child = {r.label: r.value for r in open_tasks["stand-child-1"].rows}
    assert child["Part of"] == "Plan the holidays"
    every = reader.list_tasks(personal, done=True, limit=50).tasks
    assert {"stand-done-1", "stand-cancelled-1"} <= {t.key for t in every}


def test_resolves_and_polls_by_uid(reader):
    assert reader.resolve("stand-milk-1").summary == "Oat milk"
    (task,) = reader.poll(["stand-milk-1"])
    assert task.state == "ok"
