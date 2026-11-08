"""Spec 040: CalDAV tasks read with a person's own account."""

import httpx
import pytest
from pydantic import SecretStr

from app.adapters.tasks.caldav import CalDavHttp, CalDavReader, to_task, todos
from app.domain.caldav import CalDavAccount, TaskList, normalize_address
from app.domain.errors import (
    CalDavAddressRefused,
    CalDavRejected,
    TaskNotFound,
    TrackerUnreachable,
    ValidationFailed,
)
from tests.caldav_fake import (
    HOME,
    HOST,
    PASSWORD,
    PRIVATE_IP,
    USER,
    FakeCalDav,
    resolver,
    todo,
)

PERSONAL = f"https://{HOST}{HOME}personal/"
WORK = f"https://{HOST}{HOME}work/"


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def make(
    fake: FakeCalDav,
    address: str = HOST,
    allow_private: bool = True,
    table: dict[str, str] | None = None,
    hidden: frozenset[str] = frozenset(),
    clock: Clock | None = None,
) -> CalDavReader:
    http = CalDavHttp(
        httpx.Client(transport=httpx.MockTransport(fake)), allow_private, resolver(table)
    )
    account = CalDavAccount(
        address=normalize_address(address),
        username=USER,
        password=SecretStr(PASSWORD),
        hidden=hidden,
    )
    return CalDavReader(http, account, clock or Clock())


def test_discovers_task_lists_from_a_domain():
    fake = FakeCalDav()
    reader = make(fake)
    assert reader.check() == "Ann Example"
    lists = reader.lists()
    assert [(i.name, i.color) for i in lists] == [("Personal", "0082c9"), ("Work", "0082c9")]
    assert fake.count("PROPFIND", "/.well-known/caldav") == 1


def test_a_full_address_skips_the_well_known_redirect():
    fake = FakeCalDav()
    assert make(fake, f"https://{HOST}/remote.php/dav/").check() == "Ann Example"
    assert fake.count("PROPFIND", "/.well-known/caldav") == 0


def test_a_wrong_password_is_rejected():
    fake = FakeCalDav()
    fake.password = "other"
    with pytest.raises(CalDavRejected):
        make(fake).check()


def test_hidden_lists_are_marked_and_refused_in_the_picker():
    reader = make(FakeCalDav(), hidden=frozenset({WORK}))
    assert {i.name: i.shown for i in reader.lists()} == {"Personal": True, "Work": False}
    with pytest.raises(TaskNotFound):
        reader.find_tasks("", WORK, done=False, limit=50)


def test_list_tasks_hides_done_unless_asked():
    fake = FakeCalDav()
    fake.put(
        "personal",
        "a2.ics",
        todo("task-2", "Old one", "STATUS:COMPLETED", "COMPLETED:20261001T090000Z"),
    )
    reader = make(fake)
    reader.check()
    assert [t.key for t in reader.find_tasks("", PERSONAL, done=False, limit=50).tasks] == [
        "task-1"
    ]
    found = reader.find_tasks("", PERSONAL, done=True, limit=50)
    assert [t.key for t in found.tasks] == ["task-1", "task-2"]
    assert found.total == 2


def test_list_tasks_counts_past_the_limit():
    fake = FakeCalDav()
    for n in range(2, 6):
        fake.put("personal", f"a{n}.ics", todo(f"task-{n}", f"Task {n}"))
    found = make(fake).find_tasks("", PERSONAL, done=False, limit=2)
    assert len(found.tasks) == 2
    assert found.total == 5


LIST = TaskList(id=PERSONAL, name="Personal")
HREF = f"https://{HOST}{HOME}personal/a1.ics"


def card(*lines: str, titles: dict[str, str] | None = None):
    (item,) = todos(todo("task-1", "Plan the trip", *lines))
    return to_task(item, HREF, LIST, titles or {})


@pytest.mark.parametrize(
    ("lines", "name", "category"),
    [
        ((), "To do", "new"),
        (("STATUS:NEEDS-ACTION",), "To do", "new"),
        (("STATUS:IN-PROCESS",), "In progress", "indeterminate"),
        (("STATUS:COMPLETED",), "Done", "done"),
        (("STATUS:CANCELLED",), "Cancelled", "done"),
        # Some clients set only the completion time.
        (("COMPLETED:20261001T090000Z",), "Done", "done"),
    ],
)
def test_status(lines, name, category):
    task = card(*lines)
    assert (task.status_name, task.status_category) == (name, category)


@pytest.mark.parametrize(
    ("value", "name"), [("1", "High"), ("4", "High"), ("5", "Medium"), ("9", "Low"), ("0", None)]
)
def test_priority(value, name):
    assert card(f"PRIORITY:{value}").priority_name == name


def rows(task) -> dict[str, str]:
    return {row.label: row.value for row in task.rows}


def test_dates_keep_their_own_time_zone_and_a_date_alone_has_no_time():
    task = card(
        "DUE;TZID=Europe/Berlin:20261112T143000",
        "DTSTART;VALUE=DATE:20261110",
    )
    assert rows(task)["Due"] == "12 Nov 2026, 14:30"
    assert rows(task)["Starts"] == "10 Nov 2026"
    assert rows(card("DUE:20261112T090000Z"))["Due"] == "12 Nov 2026, 09:00 UTC"


def test_rows_labels_link_and_list():
    task = card(
        "CATEGORIES:Home,Errands",
        "PERCENT-COMPLETE:40",
        "RRULE:FREQ=WEEKLY",
        "RELATED-TO:parent-1",
        "X-APPLE-SORT-ORDER:12345",
        "LAST-MODIFIED:20261105T101500Z",
        titles={"parent-1": "Holidays"},
    )
    assert [label.name for label in task.labels] == ["Home", "Errands"]
    assert rows(task) == {
        "Progress": "40%",
        "Repeats": "Yes",
        "Part of": "Holidays",
    }
    assert task.type_name == "Personal"
    assert task.updated == "2026-11-05T10:15:00+00:00"
    assert task.url == f"https://{HOST}/apps/tasks/#/calendars/personal/tasks/a1.ics"


def test_other_servers_have_no_link():
    (item,) = todos(todo("task-1", "Plan"))
    assert to_task(item, "https://dav.example.org/ann/tasks/a1.ics", LIST, {}).url == ""


def test_poll_asks_only_whether_the_list_changed():
    fake = FakeCalDav()
    clock = Clock()
    reader = make(fake, clock=clock)
    assert reader.resolve("task-1").summary == "Buy milk"
    reports = fake.count("REPORT")
    clock.now += 60
    assert reader.poll(["task-1"])[0].summary == "Buy milk"
    assert fake.count("REPORT") == reports
    fake.put("personal", "a1.ics", todo("task-1", "Buy oat milk"))
    clock.now += 60
    assert reader.poll(["task-1"])[0].summary == "Buy oat milk"
    assert fake.count("REPORT") == reports + 1


def test_poll_waits_between_looks_at_a_list():
    fake = FakeCalDav()
    clock = Clock()
    reader = make(fake, clock=clock)
    reader.resolve("task-1")
    reader.poll(["task-1"])
    asked = fake.count("PROPFIND", f"{HOME}personal/")
    clock.now += 5
    reader.poll(["task-1"])
    assert fake.count("PROPFIND", f"{HOME}personal/") == asked


def test_a_task_moved_to_another_list_is_found_again():
    fake = FakeCalDav()
    clock = Clock()
    reader = make(fake, clock=clock)
    reader.resolve("task-1")
    fake.move("a1.ics", "personal", "work")
    clock.now += 60
    (task,) = reader.poll(["task-1"])
    assert task.state == "ok"
    assert task.type_name == "Work"


def test_a_deleted_task_reads_as_not_found_and_is_not_looked_for_every_time():
    fake = FakeCalDav()
    clock = Clock()
    reader = make(fake, clock=clock)
    reader.resolve("task-1")
    del fake.lists["personal"].items["a1.ics"]
    fake.lists["personal"].ctag += 1
    clock.now += 60
    assert reader.poll(["task-1"])[0].state == "not_found"
    reports = fake.count("REPORT")
    clock.now += 60
    assert reader.poll(["task-1"])[0].state == "not_found"
    assert fake.count("REPORT") == reports


def test_a_card_added_by_someone_else_is_found_by_uid():
    reader = make(FakeCalDav())
    assert reader.poll(["task-1"])[0].summary == "Buy milk"


def test_a_password_revoked_later_turns_cards_into_connect_again():
    fake = FakeCalDav()
    clock = Clock()
    reader = make(fake, clock=clock)
    reader.resolve("task-1")
    fake.password = "changed"
    clock.now += 60
    assert reader.poll(["task-1"])[0].state == "no_token"


def test_an_unreachable_server_raises_for_the_sync_status():
    fake = FakeCalDav()
    fake.down = True
    with pytest.raises(TrackerUnreachable):
        make(fake).check()


def test_search_is_refused():
    with pytest.raises(ValidationFailed):
        make(FakeCalDav()).search("project = X", 10)


def test_never_writes():
    fake = FakeCalDav()
    clock = Clock()
    reader = make(fake, clock=clock)
    reader.check()
    reader.find_tasks("", PERSONAL, done=True, limit=50)
    reader.resolve("task-1")
    clock.now += 60
    reader.poll(["task-1", "missing"])
    assert fake.methods() <= {"PROPFIND", "REPORT", "GET"}


def test_plain_http_to_the_internet_is_refused():
    with pytest.raises(CalDavAddressRefused):
        make(FakeCalDav(), f"http://{HOST}").check()


def test_plain_http_on_a_private_network_is_allowed():
    reader = make(FakeCalDav(), "http://nas.local", table={"nas.local": PRIVATE_IP})
    assert reader.check() == "Ann Example"


def test_a_private_network_is_refused_when_switched_off():
    with pytest.raises(CalDavAddressRefused):
        make(
            FakeCalDav(), "http://nas.local", allow_private=False, table={"nas.local": PRIVATE_IP}
        ).check()


def test_a_redirect_to_a_private_address_is_refused_when_switched_off():
    fake = FakeCalDav()

    def redirecting(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/.well-known/caldav":
            return httpx.Response(301, headers={"location": "http://10.0.0.5/remote.php/dav/"})
        return fake(request)

    http = CalDavHttp(
        httpx.Client(transport=httpx.MockTransport(redirecting)),
        False,
        resolver({"10.0.0.5": "10.0.0.5"}),
    )
    account = CalDavAccount(normalize_address(HOST), USER, SecretStr(PASSWORD))
    with pytest.raises(CalDavAddressRefused):
        CalDavReader(http, account).check()


def test_requests_go_to_the_checked_address_with_the_host_name_kept():
    fake = FakeCalDav()
    make(fake).check()
    request = fake.requests[0]
    assert request.url.host == "93.184.216.34"
    assert request.headers["host"] == HOST
    assert request.extensions["sni_hostname"] == HOST


@pytest.mark.parametrize(
    ("typed", "address"),
    [
        ("cloud.example.com", "https://cloud.example.com/"),
        ("https://cloud.example.com/remote.php/dav", "https://cloud.example.com/remote.php/dav"),
        ("http://nas.local:5232", "http://nas.local:5232/"),
    ],
)
def test_normalize_address(typed, address):
    assert normalize_address(typed) == address


def test_an_address_with_a_password_in_it_is_refused():
    with pytest.raises(ValidationFailed):
        normalize_address("https://ann:secret@cloud.example.com")


def test_list_tasks_sorts_by_the_due_date_itself_and_knows_a_later_parent():
    fake = FakeCalDav()
    fake.lists["personal"].items = {
        "c.ics": todo("child", "Book the train", "DUE:20261201T090000Z", "RELATED-TO:parent"),
        "b.ics": todo("soon", "Call the dentist", "DUE;VALUE=DATE:20261112"),
        "p.ics": todo("parent", "Plan the holidays"),
    }
    found = make(fake).find_tasks("", PERSONAL, done=False, limit=50).tasks
    assert [t.key for t in found] == ["soon", "child", "parent"]
    assert rows(found[1])["Part of"] == "Plan the holidays"


def test_find_tasks_searches_every_shown_list_by_title():
    fake = FakeCalDav()
    fake.put("work", "w1.ics", todo("work-1", "Buy a new chair"))
    fake.put("work", "w2.ics", todo("work-2", "Write the report"))
    reader = make(fake)
    found = reader.find_tasks("buy", None, done=False, limit=20)
    assert sorted(t.key for t in found.tasks) == ["task-1", "work-1"]
    assert {t.type_name for t in found.tasks} == {"Personal", "Work"}
    only_work = reader.find_tasks("", WORK, done=False, limit=20)
    assert [t.key for t in only_work.tasks] == ["work-1", "work-2"]


def test_find_tasks_matches_any_case_and_script():
    fake = FakeCalDav()
    fake.put("personal", "ru.ics", todo("ru-1", "Тестовая задача"))
    found = make(fake).find_tasks("ТЕСТОВАЯ", None, done=False, limit=20)
    assert [t.key for t in found.tasks] == ["ru-1"]


def test_find_tasks_skips_hidden_lists():
    fake = FakeCalDav()
    fake.put("work", "w1.ics", todo("work-1", "Buy a new chair"))
    found = make(fake, hidden=frozenset({WORK})).find_tasks("buy", None, done=False, limit=20)
    assert [t.key for t in found.tasks] == ["task-1"]


def test_the_title_filter_goes_to_the_server():
    fake = FakeCalDav()
    make(fake).find_tasks("milk", PERSONAL, done=False, limit=20)
    report = next(r for r in fake.requests if r.method == "REPORT")
    assert b'name="SUMMARY"' in report.content


def redirect_to(location: str, fake: FakeCalDav):
    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/.well-known/caldav":
            return httpx.Response(301, headers={"location": location})
        return fake(request)

    return answer


def reader_on(handler, table: dict[str, str], allow_private: bool = True) -> CalDavReader:
    http = CalDavHttp(
        httpx.Client(transport=httpx.MockTransport(handler)), allow_private, resolver(table)
    )
    return CalDavReader(http, CalDavAccount(normalize_address(HOST), USER, SecretStr(PASSWORD)))


def test_the_password_never_follows_a_redirect_to_another_server():
    fake = FakeCalDav()
    reader = reader_on(
        redirect_to("https://evil.example.net/dav/", fake), {"evil.example.net": "93.184.216.35"}
    )
    with pytest.raises(CalDavAddressRefused):
        reader.check()
    assert all(r.headers.get("host") == HOST for r in fake.requests)


def test_a_sibling_host_of_the_same_service_is_followed():
    fake = FakeCalDav()
    sibling = "p42-cloud.example.com"
    reader = reader_on(
        redirect_to(f"https://{sibling}/remote.php/dav/", fake), {sibling: "93.184.216.35"}
    )
    assert reader.check() == "Ann Example"
    assert any(r.headers.get("host") == sibling for r in fake.requests)


def test_cookies_of_one_person_never_reach_another():
    seen: list[str | None] = []
    fake = FakeCalDav()

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("cookie"))
        response = fake(request)
        response.headers["set-cookie"] = "session=ann-only; Path=/"
        return response

    client = httpx.Client(transport=httpx.MockTransport(answer))
    http = CalDavHttp(client, True, resolver())
    account = CalDavAccount(normalize_address(HOST), USER, SecretStr(PASSWORD))
    CalDavReader(http, account).check()
    CalDavReader(http, account).check()
    assert seen and all(cookie is None for cookie in seen)


def test_a_search_does_not_hide_a_change_to_a_card():
    fake = FakeCalDav()
    fake.put("personal", "a2.ics", todo("task-2", "Call the plumber"))
    clock = Clock()
    reader = make(fake, clock=clock)
    reader.resolve("task-1")
    reader.find_tasks("", PERSONAL, done=False, limit=20)
    clock.now += 60
    reader.poll(["task-1"])
    fake.put("personal", "a1.ics", todo("task-1", "Buy oat milk"))
    clock.now += 60
    reader.find_tasks("plumber", PERSONAL, done=False, limit=20)
    clock.now += 60
    assert reader.poll(["task-1"])[0].summary == "Buy oat milk"


def test_after_a_restart_cards_are_found_with_one_read_per_list():
    fake = FakeCalDav()
    for n in range(2, 12):
        fake.put("personal", f"a{n}.ics", todo(f"task-{n}", f"Task {n}"))
    reader = make(fake)
    keys = [f"task-{n}" for n in range(1, 12)]
    assert all(t.state == "ok" for t in reader.poll(keys))
    assert fake.count("REPORT") == len(
        [n for n, item in fake.lists.items() if "VTODO" in item.components]
    )


def test_a_link_with_another_scheme_is_dropped():
    (item,) = todos(todo("task-1", "Plan"))
    href = "javascript:alert(1)//remote.php/dav/calendars/a/b/c.ics"
    assert to_task(item, href, LIST, {}).url == ""


def test_a_task_listed_on_another_server_is_skipped():
    fake = FakeCalDav()

    def answer(request: httpx.Request) -> httpx.Response:
        response = fake(request)
        if request.method == "REPORT":
            body = response.content.replace(
                f"{HOME}personal/a1.ics".encode(), b"https://evil.example.net/a1.ics"
            )
            return httpx.Response(207, content=body)
        return response

    found = reader_on(answer, {}).find_tasks("", PERSONAL, done=False, limit=20)
    assert found.tasks == []


def test_a_port_out_of_range_is_refused():
    with pytest.raises(CalDavAddressRefused):
        make(FakeCalDav(), f"https://{HOST}:99999").check()


def test_a_nat64_address_counts_as_private():
    with pytest.raises(CalDavAddressRefused):
        make(
            FakeCalDav(),
            "https://nat.example.com",
            allow_private=False,
            table={"nat.example.com": "64:ff9b::7f00:1"},
        ).check()
