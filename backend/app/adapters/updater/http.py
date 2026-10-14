import contextlib
import os
import secrets
import tempfile
from pathlib import Path

import httpx

from app.domain.errors import DependencyUnavailable, UpdateNotPossible
from app.domain.updates import UpdaterStatus


def ensure_token(path: Path) -> str:
    """The token the updater checks; made once, by whichever API process starts first. It is
    written aside and linked into place, so a crash mid-write never leaves an empty token."""
    try:
        token = path.read_text().strip()
    except FileNotFoundError:
        token = ""
    if token:
        return token
    path.unlink(missing_ok=True)
    fd, aside = tempfile.mkstemp(dir=path.parent, prefix=".updater-token-")
    try:
        with os.fdopen(fd, "w") as file:
            file.write(secrets.token_urlsafe(32) + "\n")
        # Another API process linked its token first: keep that one.
        with contextlib.suppress(FileExistsError):
            os.link(aside, path)
    finally:
        os.unlink(aside)
    return path.read_text().strip()


class HttpUpdater:
    """The updater service on the compose network."""

    def __init__(self, url: str, token: str, client: httpx.Client) -> None:
        self._url = url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}
        self._client = client

    def _ask(self, method: str, path: str, body: dict | None = None) -> UpdaterStatus:
        try:
            response = self._client.request(
                method, self._url + path, json=body, headers=self._headers
            )
        except httpx.HTTPError as exc:
            raise DependencyUnavailable("The updater does not answer.") from exc
        if response.status_code == 409:
            raise UpdateNotPossible("An update is already running.")
        if response.status_code >= 400:
            raise DependencyUnavailable(f"The updater answered {response.status_code}.")
        try:
            return UpdaterStatus.model_validate(response.json())
        except ValueError as exc:
            raise DependencyUnavailable("The updater sent an answer tiko cannot read.") from exc

    def status(self) -> UpdaterStatus:
        return self._ask("GET", "/status")

    def start(self, version: str, current: str) -> UpdaterStatus:
        return self._ask("POST", "/update", {"version": version, "current": current})
