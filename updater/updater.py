"""tiko updater: pulls a release and recreates the api and web containers through the Docker API.

The one service with the Docker socket, so the API never gets it. Stdlib only. It answers on
the compose network only, and only to a request carrying the token the API keeps in data/.
"""

import http.client
import json
import logging
import os
import re
import secrets
import shutil
import socket
import sqlite3
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlencode

log = logging.getLogger("updater")

INSTALL = Path(os.environ.get("TIKO_INSTALL_DIR", "/install"))
SOCKET = os.environ.get("DOCKER_SOCKET", "/var/run/docker.sock")
# api first: web waits for a healthy api.
SERVICES = ("api", "web")
HEALTHY_WITHIN_S = 120
# A container without a health check counts as up once it has run this long.
SETTLE_S = 5
STOP_TIMEOUT_S = 10
# Copies of the database taken before an update; older ones are deleted.
KEEP_BACKUPS = 3
STEPS_PER_IMAGE = 1000
LOG_LINES = 50
VERSION = re.compile(r"^\d{4}\.\d{1,2}\.\d{1,3}$")
TAG_DEFAULT = re.compile(r"\$\{TAG:-[^}]*\}")
# Settings the image brings: copied only when the container changed them, so the new image's apply.
FROM_IMAGE = (
    "Cmd",
    "Entrypoint",
    "WorkingDir",
    "User",
    "Healthcheck",
    "ExposedPorts",
    "StopSignal",
)


class DockerError(Exception):
    pass


class _UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: str, timeout: float) -> None:
        super().__init__("localhost", timeout=timeout)
        self._path = path

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        sock.connect(self._path)
        self.sock = sock


class Docker:
    """The few Docker Engine API calls an update needs. Unversioned paths: the engine picks its
    own API version, and new engines refuse old ones."""

    def __init__(self, path: str = SOCKET) -> None:
        self._path = path

    def _open(self, method: str, path: str, body: object = None, timeout: float = 60):
        conn = _UnixConnection(self._path, timeout)
        data = None if body is None else json.dumps(body).encode()
        headers = {"Content-Type": "application/json"} if data is not None else {}
        conn.request(method, path, body=data, headers=headers)
        return conn, conn.getresponse()

    def _call(self, method: str, path: str, body: object = None, timeout: float = 60):
        conn, response = self._open(method, path, body, timeout)
        try:
            raw = response.read()
        finally:
            conn.close()
        if response.status >= 400:
            try:
                message = json.loads(raw).get("message", "")
            except ValueError:
                message = raw.decode(errors="replace")
            raise DockerError(f"{method} {path.split('?')[0]}: {response.status} {message}".strip())
        return json.loads(raw) if raw else None

    def container(self, ref: str) -> dict:
        return self._call("GET", f"/containers/{quote(ref)}/json")

    def containers(self, labels: list[str]) -> list[dict]:
        query = urlencode({"all": "1", "filters": json.dumps({"label": labels})})
        return self._call("GET", f"/containers/json?{query}")

    def image(self, ref: str) -> dict:
        return self._call("GET", f"/images/{quote(ref, safe='')}/json")

    def images(self, repo: str) -> list[dict]:
        query = urlencode({"filters": json.dumps({"reference": [repo]})})
        return self._call("GET", f"/images/json?{query}")

    def pull(self, repo: str, tag: str) -> Iterator[dict]:
        query = urlencode({"fromImage": repo, "tag": tag})
        conn, response = self._open("POST", f"/images/create?{query}", timeout=900)
        try:
            if response.status >= 400:
                raise DockerError(
                    f"pull {repo}:{tag}: {response.status} {response.read().decode()}"
                )
            for line in response:
                if line.strip():
                    yield json.loads(line)
        finally:
            conn.close()

    def create(self, name: str, body: dict) -> str:
        return self._call("POST", f"/containers/create?{urlencode({'name': name})}", body)["Id"]

    def connect(self, network: str, container: str, endpoint: dict) -> None:
        body = {"Container": container, "EndpointConfig": endpoint}
        self._call("POST", f"/networks/{quote(network)}/connect", body)

    def rename(self, container: str, name: str) -> None:
        self._call("POST", f"/containers/{container}/rename?{urlencode({'name': name})}")

    def start(self, container: str) -> None:
        self._call("POST", f"/containers/{container}/start")

    def stop(self, container: str) -> None:
        self._call("POST", f"/containers/{container}/stop?t={STOP_TIMEOUT_S}", timeout=60)

    def remove(self, container: str) -> None:
        self._call("DELETE", f"/containers/{container}?force=1")

    def remove_image(self, image: str) -> None:
        self._call("DELETE", f"/images/{image}")


class Job:
    """What the last update did, for the API to show; one update at a time."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._status: dict = {"state": "idle", "log": []}

    def snapshot(self) -> dict:
        with self._lock:
            return {**self._status, "log": list(self._status["log"])}

    def begin(self, target: str) -> bool:
        with self._lock:
            if self._status["state"] == "running":
                return False
            self._status = {
                "state": "running",
                "step": "download",
                "target": target,
                "downloaded": 0,
                "total": 0,
                "error": None,
                "log": [],
            }
            return True

    def set(self, **fields) -> None:
        with self._lock:
            self._status.update(fields)

    def note(self, line: str) -> None:
        log.info(line)
        with self._lock:
            self._status["log"] = [*self._status["log"], line][-LOG_LINES:]


def split_ref(ref: str) -> tuple[str, str]:
    name, sep, tag = ref.rpartition(":")
    # A colon before the last slash is a registry port, not a tag.
    if not sep or "/" in tag:
        return ref, "latest"
    return name, tag


def service_container(docker: Docker, project: str, service: str) -> dict:
    found = docker.containers(
        [f"com.docker.compose.project={project}", f"com.docker.compose.service={service}"]
    )
    if len(found) != 1:
        raise DockerError(
            f"expected one {service} container in project {project}, found {len(found)}"
        )
    return docker.container(found[0]["Id"])


def container_body(docker: Docker, old: dict, ref: str) -> tuple[dict, list[tuple[str, dict]]]:
    """Settings for a container like `old` on image `ref`, and the networks to join after."""
    config = dict(old["Config"])
    image = docker.image(old["Image"]).get("Config") or {}
    config["Image"] = ref
    if config.get("Hostname") == old["Id"][:12]:
        config.pop("Hostname")
    for key in FROM_IMAGE:
        if key in config and config[key] == image.get(key):
            config.pop(key)
    image_env = set(image.get("Env") or [])
    config["Env"] = [e for e in config.get("Env") or [] if e not in image_env]
    image_labels = image.get("Labels") or {}
    labels = {k: v for k, v in (config.get("Labels") or {}).items() if image_labels.get(k) != v}
    # Compose's record of the old image; compose writes it again on its next `up`.
    labels.pop("com.docker.compose.image", None)
    config["Labels"] = labels
    config["HostConfig"] = old["HostConfig"]
    networks = [
        (name, {"Aliases": [a for a in ep.get("Aliases") or [] if a != old["Id"][:12]]})
        for name, ep in (old["NetworkSettings"].get("Networks") or {}).items()
    ]
    if networks:
        first, endpoint = networks[0]
        config["NetworkingConfig"] = {"EndpointsConfig": {first: endpoint}}
    return config, networks[1:]


def wait_healthy(
    docker: Docker, container: str, sleep: Callable[[float], None], clock: Callable[[], float]
) -> None:
    deadline = clock() + HEALTHY_WITHIN_S
    running_since = None
    while clock() < deadline:
        state = docker.container(container)["State"]
        if not state.get("Running"):
            # A container in a restart loop must run a whole SETTLE_S again.
            running_since = None
            if state.get("Status") in ("exited", "dead"):
                raise DockerError(f"exited with code {state.get('ExitCode')}")
        elif health := state.get("Health"):
            if health.get("Status") == "healthy":
                return
            if health.get("Status") == "unhealthy":
                raise DockerError("health check failed")
        else:
            running_since = running_since if running_since is not None else clock()
            if clock() - running_since >= SETTLE_S:
                return
        sleep(1)
    raise DockerError(f"not healthy within {HEALTHY_WITHIN_S} s")


def pull(docker: Docker, job: Job, refs: list[str]) -> None:
    # Every layer and image weighs the same: Docker names all layers of an image up front but
    # tells a layer's size only once it starts downloading, so a byte total would jump back.
    total = STEPS_PER_IMAGE * len(refs)
    progress = 0
    for index, ref in enumerate(refs):
        job.note(f"Downloading {ref}")
        repo, tag = split_ref(ref)
        layers: dict[str, float] = {}
        for event in docker.pull(repo, tag):
            if event.get("error"):
                raise DockerError(event["error"])
            layer = event.get("id", "")
            detail = event.get("progressDetail") or {}
            status = event.get("status", "")
            if status == "Pulling fs layer":
                layers.setdefault(layer, 0.0)
            elif status == "Already exists":
                # Nothing to download; often the first event, it would put the image at 100%.
                layers.pop(layer, None)
            elif status == "Downloading" and detail.get("total"):
                layers[layer] = detail.get("current", 0) / detail["total"]
            elif status in ("Download complete", "Pull complete"):
                layers[layer] = 1.0
            share = sum(layers.values()) / len(layers) if layers else 0.0
            progress = max(progress, round(STEPS_PER_IMAGE * (index + share)))
            job.set(downloaded=progress, total=total)
        progress = STEPS_PER_IMAGE * (index + 1)
        job.set(downloaded=progress, total=total)


def pin_compose(old_api: dict, target: str, install: Path) -> None:
    """Make the install's compose file default to the new version, so `docker compose up`
    later keeps it instead of going back."""
    labels = old_api["Config"].get("Labels") or {}
    work = labels.get("com.docker.compose.project.working_dir", "")
    for file in filter(None, labels.get("com.docker.compose.project.config_files", "").split(",")):
        # The host path may be a Windows one, so no os.path here.
        if not work or not file.startswith(work):
            continue
        path = install / file[len(work) :].lstrip("/\\").replace("\\", "/")
        if path.is_file():
            path.write_text(TAG_DEFAULT.sub(f"${{TAG:-{target}}}", path.read_text()))


def backup_database(install: Path, version: str) -> str | None:
    """Copies the database of the stopped api, so the copy holds every change made before it."""
    data = install / "data"
    if not (data / "app.db").exists():
        return None
    folder = data / "backups"
    folder.mkdir(exist_ok=True)
    name = f"pre-update-{version}.db"
    partial = folder / f"{name}.partial"
    partial.unlink(missing_ok=True)
    with (
        closing(sqlite3.connect(data / "app.db")) as source,
        closing(sqlite3.connect(partial)) as copy,
    ):
        source.backup(copy)
        copy.execute("PRAGMA journal_mode=DELETE")
    partial.replace(folder / name)
    kept = sorted(folder.glob("pre-update-*.db"), key=lambda p: p.stat().st_mtime)
    for old in kept[:-KEEP_BACKUPS]:
        old.unlink()
    return name


def restore_database(backup: str | None, install: Path) -> None:
    if not backup:
        return
    data = install / "data"
    shutil.copyfile(data / "backups" / backup, data / "app.db")
    for leftover in ("app.db-wal", "app.db-shm"):
        (data / leftover).unlink(missing_ok=True)


def remove_old_images(docker: Docker, job: Job, repos: list[str], keep: set[str]) -> None:
    for repo in repos:
        for image in docker.images(repo):
            tags = {
                split_ref(t)[1] for t in image.get("RepoTags") or [] if t.startswith(f"{repo}:")
            }
            if tags & keep:
                continue
            try:
                docker.remove_image(image["Id"])
                job.note(f"Removed old image {', '.join(sorted(tags)) or image['Id'][:19]}")
            except DockerError as exc:
                job.note(f"Kept an old image: {exc}")


def run_update(
    docker: Docker,
    job: Job,
    project: str,
    target: str,
    current: str,
    install: Path = INSTALL,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> None:
    replaced: list[tuple[dict, str, str | None]] = []
    backup = None
    try:
        old = {s: service_container(docker, project, s) for s in SERVICES}
        refs = {s: f"{split_ref(c['Config']['Image'])[0]}:{target}" for s, c in old.items()}
        pull(docker, job, list(refs.values()))

        job.set(step="restart")
        for service in SERVICES:
            container = old[service]
            name = container["Name"].lstrip("/")
            body, more_networks = container_body(docker, container, refs[service])
            job.note(f"Restarting {service} on v{target}")
            docker.rename(container["Id"], f"{name}-before-update")
            replaced.append((container, name, None))
            docker.stop(container["Id"])
            if service == "api":
                backup = backup_database(install, current)
                job.note(f"Database copied to data/backups/{backup}")
            new = docker.create(name, body)
            replaced[-1] = (container, name, new)
            for network, endpoint in more_networks:
                docker.connect(network, new, endpoint)
            docker.start(new)
            wait_healthy(docker, new, sleep, clock)
    except Exception as exc:
        job.note(f"Update failed: {exc}")
        if replaced:
            roll_back(docker, job, replaced, backup, install)
        job.set(state="failed", error=str(exc))
        return

    # The new version runs; nothing below may undo it, so a failure here is only noted.
    tidy_up(docker, job, old, refs, target, current, install)
    job.note(f"Updated to v{target}")
    job.set(state="done", step="done")


def tidy_up(
    docker: Docker,
    job: Job,
    old: dict[str, dict],
    refs: dict[str, str],
    target: str,
    current: str,
    install: Path,
) -> None:
    for container in old.values():
        try:
            docker.remove(container["Id"])
        except DockerError as exc:
            job.note(f"Kept the old {container['Name'].lstrip('/')}: {exc}")
    try:
        pin_compose(old["api"], target, install)
    except OSError as exc:
        job.note(f"Could not write the new version into the compose file: {exc}")
    old_tags = {split_ref(c["Config"]["Image"])[1] for c in old.values()}
    repos = [split_ref(ref)[0] for ref in refs.values()]
    try:
        remove_old_images(docker, job, repos, {target, current, *old_tags})
    except DockerError as exc:
        job.note(f"Could not list old images: {exc}")


def roll_back(
    docker: Docker,
    job: Job,
    replaced: list[tuple[dict, str, str | None]],
    backup: str | None,
    install: Path,
) -> None:
    job.note("Rolling back to the previous version")
    try:
        for container, name, new in reversed(replaced):
            if new:
                docker.remove(new)
            docker.rename(container["Id"], name)
        # The new api may have migrated the database before it failed.
        restore_database(backup, install)
        for container, _, _ in replaced:
            docker.start(container["Id"])
        job.note("The previous version runs again")
    except Exception as exc:
        job.note(f"Rollback failed: {exc}")


def read_token(install: Path) -> str:
    try:
        return (install / "data" / "updater-token").read_text().strip()
    except OSError:
        return ""


def make_handler(docker: Docker, job: Job, project: str, install: Path):
    class Handler(BaseHTTPRequestHandler):
        def _answer(self, status: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _authorized(self) -> bool:
            token = read_token(install)
            sent = self.headers.get("Authorization", "")
            return bool(token) and secrets.compare_digest(sent.encode(), f"Bearer {token}".encode())

        def do_GET(self) -> None:
            if self.path != "/status":
                return self._answer(404, {"error": "not found"})
            if not self._authorized():
                return self._answer(401, {"error": "unauthorized"})
            self._answer(200, job.snapshot())

        def do_POST(self) -> None:
            if self.path != "/update":
                return self._answer(404, {"error": "not found"})
            if not self._authorized():
                return self._answer(401, {"error": "unauthorized"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(min(length, 4096)) or b"{}")
                target, current = str(body["version"]), str(body["current"])
            except (ValueError, KeyError, TypeError):
                return self._answer(400, {"error": "bad request"})
            if not (VERSION.match(target) and VERSION.match(current)):
                return self._answer(400, {"error": "bad request"})
            if not job.begin(target):
                return self._answer(409, {"error": "an update is already running"})
            threading.Thread(
                target=run_update,
                args=(docker, job, project, target, current, install),
                daemon=True,
            ).start()
            self._answer(202, job.snapshot())

        def log_message(self, format: str, *args) -> None:
            pass

    return Handler


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    docker = Docker()
    me = docker.container(socket.gethostname())
    project = me["Config"]["Labels"]["com.docker.compose.project"]
    server = ThreadingHTTPServer(("0.0.0.0", 8080), make_handler(docker, Job(), project, INSTALL))
    log.info("updater for compose project %s listening on 8080", project)
    server.serve_forever()


if __name__ == "__main__":
    main()
