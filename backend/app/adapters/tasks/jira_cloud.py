import base64

from app.adapters.tasks.jira_dc import FIELDS, JiraDcProvider, _json, _task, query_answer
from app.domain.errors import InvalidJql, JiraUnavailable
from app.domain.settings import JiraCredentials
from app.domain.tasks import MAX_SEARCH, SearchResult


class JiraCloudProvider(JiraDcProvider):
    """Jira Cloud REST with the account's e-mail and API token (Basic)."""

    source_name = "Jira Cloud"
    # bulkfetch takes up to 1000 keys when the fields are listed by name.
    poll_chunk = 1000

    def _authorization(self, creds: JiraCredentials) -> str:
        pair = f"{creds.email}:{creds.token.get_secret_value()}".encode()
        return f"Basic {base64.b64encode(pair).decode()}"

    def _fetch(self, keys: list[str]) -> tuple[str, list[dict]]:
        # Cloud's search drops unknown keys silently; bulkfetch does the same and reads by key.
        base_url, response = self._request(
            "POST", "/rest/api/3/issue/bulkfetch", json={"issueIdsOrKeys": keys, "fields": FIELDS}
        )
        if response.status_code != 200:
            raise JiraUnavailable(f"Jira returned {response.status_code}")
        issues = _json(response).get("issues", [])
        return base_url, issues if isinstance(issues, list) else []

    def search(self, jql: str, limit: int) -> SearchResult:
        # search/jql answers an unknown field or value with an empty list; only parse names them.
        _, response = self._request(
            "POST",
            "/rest/api/3/jql/parse",
            params={"validation": "strict"},
            json={"queries": [jql]},
        )
        for query in query_answer(response).get("queries") or []:
            if isinstance(query, dict) and query.get("errors"):
                raise InvalidJql(" ".join(query["errors"]))
        # A full page whatever the limit: when it is the last one, the count is exact.
        base_url, response = self._request(
            "POST",
            "/rest/api/2/search/jql",
            json={"jql": jql, "fields": FIELDS if limit else ["id"], "maxResults": MAX_SEARCH},
        )
        body = query_answer(response)
        issues = body.get("issues") if isinstance(body.get("issues"), list) else []
        tasks = [_task(base_url, issue) for issue in issues[:limit]]
        if body.get("isLast", True):
            return SearchResult(tasks, len(issues))
        # Cloud's search has no total; past the first page there is only an estimate.
        _, response = self._request(
            "POST", "/rest/api/2/search/approximate-count", json={"jql": jql}
        )
        count = query_answer(response).get("count")
        count = count if isinstance(count, int) else 0
        return SearchResult(tasks, max(count, len(issues) + 1), estimated=True)
