import httpx

from app.domain.errors import DependencyUnavailable


class HttpStatsSender:
    """Posts usage stats to the collector, documented on the guide's privacy page."""

    def __init__(self, url: str, client: httpx.Client) -> None:
        self._url = url
        self._client = client

    def send(self, body: dict) -> None:
        try:
            self._client.post(self._url, json=body).raise_for_status()
        except httpx.HTTPError as exc:
            raise DependencyUnavailable("Could not send usage stats.") from exc
