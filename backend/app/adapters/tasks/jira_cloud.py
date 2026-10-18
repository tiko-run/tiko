import base64

from app.adapters.tasks.jira_dc import FIELDS, JiraDcProvider, _json
from app.domain.errors import InvalidJql, JiraUnavailable
from app.domain.settings import JiraCredentials
from app.domain.tasks import Task


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

    def search(self, jql: str, limit: int) -> tuple[list[Task], int]:
        raise InvalidJql("Adding tasks by a JQL query is not available for Jira Cloud yet.")
