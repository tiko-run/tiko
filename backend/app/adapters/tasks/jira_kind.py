from urllib.parse import urlparse

import httpx

from app.domain.settings import JiraKind


def _by_host(base_url: str) -> JiraKind:
    host = (urlparse(base_url).hostname or "").lower()
    return "cloud" if host.endswith(".atlassian.net") else "dc"


def find_kind(client: httpx.Client, base_url: str) -> tuple[JiraKind, bool]:
    """Which Jira the site is, and whether the site itself said so.

    `serverInfo` answers without a token on Cloud; a Data Center behind SSO may answer with a
    login page, which still proves the site is up and is not Cloud.
    """
    try:
        response = client.get(
            f"{base_url}/rest/api/2/serverInfo", headers={"Accept": "application/json"}
        )
    except Exception:  # noqa: BLE001 — a failed probe must never break the settings page
        return _by_host(base_url), False
    try:
        deployment = response.json().get("deploymentType")
    except (ValueError, AttributeError):
        deployment = None
    if isinstance(deployment, str):
        return ("cloud" if deployment.lower() == "cloud" else "dc"), True
    return _by_host(base_url), True
