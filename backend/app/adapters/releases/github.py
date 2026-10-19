import httpx

from app.domain.errors import DependencyUnavailable
from app.domain.updates import Release, level_of, needs_installer


class GitHubReleaseFeed:
    """Recent releases of a public GitHub repository; no token, one call per check."""

    def __init__(self, repo: str, client: httpx.Client) -> None:
        self._url = f"https://api.github.com/repos/{repo}/releases"
        self._client = client
        self._etag: str | None = None
        self._releases: list[Release] = []

    def releases(self) -> list[Release]:
        headers = {"Accept": "application/vnd.github+json"}
        # Without a token a 304 still counts against the limit, but it carries no body.
        if self._etag:
            headers["If-None-Match"] = self._etag
        try:
            response = self._client.get(self._url, params={"per_page": 100}, headers=headers)
            if response.status_code == 304:
                return self._releases
            response.raise_for_status()
            self._releases = [
                Release(
                    version=item["tag_name"].removeprefix("v"),
                    url=item["html_url"],
                    level=level_of(item.get("body") or ""),
                    installer=needs_installer(item.get("body") or ""),
                )
                for item in response.json()
                if not item.get("draft") and not item.get("prerelease")
            ]
            self._etag = response.headers.get("ETag")
            return self._releases
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError) as exc:
            raise DependencyUnavailable("Could not check GitHub for a new release.") from exc
