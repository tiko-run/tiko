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
        if path.endswith("/issue/bulkfetch") and not self.fail:
            self.requests.append(request)
            keys = json.loads(request.content)["issueIdsOrKeys"]
            found = [self.issues[k] for k in keys if k in self.issues]
            return httpx.Response(200, json={"issues": found, "issueErrors": []})
        # Everything else answers like Data Center; it checks a Bearer token, so pass one.
        bearer = request.headers.copy()
        bearer["authorization"] = f"Bearer {TOKEN}"
        return super().__call__(
            httpx.Request(request.method, request.url, headers=bearer, content=request.content)
        )
