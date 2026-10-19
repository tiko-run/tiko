import json

import httpx
import pytest
from pydantic import SecretStr

from app.adapters.tasks.jira_cloud import JiraCloudProvider
from app.adapters.tasks.jira_kind import find_kind
from app.domain.errors import InvalidJql, JiraRateLimited, JiraUnauthorized, TaskNotFound
from app.domain.settings import JiraCredentials
from tests.jira_cloud_fake import EMAIL, FakeJiraCloud, basic
from tests.jira_fake import TOKEN, FakeJira, issue

BASE = "https://example.atlassian.net"


def provider(fake: FakeJiraCloud, email: str = EMAIL) -> JiraCloudProvider:
    creds = JiraCredentials(base_url=BASE, token=SecretStr(TOKEN), email=email, kind="cloud")
    return JiraCloudProvider(lambda: creds, httpx.Client(transport=httpx.MockTransport(fake)))


def client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_signs_in_with_email_and_token():
    fake = FakeJiraCloud()
    assert provider(fake).check() == "Alex Rivera"
    assert fake.auth == [basic()]
    with pytest.raises(JiraUnauthorized):
        provider(FakeJiraCloud(), email="someone.else@example.com").check()


def test_resolve_and_missing():
    task = provider(FakeJiraCloud()).resolve("DEV-2")
    assert (task.source, task.status_category) == ("jira", "done")
    assert task.url == f"{BASE}/browse/DEV-2"
    with pytest.raises(TaskNotFound):
        provider(FakeJiraCloud()).resolve("DEV-9")


def test_poll_reads_by_bulkfetch_and_marks_missing_keys():
    fake = FakeJiraCloud()
    tasks = provider(fake).poll(["DEV-1", "DEV-9"])
    assert [(t.key, t.state) for t in tasks] == [("DEV-1", "ok"), ("DEV-9", "not_found")]
    assert [r.url.path for r in fake.requests] == ["/rest/api/3/issue/bulkfetch"]


def test_poll_of_a_big_board_is_one_request():
    fake = FakeJiraCloud({f"DEV-{n}": issue(f"DEV-{n}") for n in range(1, 301)})
    tasks = provider(fake).poll([f"DEV-{n}" for n in range(1, 301)])
    assert all(t.state == "ok" for t in tasks)
    assert len(fake.requests) == 1


def test_rate_limit_waits_as_asked():
    fake = FakeJiraCloud()
    fake.fail = 429
    with pytest.raises(JiraRateLimited) as info:
        provider(fake).poll(["DEV-1"])
    assert info.value.retry_after == 42


def test_beta_retry_after_is_read():
    def limited(request):
        return httpx.Response(429, headers={"beta-retry-after": "7"})

    creds = JiraCredentials(base_url=BASE, token=SecretStr(TOKEN), email=EMAIL, kind="cloud")
    with pytest.raises(JiraRateLimited) as info:
        JiraCloudProvider(lambda: creds, client(limited)).resolve("DEV-1")
    assert info.value.retry_after == 7


def test_search_checks_the_query_then_reads_one_page():
    fake = FakeJiraCloud()
    tasks, total, estimated = provider(fake).search("project = DEV", 10)
    assert ([t.key for t in tasks], total, estimated) == (["DEV-1", "DEV-2"], 2, False)
    paths = [r.url.path for r in fake.requests]
    assert paths == ["/rest/api/3/jql/parse", "/rest/api/2/search/jql"]


def test_search_past_the_page_is_an_estimate():
    fake = FakeJiraCloud({f"DEV-{n}": issue(f"DEV-{n}") for n in range(1, 151)})
    fake.estimate = 140
    tasks, total, estimated = provider(fake).search("project = DEV", 50)
    assert (len(tasks), total, estimated) == (50, 140, True)


def test_estimate_below_the_page_counts_the_page():
    fake = FakeJiraCloud({f"DEV-{n}": issue(f"DEV-{n}") for n in range(1, 151)})
    fake.estimate = 30
    assert provider(fake).search("project = DEV", 50).total == 101


def test_count_only_reads_ids():
    fake = FakeJiraCloud()
    assert provider(fake).search("project = DEV", 0) == ([], 2, False)
    search = next(r for r in fake.requests if r.url.path.endswith("/search/jql"))
    assert json.loads(search.content)["fields"] == ["id"]


@pytest.mark.parametrize(
    ("jql", "message"),
    [
        ("bad query", "Expecting a value"),
        ("nofield = 1", "Field 'nofield' does not exist"),
        ("order by created", "Unbounded JQL queries"),
    ],
)
def test_search_shows_jiras_message(jql, message):
    with pytest.raises(InvalidJql, match=message):
        provider(FakeJiraCloud()).search(jql, 10)


def test_suggestions_as_on_data_center():
    cloud = provider(FakeJiraCloud())
    assert "status" in [f.name for f in cloud.jql_vocabulary().fields]
    assert [v.value for v in cloud.jql_values("status", "do")] == ["Done"]


def test_kind_from_the_site():
    assert find_kind(client(FakeJiraCloud()), "https://jira.example.com") == ("cloud", True)
    assert find_kind(client(FakeJira()), "https://jira.example.com") == ("dc", True)


def test_kind_of_a_login_page_by_host():
    def sso(request):
        return httpx.Response(200, text="<html>Log in</html>")

    assert find_kind(client(sso), "https://jira.example.com") == ("dc", True)
    assert find_kind(client(sso), "https://example.atlassian.net") == ("cloud", True)


def test_kind_of_an_unreachable_site_is_a_guess():
    def down(request):
        raise httpx.ConnectError("refused")

    assert find_kind(client(down), BASE) == ("cloud", False)
    assert find_kind(client(down), "https://jira.example.com") == ("dc", False)
