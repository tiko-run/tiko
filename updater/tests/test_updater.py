import json
import sqlite3
import threading
import urllib.request
from contextlib import closing
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError

import pytest

import updater
from updater import DockerError, Job, container_body, pull, run_update, split_ref, wait_healthy

REPO = "ghcr.io/tiko-run/tiko"
COMPOSE = """services:
  api:
    image: ghcr.io/tiko-run/tiko-api:${TAG:-2026.10.6}
  web:
    image: ghcr.io/tiko-run/tiko-web:${TAG:-2026.10.6}
"""


def short_id(service: str) -> str:
    return f"{service}0123456789abcdef"[:12]


def old_container(service: str, version: str = "2026.10.6") -> dict:
    return {
        "Id": f"{service}0123456789abcdef",
        "Name": f"/tiko-{service}-1",
        "Image": f"sha-{service}-{version}",
        "Config": {
            "Image": f"{REPO}-{service}:{version}",
            "Hostname": short_id(service),
            "Env": ["TIKO_WORKERS=1", "PATH=/usr/bin", "TIKO_PASSWORD=secret"],
            "Cmd": ["serve"],
            "Labels": {
                "com.docker.compose.project": "tiko",
                "com.docker.compose.service": service,
                "com.docker.compose.image": "sha256:old",
                "com.docker.compose.project.working_dir": "/home/ann/tiko",
                "com.docker.compose.project.config_files": "/home/ann/tiko/compose.yaml",
                "org.opencontainers.image.version": version,
            },
        },
        "HostConfig": {"Binds": ["/home/ann/tiko/data:/app/data"]},
        "NetworkSettings": {
            "Networks": {
                "tiko_default": {"Aliases": [f"tiko-{service}-1", service, short_id(service)]}
            }
        },
        "State": {"Running": True, "Status": "running"},
    }


def rows(db: Path) -> list[str]:
    with closing(sqlite3.connect(db)) as conn:
        return [r[0] for r in conn.execute("SELECT note FROM notes ORDER BY note")]


def add_row(db: Path, note: str) -> None:
    with closing(sqlite3.connect(db)) as conn, conn:
        conn.execute("INSERT INTO notes VALUES (?)", (note,))


class FakeDocker:
    """Docker as the updater sees it; starting the new api adds a row, as a migration would."""

    def __init__(self, install: Path, healthy: bool = True, pull_error: str | None = None):
        self.install = install
        self.calls: list[tuple] = []
        self.healthy = healthy
        self.pull_error = pull_error
        self.olds = {s: old_container(s) for s in updater.SERVICES}
        self.image_list = [
            {"Id": f"sha-{s}-{v}", "RepoTags": [f"{REPO}-{s}:{v}"]}
            for s in updater.SERVICES
            for v in ("2026.10.4", "2026.10.5", "2026.10.6", "2026.11.1")
        ]
        self.image_list.append({"Id": "sha-api-latest", "RepoTags": [f"{REPO}-api:latest"]})
        self.fail_image_listing = False

    def containers(self, labels):
        service = labels[1].split("=")[1]
        return [{"Id": self.olds[service]["Id"]}]

    def container(self, ref):
        for c in self.olds.values():
            if c["Id"] == ref:
                return c
        health = "healthy" if self.healthy else "unhealthy"
        return {"State": {"Running": True, "Health": {"Status": health}}}

    def image(self, ref):
        return {
            "Config": {
                "Env": ["PATH=/usr/bin"],
                "Cmd": ["serve"],
                "Labels": {"org.opencontainers.image.version": "2026.10.6"},
            }
        }

    def images(self, repo):
        if self.fail_image_listing:
            raise DockerError("images: 500")
        return [i for i in self.image_list if i["RepoTags"][0].startswith(f"{repo}:")]

    def pull(self, repo, tag):
        self.calls.append(("pull", f"{repo}:{tag}"))
        if self.pull_error:
            yield {"error": self.pull_error}
            return
        yield {"status": "Downloading", "id": "l1", "progressDetail": {"current": 5, "total": 10}}
        yield {"status": "Download complete", "id": "l1"}

    def create(self, name, body):
        self.calls.append(("create", name))
        return f"new-{name}"

    def connect(self, network, container, endpoint):
        self.calls.append(("connect", network, container))

    def rename(self, container, name):
        self.calls.append(("rename", container, name))

    def start(self, container):
        self.calls.append(("start", container))
        if container == "new-tiko-api-1":
            add_row(self.install / "data" / "app.db", "written by the new version")

    def stop(self, container):
        self.calls.append(("stop", container))

    def remove(self, container):
        self.calls.append(("remove", container))

    def remove_image(self, image):
        self.calls.append(("remove_image", image))


@pytest.fixture
def install(tmp_path: Path) -> Path:
    (tmp_path / "data").mkdir()
    with closing(sqlite3.connect(tmp_path / "data" / "app.db")) as conn, conn:
        conn.execute("CREATE TABLE notes (note TEXT)")
        conn.execute("INSERT INTO notes VALUES ('saved before the update')")
    (tmp_path / "compose.yaml").write_text(COMPOSE)
    return tmp_path


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


def update(docker: FakeDocker, install: Path) -> Job:
    job = Job()
    assert job.begin("2026.11.1")
    clock = Clock()
    run_update(docker, job, "tiko", "2026.11.1", "2026.10.6", install, clock.sleep, clock)
    return job


def test_split_ref():
    assert split_ref("ghcr.io/o/r:1.2") == ("ghcr.io/o/r", "1.2")
    assert split_ref("ghcr.io/o/r") == ("ghcr.io/o/r", "latest")
    assert split_ref("localhost:5000/r") == ("localhost:5000/r", "latest")
    assert split_ref("localhost:5000/r:2") == ("localhost:5000/r", "2")


@pytest.mark.parametrize("service", updater.SERVICES)
def test_new_container_keeps_own_settings_and_takes_the_image_defaults(install, service):
    docker = FakeDocker(install)
    body, more = container_body(docker, docker.olds[service], f"{REPO}-{service}:2026.11.1")
    assert body["Image"] == f"{REPO}-{service}:2026.11.1"
    assert "Hostname" not in body
    assert "Cmd" not in body
    assert body["Env"] == ["TIKO_WORKERS=1", "TIKO_PASSWORD=secret"]
    assert "org.opencontainers.image.version" not in body["Labels"]
    assert "com.docker.compose.image" not in body["Labels"]
    assert body["Labels"]["com.docker.compose.service"] == service
    assert body["HostConfig"] == {"Binds": ["/home/ann/tiko/data:/app/data"]}
    aliases = body["NetworkingConfig"]["EndpointsConfig"]["tiko_default"]["Aliases"]
    assert aliases == [f"tiko-{service}-1", service]
    assert more == []


def test_update_replaces_api_then_web_and_cleans_up(install: Path):
    docker = FakeDocker(install)
    status = update(docker, install).snapshot()
    assert (status["state"], status["error"]) == ("done", None)
    assert status["downloaded"] == status["total"] > 0
    steps = [c for c in docker.calls if c[0] in ("create", "start", "stop")]
    assert steps == [
        ("stop", "api0123456789abcdef"),
        ("create", "tiko-api-1"),
        ("start", "new-tiko-api-1"),
        ("stop", "web0123456789abcdef"),
        ("create", "tiko-web-1"),
        ("start", "new-tiko-web-1"),
    ]
    assert ("remove", "api0123456789abcdef") in docker.calls
    assert ("remove", "web0123456789abcdef") in docker.calls
    assert "${TAG:-2026.11.1}" in (install / "compose.yaml").read_text()
    assert "2026.10.6" not in (install / "compose.yaml").read_text()
    removed = sorted(c[1] for c in docker.calls if c[0] == "remove_image")
    assert removed == [
        "sha-api-2026.10.4",
        "sha-api-2026.10.5",
        "sha-api-latest",
        "sha-web-2026.10.4",
        "sha-web-2026.10.5",
    ]
    backup = install / "data" / "backups" / "pre-update-2026.10.6.db"
    assert rows(backup) == ["saved before the update"]
    assert rows(install / "data" / "app.db") == [
        "saved before the update",
        "written by the new version",
    ]


def test_backup_holds_edits_made_until_the_old_api_stops(install: Path):
    docker = FakeDocker(install)
    stop = docker.stop

    def stop_after_a_last_edit(container):
        add_row(install / "data" / "app.db", "edited while downloading")
        stop(container)

    docker.stop = stop_after_a_last_edit
    update(docker, install)
    backup = install / "data" / "backups" / "pre-update-2026.10.6.db"
    assert "edited while downloading" in rows(backup)


def test_unhealthy_api_rolls_back_with_the_backup(install: Path):
    docker = FakeDocker(install, healthy=False)
    status = update(docker, install).snapshot()
    assert status["state"] == "failed"
    assert "health check failed" in status["error"]
    assert ("remove", "new-tiko-api-1") in docker.calls
    assert ("rename", "api0123456789abcdef", "tiko-api-1") in docker.calls
    assert docker.calls[-1] == ("start", "api0123456789abcdef")
    assert rows(install / "data" / "app.db") == ["saved before the update"]
    assert not (install / "data" / "app.db-wal").exists()
    assert "2026.10.6" in (install / "compose.yaml").read_text()
    assert "The previous version runs again" in status["log"]


def test_failed_download_touches_nothing(install: Path):
    docker = FakeDocker(install, pull_error="no space left on device")
    status = update(docker, install).snapshot()
    assert status["state"] == "failed"
    assert "no space left on device" in status["error"]
    assert [c for c in docker.calls if c[0] != "pull"] == []
    assert not (install / "data" / "backups").exists()


def test_tidying_up_never_undoes_a_good_update(install: Path):
    docker = FakeDocker(install)
    docker.fail_image_listing = True
    status = update(docker, install).snapshot()
    assert status["state"] == "done"
    assert "Could not list old images: images: 500" in status["log"]
    assert ("rename", "api0123456789abcdef", "tiko-api-1") not in docker.calls


def test_backups_keep_the_newest_three(install: Path):
    for version in ["2026.10.1", "2026.10.2", "2026.10.3", "2026.10.4"]:
        updater.backup_database(install, version)
    names = sorted(p.name for p in (install / "data" / "backups").iterdir())
    assert names == [
        "pre-update-2026.10.2.db",
        "pre-update-2026.10.3.db",
        "pre-update-2026.10.4.db",
    ]


def test_a_container_in_a_restart_loop_must_run_again_in_full():
    # Up for 3 s, down once, then up: it counts from the restart, so it is up 5 s later.
    states = [True] * 3 + [False] + [True] * 10
    polls = iter(states)

    class Looping:
        def container(self, ref):
            running = next(polls)
            return {"State": {"Running": running, "Status": "running" if running else "restarting"}}

    clock = Clock()
    wait_healthy(Looping(), "web", clock.sleep, clock)
    assert clock.now == 4 + updater.SETTLE_S


def test_one_update_at_a_time():
    job = Job()
    assert job.begin("2026.11.1")
    assert not job.begin("2026.11.1")


@pytest.fixture
def server(install: Path, monkeypatch: pytest.MonkeyPatch):
    (install / "data" / "updater-token").write_text("tok\n")
    started = threading.Event()
    monkeypatch.setattr(updater, "run_update", lambda *args: started.set())
    handler = updater.make_handler(FakeDocker(install), Job(), "tiko", install)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}", started
    httpd.shutdown()


def ask(url: str, path: str, token: str | None, body: dict | None = None) -> tuple[int, dict]:
    request = urllib.request.Request(
        url + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}"} if token else {},
        method="GET" if body is None else "POST",
    )
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read())
    except HTTPError as exc:
        return exc.code, json.loads(exc.read())


def test_server_needs_the_token(server):
    url, _ = server
    assert ask(url, "/status", None)[0] == 401
    assert ask(url, "/status", "wrong")[0] == 401
    assert ask(url, "/status", "tok") == (200, {"state": "idle", "log": []})


def test_server_starts_one_update(server):
    url, started = server
    body = {"version": "2026.11.1", "current": "2026.10.6"}
    status, answer = ask(url, "/update", "tok", body)
    assert (status, answer["state"], answer["target"]) == (202, "running", "2026.11.1")
    assert started.wait(2)
    assert ask(url, "/update", "tok", body)[0] == 409


@pytest.mark.parametrize(
    "body", [{"version": "latest", "current": "2026.10.6"}, {"version": "2026.11.1"}]
)
def test_server_refuses_odd_requests(server, body):
    url, _ = server
    assert ask(url, "/update", "tok", body)[0] == 400


class LayeredPull:
    """Docker's real order: every layer announced first, a size only once its download starts."""

    def pull(self, repo, tag):
        yield {"status": "Pulling from " + repo, "id": tag}
        for layer in ("small", "big", "cached"):
            yield {"status": "Pulling fs layer", "id": layer, "progressDetail": {}}
        yield {"status": "Already exists", "id": "cached"}
        yield {"status": "Downloading", "id": "small", "progressDetail": {"current": 1, "total": 2}}
        yield {"status": "Download complete", "id": "small"}
        for current in (10, 900):
            detail = {"current": current, "total": 900}
            yield {"status": "Downloading", "id": "big", "progressDetail": detail}
        yield {"status": "Pull complete", "id": "big"}


def test_progress_never_goes_back_across_layers_and_images():
    job = Job()
    job.begin("2026.10.7")
    seen = []
    record = job.set
    job.set = lambda **kw: (record(**kw), seen.append(kw["downloaded"] / kw["total"]))
    refs = ["ghcr.io/tiko-run/tiko-api:2026.10.7", "ghcr.io/tiko-run/tiko-web:2026.10.7"]
    pull(LayeredPull(), job, refs)
    assert seen == sorted(seen)
    assert seen[0] == 0 and 0 < seen[len(seen) // 4] < 0.5 and seen[-1] == 1
