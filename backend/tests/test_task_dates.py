import httpx
from pydantic import SecretStr

from app.adapters.tasks.demo import DemoTaskProvider
from app.adapters.tasks.github import to_task as github_task
from app.adapters.tasks.jira_dc import JiraDateFields, JiraDcProvider
from app.domain.settings import JiraCredentials
from app.domain.tasks import Task, tracker_day
from tests.github_fake import REPO
from tests.github_fake import issue as github_issue
from tests.jira_fake import TOKEN, FakeJira, issue
from tests.test_api_settings import connect

BASE = "https://jira.example.com"
START = {
    "id": "customfield_10015",
    "name": "Start date",
    "schema": {"type": "date"},
    "custom": True,
}
TARGET = {
    "id": "customfield_10022",
    "name": "Target start",
    "schema": {"type": "date"},
    "custom": True,
}
DUE = {"id": "duedate", "name": "Due date", "schema": {"type": "date"}, "custom": False}
TEXT = {
    "id": "customfield_10030",
    "name": "Start date",
    "schema": {"type": "string"},
    "custom": True,
}


def dated(key: str, **fields) -> dict:
    found = issue(key)
    found["fields"].update(fields)
    return found


def provider(
    fake: FakeJira, start_field: str | None = None, cache: JiraDateFields | None = None
) -> JiraDcProvider:
    creds = JiraCredentials(base_url=BASE, token=SecretStr(TOKEN), start_field=start_field)
    client = httpx.Client(transport=httpx.MockTransport(fake))
    return JiraDcProvider(lambda: creds, client, cache)


def test_jira_reads_due_and_the_first_filled_start_field():
    fake = FakeJira(
        {
            # Two projects that keep the start in different fields.
            "DEV-1": dated("DEV-1", duedate="2026-11-20", customfield_10022="2026-11-10"),
            "OPS-1": dated(
                "OPS-1", customfield_10015="2026-11-02T10:00:00.000+0300", customfield_10022=None
            ),
            "OPS-2": dated("OPS-2"),
        }
    )
    fake.fields = [TARGET, START, TEXT, DUE, {"id": "summary", "name": "Summary"}]
    dev, ops, bare = provider(fake).poll(["DEV-1", "OPS-1", "OPS-2"])
    assert (dev.start, dev.start_field) == (tracker_day("2026-11-10"), "customfield_10022")
    assert (dev.due, dev.due_field) == (tracker_day("2026-11-20"), "duedate")
    assert (ops.start, ops.start_field, ops.due) == (tracker_day("2026-11-02"), START["id"], None)
    assert (bare.start, bare.due, bare.start_field, bare.due_field) == (None, None, None, None)
    search = next(r for r in fake.requests if r.url.path.endswith("/search"))
    assert b"customfield_10015" in search.content and b"customfield_10030" not in search.content


def test_admin_choice_wins_while_the_site_has_the_field():
    fake = FakeJira(
        {"DEV-1": dated("DEV-1", customfield_10015="2026-11-02", customfield_10022="2026-11-05")}
    )
    fake.fields = [START, TARGET]
    assert provider(fake, "customfield_10022").resolve("DEV-1").start == tracker_day("2026-11-05")
    # A field removed from the site falls back to finding it by name.
    assert provider(fake, "customfield_99999").resolve("DEV-1").start == tracker_day("2026-11-02")


def test_field_list_is_kept_across_providers():
    fake = FakeJira()
    fake.fields = [START]
    cache = JiraDateFields()
    provider(fake, cache=cache).resolve("DEV-1")
    provider(fake, cache=cache).resolve("DEV-2")
    assert [r.url.path for r in fake.requests].count("/rest/api/2/field") == 1


def test_tasks_load_when_jira_does_not_list_fields():
    fake = FakeJira({"DEV-1": dated("DEV-1", duedate="2026-11-20")})
    fake.fields = {"not": "a list"}  # type: ignore[assignment]
    task = provider(fake).resolve("DEV-1")
    assert (task.start, task.due) == (None, tracker_day("2026-11-20"))


def test_start_after_due_keeps_the_due():
    task = Task(
        source="jira",
        key="DEV-1",
        url="",
        fetched_at="",
        start=tracker_day("2026-11-20"),
        start_field="customfield_10015",
        due=tracker_day("2026-11-10"),
        due_field="duedate",
    )
    assert (task.start, task.start_field, task.due) == (None, None, tracker_day("2026-11-10"))


def test_tracker_day_reads_what_the_tracker_wrote():
    assert tracker_day("2026-11-30T23:30:00Z") == tracker_day("2026-11-30")
    assert tracker_day("soon") is None
    assert tracker_day(None) is None


def test_github_due_is_the_milestone_due_date():
    milestone = {"title": "v1", "due_on": "2026-11-30T08:00:00Z"}
    task = github_task(f"{REPO}#5", github_issue(5, milestone=milestone))
    assert (task.start, task.due, task.due_field) == (None, tracker_day("2026-11-30"), "milestone")
    assert github_task(f"{REPO}#5", github_issue(5, milestone=None)).due is None


def test_demo_tasks_show_every_case():
    tasks = {t.key: t for t in DemoTaskProvider().poll([f"DEMO-{n}" for n in range(1, 13)])}
    assert tasks["DEMO-1"].start and tasks["DEMO-1"].due
    assert not tasks["DEMO-2"].start and tasks["DEMO-2"].due
    assert tasks["DEMO-6"].start and not tasks["DEMO-6"].due
    assert not tasks["DEMO-5"].start and not tasks["DEMO-5"].due


def test_admin_picks_the_start_field(jira_client, fake_jira):
    connect(jira_client)
    fake_jira.fields = [START, TARGET, DUE]
    fields = jira_client.get("/api/settings/jira/date-fields").json()
    assert fields == [
        {"id": "customfield_10015", "name": "Start date"},
        {"id": "customfield_10022", "name": "Target start"},
    ]
    fake_jira.issues["DEV-1"]["fields"].update(
        customfield_10015="2026-11-02", customfield_10022="2026-11-05", duedate="2026-11-20"
    )
    saved = jira_client.put("/api/settings", json={"jira_start_field": "customfield_10022"})
    assert saved.json()["jira"]["start_field"] == "customfield_10022"
    task = jira_client.post("/api/tasks/resolve", json={"ref": "DEV-1"}).json()["task"]
    assert (task["start"], task["due"]) == ("2026-11-05", "2026-11-20")
    assert task["start_field"] == "customfield_10022"
    auto = jira_client.put("/api/settings", json={"jira_start_field": ""})
    assert auto.json()["jira"]["start_field"] is None


def test_start_field_is_dropped_with_another_site(jira_client):
    connect(jira_client)
    jira_client.put("/api/settings", json={"jira_start_field": "customfield_10022"})
    moved = jira_client.put(
        "/api/settings", json={"jira": {"base_url": "https://other.example.com"}}
    )
    assert moved.json()["jira"]["start_field"] is None
    assert jira_client.put("/api/settings", json={"jira_start_field": "a b"}).status_code == 422


def test_field_list_is_kept_per_token():
    fake = FakeJira()
    fake.fields = [START]
    fake.tokens = {"other-token": {"DEV-1"}}
    cache = JiraDateFields()
    provider(fake, cache=cache).resolve("DEV-1")
    creds = JiraCredentials(base_url=BASE, token=SecretStr("other-token"))
    other = JiraDcProvider(lambda: creds, httpx.Client(transport=httpx.MockTransport(fake)), cache)
    other.resolve("DEV-1")
    assert [r.url.path for r in fake.requests].count("/rest/api/2/field") == 2
