import httpx
import pytest

from app.adapters.releases.github import GitHubReleaseFeed
from app.config import Settings
from app.domain.errors import DependencyUnavailable
from app.domain.updates import (
    CHECK_EVERY_S,
    CHECK_NOW_FLOOR_S,
    RETRY_FAILED_S,
    Release,
    UpdateService,
    is_newer,
    level_of,
    needs_installer,
)
from app.main import create_app
from app.version import VERSION
from tests.conftest import signed_in


class Feed:
    def __init__(self, *answers: Release | list[Release] | Exception) -> None:
        self.answers = list(answers)
        self.calls = 0

    def releases(self) -> list[Release]:
        self.calls += 1
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, Exception):
            raise answer
        return answer if isinstance(answer, list) else [answer]


class Clock:
    now = 1000.0

    def __call__(self) -> float:
        return self.now


def release(version: str, level: str = "feature") -> Release:
    return Release(
        version=version, url=f"https://github.com/o/r/releases/tag/v{version}", level=level
    )


def test_calver_compares_numerically():
    assert is_newer("2026.10.10", "2026.10.9")
    assert is_newer("2027.1.1", "2026.12.31")
    assert is_newer("2026.11.0", "2026.10.31")
    assert not is_newer("2026.10.6", "2026.10.6")
    assert not is_newer("2026.10.5", "2026.10.6")
    assert not is_newer("2026.10.7", "dev")


def test_release_candidate_sits_between_releases():
    assert is_newer("2026.10.24", "2026.10.24-rc.1")
    assert is_newer("2026.10.24-rc.2", "2026.10.24-rc.1")
    assert is_newer("2026.10.24-rc.1", "2026.10.23")
    assert not is_newer("2026.10.23", "2026.10.24-rc.1")


def test_reports_a_newer_release_and_caches_it():
    clock = Clock()
    feed = Feed(release("2026.11.1"), release("2026.12.1"))
    service = UpdateService("2026.10.6", feed, clock)
    view = service.view()
    assert (view.version, view.latest.version, view.update_available) == (
        "2026.10.6",
        "2026.11.1",
        True,
    )
    service.view()
    assert feed.calls == 1
    clock.now += CHECK_EVERY_S
    assert service.view().latest.version == "2026.12.1"


def test_same_version_is_not_an_update():
    assert not UpdateService("2026.10.6", Feed(release("2026.10.6"))).view().update_available


def test_failed_check_is_quiet_and_retried_later():
    clock = Clock()
    feed = Feed(DependencyUnavailable("offline"), release("2026.11.1"))
    service = UpdateService("2026.10.6", feed, clock)
    assert service.view().latest is None
    service.view()
    assert feed.calls == 1
    clock.now += RETRY_FAILED_S
    assert service.view().update_available


def test_checks_off_never_call_out():
    view = UpdateService("2026.10.6", None).view()
    assert (view.latest, view.update_available) == (None, False)


def test_github_feed_reads_releases_with_levels_and_etag():
    seen: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/repos/o/r/releases"
        seen.append(request.headers.get("If-None-Match"))
        if seen[-1] == '"abc"':
            return httpx.Response(304)
        return httpx.Response(
            200,
            headers={"ETag": '"abc"'},
            json=[
                {
                    "tag_name": "v2026.11.2",
                    "html_url": "https://github.com/o/r/2",
                    "body": "\n**Security release.**\n\n### Fixed\n- a hole",
                },
                {"tag_name": "v2026.11.1", "html_url": "https://github.com/o/r/1", "body": None},
                {
                    "tag_name": "v2026.11.0",
                    "html_url": "https://github.com/o/r/0",
                    "body": "Requires: installer\n\n### Changed\n- a new container",
                },
                {"tag_name": "v2026.12.0", "html_url": "https://x", "prerelease": True},
            ],
        )

    feed = GitHubReleaseFeed("o/r", httpx.Client(transport=httpx.MockTransport(handler)))
    expected = [
        Release(version="2026.11.2", url="https://github.com/o/r/2", level="security"),
        Release(version="2026.11.1", url="https://github.com/o/r/1"),
        Release(version="2026.11.0", url="https://github.com/o/r/0", installer=True),
    ]
    assert feed.releases() == expected
    assert feed.releases() == expected
    assert seen == [None, '"abc"']


def test_installer_is_needed_for_a_marked_release_or_a_feed_that_stops_short():
    marked = Release(version="2026.11.0", url="https://x", installer=True)
    cases = [
        ([release("2026.11.1"), release("2026.10.6")], False),
        ([release("2026.11.1"), marked, release("2026.10.6")], True),
        ([release("2026.11.1"), release("2026.10.9")], True),
        ([release("2026.10.6")], False),
        ([], False),
    ]
    for releases, needed in cases:
        assert UpdateService("2026.10.6", Feed(releases)).view().installer is needed, releases


def test_installer_mark_is_a_line_of_its_own():
    assert needs_installer("**Breaking changes.**\n\n  Requires: installer  \n- more")
    assert not needs_installer("- this release requires: installer for some people")
    assert not needs_installer("")


def test_github_feed_errors_become_unavailable():
    feed = GitHubReleaseFeed(
        "o/r", httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(404)))
    )
    with pytest.raises(DependencyUnavailable):
        feed.releases()


def test_version_endpoint():
    app = create_app(Settings(db_path=":memory:"), release_feed=Feed(release("2999.1.1")))
    body = signed_in(app).get("/api/version").json()
    assert body["version"] == VERSION
    assert body["update_available"] is True
    assert body["latest"]["version"] == "2999.1.1"


def test_version_endpoint_with_checks_off():
    app = create_app(Settings(db_path=":memory:", update_check=False))
    body = signed_in(app).get("/api/version").json()
    assert body == {
        "version": VERSION,
        "update_check": False,
        "latest": None,
        "update_available": False,
        "level": None,
        "newer": [],
        "installer": False,
    }


def test_level_comes_from_the_first_line_of_the_notes():
    assert level_of("**Hotfix.**\n\n### Fixed") == "hotfix"
    assert level_of("\n  **Breaking changes.**  \n") == "breaking"
    assert level_of("### Added\n**Security release.**") == "feature"
    assert level_of("") == "feature"


def test_highest_level_among_missed_releases():
    feed = Feed(
        [
            release("2026.11.3"),
            release("2026.11.2", "security"),
            release("2026.11.1", "hotfix"),
            release("2026.10.6", "breaking"),
        ]
    )
    view = UpdateService("2026.10.6", feed).view()
    assert view.latest.version == "2026.11.3"
    assert view.level == "security"
    assert [r.version for r in view.newer] == ["2026.11.3", "2026.11.2", "2026.11.1"]


def test_up_to_date_has_no_level():
    view = UpdateService("2026.11.1", Feed([release("2026.11.1", "security")])).view()
    assert (view.update_available, view.level, view.newer) == (False, None, [])


def test_check_now_asks_at_once_but_once_a_minute():
    clock = Clock()
    feed = Feed(release("2026.11.1"), release("2026.11.2"), release("2026.11.3"))
    service = UpdateService("2026.10.6", feed, clock)
    service.view()
    clock.now += CHECK_NOW_FLOOR_S - 1
    assert service.check_now().latest.version == "2026.11.1"
    clock.now += 1
    assert service.check_now().latest.version == "2026.11.2"
    service.check_now()
    assert feed.calls == 2


def test_check_now_endpoint():
    app = create_app(Settings(db_path=":memory:"), release_feed=Feed(release("2999.1.1", "hotfix")))
    body = signed_in(app).post("/api/version/check").json()
    assert (body["level"], body["newer"][0]["version"]) == ("hotfix", "2999.1.1")
