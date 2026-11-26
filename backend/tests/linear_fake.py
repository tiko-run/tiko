"""Made-up Linear GraphQL answers for httpx.MockTransport."""

import json

import httpx

# Obviously fake, assembled so secret scanners do not flag it.
KEY = "_".join(["lin", "api", "fake", "key", "for", "tests"])
WORKSPACE = "acme"


def issue(identifier: str, **fields) -> dict:
    return {
        "id": f"uuid-{identifier}",
        "identifier": identifier,
        "title": f"Title of {identifier}",
        "url": f"https://linear.app/{WORKSPACE}/issue/{identifier}/title-of-it",
        "updatedAt": "2026-11-01T10:00:00.000Z",
        "priority": 2,
        "priorityLabel": "High",
        "dueDate": None,
        "estimate": None,
        "state": {"name": "In Progress", "type": "started"},
        "assignee": {"name": "Alex Rivera"},
        "project": None,
        "cycle": None,
        "parent": None,
        "labels": {"nodes": []},
    } | fields


class FakeLinear:
    """Answers the queries tiko sends for one workspace, to requests with `keys`."""

    def __init__(self) -> None:
        self.issues: dict[str, dict] = {"ENG-1": issue("ENG-1"), "ENG-2": issue("ENG-2")}
        # An old identifier of an issue that moved to another team: Linear still opens it.
        self.moved: dict[str, str] = {}
        self.keys = {KEY}
        self.headers: dict[str, str] = {}
        self.status: int | None = None
        self.requests: list[httpx.Request] = []
        # The person's team keys, answered a page of `team_page` at a time.
        self.teams = ["ENG"]
        self.team_page = 250

    def _answer(self, body: dict, status: int = 200) -> httpx.Response:
        return httpx.Response(status, json=body, headers=self.headers)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status:
            return httpx.Response(self.status, json={"errors": [{"message": "down"}]})
        if request.headers.get("authorization") not in self.keys:
            error = {
                "message": "Authentication required",
                "extensions": {"code": "AUTHENTICATION_ERROR"},
            }
            return httpx.Response(401, json={"errors": [error]})
        body = json.loads(request.content)
        query, variables = body["query"], body.get("variables") or {}
        if "viewer" in query:
            org = {"name": "Acme", "urlKey": WORKSPACE, "previousUrlKeys": ["acme-old"]}
            return self._answer({"data": {"viewer": {"name": "Ada Lovelace"}, "organization": org}})
        if "teams(" in query:
            start = int(variables.get("after") or 0)
            page = self.teams[start : start + self.team_page]
            more = start + self.team_page < len(self.teams)
            info = {"hasNextPage": more, "endCursor": str(start + self.team_page) if more else None}
            nodes = [{"key": k} for k in page]
            return self._answer({"data": {"teams": {"nodes": nodes, "pageInfo": info}}})
        if "issues(" in query:
            found = [self.issues[i] for i in variables["ids"] if i in self.issues]
            return self._answer({"data": {"issues": {"nodes": found}}})
        wanted = self.moved.get(variables["id"], variables["id"])
        if wanted in self.issues:
            return self._answer({"data": {"issue": self.issues[wanted]}})
        error = {
            "message": "Entity not found: Issue",
            "extensions": {"code": "INPUT_ERROR", "statusCode": 400},
        }
        return self._answer({"errors": [error], "data": None})
