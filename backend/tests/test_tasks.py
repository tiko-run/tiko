import pytest

from app.domain.errors import HostMismatch, InvalidRef
from app.domain.tasks import parse_ref

HOST = "jira.example.com"


@pytest.mark.parametrize(
    ("ref", "key"),
    [
        ("DEV-12", "DEV-12"),
        ("  dev-12 ", "DEV-12"),
        ("A_B2-7", "A_B2-7"),
        ("https://jira.example.com/browse/DEV-12", "DEV-12"),
        ("https://jira.example.com/jira/browse/dev-9/", "DEV-9"),
        (
            "https://jira.example.com/jira/software/projects/DEV/boards/1?selectedIssue=DEV-4",
            "DEV-4",
        ),
    ],
)
def test_parse_ref_accepts_keys_and_links(ref, key):
    assert parse_ref(ref, HOST) == key


@pytest.mark.parametrize("ref", ["", "DEV", "121", "DEV-", "1DEV-2", "https://jira.example.com/"])
def test_parse_ref_rejects_garbage(ref):
    with pytest.raises(InvalidRef):
        parse_ref(ref, HOST)


def test_parse_ref_rejects_other_host():
    with pytest.raises(HostMismatch):
        parse_ref("https://other.example.org/browse/DEV-1", HOST)
