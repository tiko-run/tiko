"""Made-up GitHub REST responses for httpx.MockTransport."""

import re

import httpx

# Obviously fake, assembled so secret scanners do not flag it.
TOKEN = "-".join(["fake", "github", "token", "for", "tests"])
REPO = "octo-org/widgets"
_ISSUE = re.compile(r"^/repos/([^/]+/[^/]+)/issues/(\d+)$")
_LIST = re.compile(r"^/repos/([^/]+/[^/]+)/issues$")
_REPO = re.compile(r"^/repos/([^/]+/[^/]+)$")
# Tokens of two made-up people, for tests of private repositories.
T_ANN = "-".join(["ann", "github", "token", "for", "tests"])
T_BOB = "-".join(["bob", "github", "token", "for", "tests"])


def issue(number: int, repo: str = REPO, **fields) -> dict:
    kind = "pull" if "pull_request" in fields else "issues"
    return {
        "number": number,
        "title": f"Title of #{number}",
        "state": "open",
        "state_reason": None,
        "labels": [],
        "assignee": {"login": "alex-rivera"},
        "user": {"login": "sam-lee"},
        "updated_at": f"2026-10-01T09:00:{number % 60:02d}Z",
        "html_url": f"https://github.com/{repo}/{kind}/{number}",
        "repository_url": f"https://api.github.com/repos/{repo}",
    } | fields


class FakeGitHub:
    """Serves the issues of public repositories; `private` ones only to a request with TOKEN,
    or with a token that `tokens` gives that repository."""

    def __init__(self) -> None:
        self.repos: dict[str, dict[int, dict]] = {REPO: {1: issue(1), 2: issue(2)}}
        self.private: set[str] = set()
        # Private repositories a person's token reads, and tokens GitHub no longer accepts.
        self.tokens: dict[str, set[str]] = {}
        self.revoked: set[str] = set()
        self.limit = 60
        self.remaining = 60
        self.reset = 2_000_000_000
        self.fail: int | None = None
        self.requests: list[httpx.Request] = []

    def paths(self) -> list[str]:
        return [request.url.path for request in self.requests]

    def _headers(self) -> dict[str, str]:
        return {
            "x-ratelimit-limit": str(self.limit),
            "x-ratelimit-remaining": str(max(self.remaining, 0)),
            "x-ratelimit-reset": str(self.reset),
        }

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        bearer = request.headers.get("authorization", "").removeprefix("Bearer ")
        if self.fail:
            return httpx.Response(self.fail, json={"message": "nope"})
        if bearer in self.revoked:
            return httpx.Response(401, json={"message": "Bad credentials"})
        if self.remaining <= 0:
            return httpx.Response(403, json={"message": "rate limit"}, headers=self._headers())
        self.remaining -= 1
        path = request.url.path
        if path == "/user" and bearer:
            return httpx.Response(200, json={"login": "octo-user"}, headers=self._headers())
        for pattern in (_ISSUE, _LIST, _REPO):
            if match := pattern.match(path):
                break
        else:
            return httpx.Response(404, json={"message": "Not Found"})
        name = next((repo for repo in self.repos if repo.lower() == match.group(1).lower()), None)
        opened = bearer == TOKEN or name in self.tokens.get(bearer, set())
        if name is None or (name in self.private and not opened):
            return httpx.Response(404, json={"message": "Not Found"}, headers=self._headers())
        issues = self.repos[name]
        if pattern is _REPO:
            body: dict | list = {"full_name": name, "private": name in self.private}
            etag = f'"{name}-{name in self.private}"'
            if request.headers.get("if-none-match") == etag:
                return httpx.Response(304, headers=self._headers())
            return httpx.Response(200, json=body, headers=self._headers() | {"etag": etag})
        elif pattern is _ISSUE:
            if int(match.group(2)) not in issues:
                return httpx.Response(404, json={"message": "Not Found"}, headers=self._headers())
            body = issues[int(match.group(2))]
        else:
            body = sorted(issues.values(), key=lambda i: i["updated_at"], reverse=True)[:100]
            etag = f'"{hash(str(body))}"'
            if request.headers.get("if-none-match") == etag:
                return httpx.Response(304, headers=self._headers())
            return httpx.Response(200, json=body, headers=self._headers() | {"etag": etag})
        return httpx.Response(200, json=body, headers=self._headers())
