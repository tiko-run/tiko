"""Made-up Jira Cloud responses for httpx.MockTransport."""

import base64
import json

import httpx

from tests.jira_fake import TOKEN, FakeJira

EMAIL = "alex.rivera@example.com"


def basic(email: str = EMAIL, token: str = TOKEN) -> str:
    return "Basic " + base64.b64encode(f"{email}:{token}".encode()).decode()


class FakeJiraCloud(FakeJira):
    """Jira Cloud: Basic auth, bulkfetch, serverInfo without auth, the old search gone."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        # The Authorization header of every request, as tiko sent it.
        self.auth: list[str] = []
        # What approximate-count answers; None counts every issue.
        self.estimate: int | None = None

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.auth.append(request.headers.get("authorization", ""))
        if path.endswith("/serverInfo"):
            self.requests.append(request)
            return httpx.Response(200, json={"deploymentType": "Cloud", "version": "1001.0.0"})
        auth = request.headers.get("authorization", "")
        if auth != basic():
            self.requests.append(request)
            if self.fail:
                return super().__call__(request)
            return httpx.Response(401, json={"errorMessages": ["unauthorized"]})
        if path.endswith("/search"):
            self.requests.append(request)
            return httpx.Response(410, json={"errorMessages": ["The API has been removed."]})
        if path.endswith("/jql/parse") and not self.fail:
            self.requests.append(request)
            queries = [_parsed(q) for q in _body(request)["queries"]]
            return httpx.Response(200, json={"queries": queries})
        if path.endswith("/search/jql") and not self.fail:
            self.requests.append(request)
            return self._search_jql(_body(request))
        if path.endswith("/search/approximate-count") and not self.fail:
            self.requests.append(request)
            count = len(self.issues) if self.estimate is None else self.estimate
            return httpx.Response(200, json={"count": count})
        if path.endswith("/issue/bulkfetch") and not self.fail:
            self.requests.append(request)
            keys = _body(request)["issueIdsOrKeys"]
            found = [self.issues[k] for k in keys if k in self.issues]
            return httpx.Response(200, json={"issues": found, "issueErrors": []})
        # Everything else answers like Data Center; it checks a Bearer token, so pass one.
        bearer = request.headers.copy()
        bearer["authorization"] = f"Bearer {TOKEN}"
        return super().__call__(
            httpx.Request(request.method, request.url, headers=bearer, content=request.content)
        )

    def _search_jql(self, body: dict) -> httpx.Response:
        """Every issue matches; a query without a condition is refused, as Cloud does."""
        if body["jql"].lower().startswith("order by"):
            refused = ["Unbounded JQL queries are not allowed here."]
            return httpx.Response(400, json={"errorMessages": refused})
        found = list(self.issues.values())
        page = found[: body["maxResults"]]
        if body.get("fields") == ["id"]:
            page = [{"id": str(n)} for n, _ in enumerate(page)]
        return httpx.Response(200, json={"issues": page, "isLast": len(found) <= len(page)})


def _body(request: httpx.Request) -> dict:
    return json.loads(request.content)


def _parsed(query: str) -> dict:
    """A syntax error with "bad", an unknown field with "nofield"; only parse names them."""
    if "bad" in query:
        return {"query": query, "errors": ["Error in the JQL Query: Expecting a value."]}
    if "nofield" in query:
        return {"query": query, "errors": ["Field 'nofield' does not exist."]}
    return {"query": query, "errors": None}
