"""Made-up Jira DC responses for httpx.MockTransport."""

import json

import httpx

# Obviously fake, assembled so secret scanners do not flag it.
TOKEN = "-".join(["fake", "pat", "for", "tests", "only"])


def issue(key: str, status: str = "In Progress", category: str = "indeterminate") -> dict:
    return {
        "key": key,
        "fields": {
            "summary": f"Summary of {key}",
            "status": {"name": status, "statusCategory": {"key": category}},
            "issuetype": {"name": "Bug"},
            "assignee": {"displayName": "Alex Rivera"},
            "priority": {"name": "High"},
            "updated": "2026-10-01T09:00:00.000+0000",
        },
    }


AUTOCOMPLETE = {
    "visibleFieldNames": [
        {"value": "status", "displayName": "status", "operators": ["=", "!=", "in"]},
        {"value": "cf[10020]", "displayName": "Sprint - cf[10020]", "operators": ["=", "in"]},
        {"displayName": "broken entry without a value"},
    ],
    "visibleFunctionNames": [{"value": "currentUser()"}, {"value": "currentUser()"}],
    "jqlReservedWords": ["and", "or"],
}


class FakeJira:
    """Serves known issues; `fail` forces a status code for every request."""

    def __init__(self, issues: dict[str, dict] | None = None, strict_only: bool = False) -> None:
        self.issues = issues or {"DEV-1": issue("DEV-1"), "DEV-2": issue("DEV-2", "Done", "done")}
        # Other tokens and the keys each may see, like people with different Jira permissions.
        self.tokens: dict[str, set[str]] = {}
        self.fail: int | None = None
        # Like a Jira that validates JQL even with validateQuery=false.
        self.strict_only = strict_only
        self.html = False
        # The site's fields as GET /field lists them.
        self.fields: list[dict] = []
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail:
            headers = {"retry-after": "42"} if self.fail == 429 else {}
            return httpx.Response(self.fail, json={"errorMessages": ["nope"]}, headers=headers)
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        if token != TOKEN and token not in self.tokens:
            return httpx.Response(401, json={"errorMessages": ["unauthorized"]})
        issues = self.issues
        if token in self.tokens:
            issues = {k: v for k, v in self.issues.items() if k in self.tokens[token]}
        path = request.url.path
        if self.html:
            return httpx.Response(200, text="<html>Log in</html>")
        if path.endswith("/jql/autocompletedata"):
            return httpx.Response(200, json=AUTOCOMPLETE)
        if path.endswith("/jql/autocompletedata/suggestions"):
            if request.url.params.get("fieldName") != "status":
                return httpx.Response(400, json={"errorMessages": ["no suggestions"]})
            prefix = request.url.params.get("fieldValue", "").lower()
            results = [
                {"value": '"In Progress"', "displayName": "<b>In</b> Progress &amp; review"},
                {"value": "Done", "displayName": "Done"},
            ]
            return httpx.Response(
                200,
                json={
                    "results": [
                        r for r in results if r["value"].strip('"').lower().startswith(prefix)
                    ]
                },
            )
        if path.endswith("/rest/api/2/field"):
            return httpx.Response(200, json=self.fields)
        if path.endswith("/myself"):
            return httpx.Response(200, json={"name": "alex", "displayName": "Alex Rivera"})
        if "/issue/" in path:
            key = path.rsplit("/", 1)[1]
            if key in issues:
                return httpx.Response(200, json=issues[key])
            return httpx.Response(404, json={"errorMessages": ["Issue does not exist"]})
        if path.endswith("/search"):
            body = json.loads(request.content)
            jql = body["jql"]
            if not jql.startswith("key in ("):
                return self._query(jql, body.get("maxResults", 50), issues)
            keys = jql[jql.index("(") + 1 : jql.index(")")].split(",")
            missing = [k for k in keys if k not in issues]
            if not isinstance(body.get("validateQuery", True), bool):
                return httpx.Response(400, json={"errorMessages": ["Cannot deserialize value"]})
            if missing and (self.strict_only or body.get("validateQuery", True)):
                errors = [
                    f"An issue with key '{k}' does not exist for field 'key'." for k in missing
                ]
                return httpx.Response(400, json={"errorMessages": errors})
            found = [issues[k] for k in keys if k in issues]
            return httpx.Response(200, json={"issues": found, "total": len(found)})
        return httpx.Response(404)

    def _query(self, jql: str, limit: int, issues: dict[str, dict]) -> httpx.Response:
        """Free JQL: "bad" in the query is a syntax error, anything else matches every issue."""
        if "bad" in jql:
            return httpx.Response(400, json={"errorMessages": ["Error in the JQL Query"]})
        found = list(issues.values())
        return httpx.Response(200, json={"issues": found[:limit], "total": len(found)})
