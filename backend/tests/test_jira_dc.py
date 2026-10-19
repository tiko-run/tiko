import httpx
import pytest
from pydantic import SecretStr

from app.adapters.tasks.jira_dc import JiraDcProvider
from app.domain.errors import (
    InvalidJql,
    JiraRateLimited,
    JiraUnauthorized,
    JiraUnavailable,
    TaskNotFound,
)
from app.domain.settings import JiraCredentials
from tests.jira_fake import TOKEN, FakeJira

BASE = "https://jira.example.com/jira"


def provider(fake: FakeJira, token: str = TOKEN) -> JiraDcProvider:
    creds = JiraCredentials(base_url=BASE, token=SecretStr(token))
    return JiraDcProvider(lambda: creds, httpx.Client(transport=httpx.MockTransport(fake)))


def test_resolve_maps_fields():
    fake = FakeJira()
    task = provider(fake).resolve("DEV-2")
    assert task.status_category == "done"
    assert task.assignee_name == "Alex Rivera"
    assert task.url == f"{BASE}/browse/DEV-2"
    assert fake.requests[0].url.path == "/jira/rest/api/2/issue/DEV-2"
    assert provider(fake).base_host == "jira.example.com"


def test_resolve_missing():
    with pytest.raises(TaskNotFound):
        provider(FakeJira()).resolve("DEV-9")


def test_check_and_bad_token():
    assert provider(FakeJira()).check() == "Alex Rivera"
    with pytest.raises(JiraUnauthorized):
        provider(FakeJira(), token="wrong").check()


def test_poll_marks_missing_keys():
    tasks = provider(FakeJira()).poll(["DEV-1", "DEV-9"])
    assert [(t.key, t.state) for t in tasks] == [("DEV-1", "ok"), ("DEV-9", "not_found")]


@pytest.mark.parametrize(
    ("status", "error"), [(429, JiraRateLimited), (502, JiraUnavailable), (403, JiraUnauthorized)]
)
def test_error_statuses(status, error):
    fake = FakeJira()
    fake.fail = status
    with pytest.raises(error) as info:
        provider(fake).resolve("DEV-1")
    if status == 429:
        assert info.value.retry_after == 42


def test_network_error():
    def boom(request):
        raise httpx.ConnectError("refused")

    creds = JiraCredentials(base_url=BASE, token=SecretStr(TOKEN))
    jira = JiraDcProvider(lambda: creds, httpx.Client(transport=httpx.MockTransport(boom)))
    with pytest.raises(JiraUnavailable):
        jira.check()


def test_poll_survives_strict_jira_with_unknown_keys():
    fake = FakeJira(strict_only=True)
    tasks = provider(fake).poll(["DEV-1", "DEV-8", "DEV-9"])
    assert [t.state for t in tasks] == ["ok", "not_found", "not_found"]
    assert all(t.state == "not_found" for t in provider(fake).poll(["DEV-8"]))


def test_html_page_is_unavailable_not_crash():
    fake = FakeJira()
    fake.html = True
    with pytest.raises(JiraUnavailable):
        provider(fake).resolve("DEV-1")
    with pytest.raises(JiraUnavailable):
        provider(fake).check()


def test_search_returns_page_and_total():
    tasks, total, _ = provider(FakeJira()).search("project = DEV", 1)
    assert [task.key for task in tasks] == ["DEV-1"]
    assert total == 2


def test_search_bad_jql():
    with pytest.raises(InvalidJql, match="Error in the JQL Query"):
        provider(FakeJira()).search("bad query", 10)


def test_jql_vocabulary_is_cached():
    fake = FakeJira()
    jira = provider(fake)
    vocabulary = jira.jql_vocabulary()
    assert [f.name for f in vocabulary.fields] == ["status", "cf[10020]"]
    assert vocabulary.fields[1].operators == ["=", "in"]
    assert vocabulary.functions == ["currentUser()"]
    jira.jql_vocabulary()
    assert sum(r.url.path.endswith("/autocompletedata") for r in fake.requests) == 1


def test_jql_values_are_plain_text():
    values = provider(FakeJira()).jql_values("status", "in")
    assert [(v.value, v.label) for v in values] == [('"In Progress"', "In Progress & review")]


def test_jql_values_for_a_field_without_suggestions():
    assert provider(FakeJira()).jql_values("summary", "x") == []
