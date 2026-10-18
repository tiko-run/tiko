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


def test_search_says_it_comes_later():
    with pytest.raises(InvalidJql, match="not available for Jira Cloud yet"):
        provider(FakeJiraCloud()).search("project = DEV", 10)


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
