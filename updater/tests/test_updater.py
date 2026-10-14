import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError

import pytest

import updater
from updater import Job, container_body, run_update, split_ref

REPO = "ghcr.io/tiko-run/tiko"
COMPOSE = """services:
  api:
    image: ghcr.io/tiko-run/tiko-api:${TAG:-2026.10.6}
  web:
    image: ghcr.io/tiko-run/tiko-web:${TAG:-2026.10.6}
"""


def old_container(service: str, version: str = "2026.10.6") -> dict:
    return {
        "Id": f"{service}0123456789abcdef",
        "Name": f"/tiko-{service}-1",
        "Image": f"sha-{service}-{version}",
        "Config": {
            "Image": f"{REPO}-{service}:{version}",
            "Hostname": f"{service}0123456789abcdef"[:12],
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
                "tiko_default": {
                    "Aliases": ["tiko-api-1", service, f"{service}0123456789abcdef"[:12]]
                }
            }
        },
        "State": {"Running": True, "Status": "running"},
    }


class FakeDocker:
    def __init__(self, healthy: bool = True, pull_error: str | None = None) -> None:
        self.calls: list[tuple] = []
        self.healthy = healthy
        self.pull_error = pull_error
        self.olds = {s: old_container(s) for s in updater.SERVICES}
        self.created: dict[str, dict] = {}
        self.image_list = [
            {"Id": "sha-api-2026.10.5", "RepoTags": [f"{REPO}-api:2026.10.5"]},
            {"Id": "sha-api-2026.10.6", "RepoTags": [f"{REPO}-api:2026.10.6"]},
            {"Id": "sha-api-2026.11.1", "RepoTags": [f"{REPO}-api:2026.11.1"]},
        ]

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
        return [i for i in self.image_list if i["RepoTags"][0].startswith(repo)]

    def pull(self, repo, tag):
        self.calls.append(("pull", f"{repo}:{tag}"))
        if self.pull_error:
            yield {"error": self.pull_error}
            return
        yield {"status": "Downloading", "id": "l1", "progressDetail": {"current": 5, "total": 10}}
        yield {"status": "Download complete", "id": "l1"}

    def create(self, name, body):
        new = f"new-{name}"
        self.created[new] = body
        self.calls.append(("create", name))
        return new

    def connect(self, network, container, endpoint):
        self.calls.append(("connect", network, container))

    def rename(self, container, name):
        self.calls.append(("rename", container, name))

    def start(self, container):
        self.calls.append(("start", container))

    def stop(self, container):
        self.calls.append(("stop", container))

    def remove(self, container):
        self.calls.append(("remove", container))

    def remove_image(self, image):
        self.calls.append(("remove_image", image))


@pytest.fixture
def install(tmp_path: Path) -> Path:
    (tmp_path / "data" / "backups").mkdir(parents=True)
    (tmp_path / "data" / "app.db").write_text("migrated")
    (tmp_path / "data" / "app.db-wal").write_text("wal")
    (tmp_path / "data" / "backups" / "pre-update-2026.10.6.db").write_text("before")
    (tmp_path / "compose.yaml").write_text(COMPOSE)
    return tmp_path


class Clock:
    now = 0.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


def update(docker: FakeDocker, install: Path) -> Job:
    job = Job()
    assert job.begin("2026.11.1")
    clock = Clock()
    run_update(
        docker,
        job,
        "tiko",
        "2026.11.1",
        "2026.10.6",
        "pre-update-2026.10.6.db",
        install,
        clock.sleep,
        clock,
    )
    return job


def test_split_ref():
    assert split_ref("ghcr.io/o/r:1.2") == ("ghcr.io/o/r", "1.2")
    assert split_ref("ghcr.io/o/r") == ("ghcr.io/o/r", "latest")
    assert split_ref("localhost:5000/r") == ("localhost:5000/r", "latest")
    assert split_ref("localhost:5000/r:2") == ("localhost:5000/r", "2")


def test_new_container_keeps_own_settings_and_takes_the_image_defaults():
    docker = FakeDocker()
    body, more = container_body(docker, docker.olds["api"], f"{REPO}-api:2026.11.1")
    assert body["Image"] == f"{REPO}-api:2026.11.1"
    assert "Hostname" not in body
    assert "Cmd" not in body
    assert body["Env"] == ["TIKO_WORKERS=1", "TIKO_PASSWORD=secret"]
    assert "org.opencontainers.image.version" not in body["Labels"]
    assert "com.docker.compose.image" not in body["Labels"]
    assert body["Labels"]["com.docker.compose.service"] == "api"
    assert body["HostConfig"] == {"Binds": ["/home/ann/tiko/data:/app/data"]}
    aliases = body["NetworkingConfig"]["EndpointsConfig"]["tiko_default"]["Aliases"]
    assert aliases == ["tiko-api-1", "api"]
    assert more == []


def test_update_replaces_api_then_web_and_cleans_up(install: Path):
    docker = FakeDocker()
    job = update(docker, install)
    status = job.snapshot()
    assert (status["state"], status["error"]) == ("done", None)
    assert (status["downloaded"], status["total"]) == (20, 20)
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
    assert "${TAG:-2026.11.1}" in (install / "compose.yaml").read_text()
    assert "2026.10.6" not in (install / "compose.yaml").read_text()
    removed = [c[1] for c in docker.calls if c[0] == "remove_image"]
    assert removed == ["sha-api-2026.10.5"]
    assert (install / "data" / "app.db").read_text() == "migrated"


def test_unhealthy_api_rolls_back_with_the_backup(install: Path):
    docker = FakeDocker(healthy=False)
    job = update(docker, install)
    status = job.snapshot()
    assert status["state"] == "failed"
    assert "health check failed" in status["error"]
    assert ("remove", "new-tiko-api-1") in docker.calls
    assert ("rename", "api0123456789abcdef", "tiko-api-1") in docker.calls
    assert docker.calls[-1] == ("start", "api0123456789abcdef")
    assert (install / "data" / "app.db").read_text() == "before"
    assert not (install / "data" / "app.db-wal").exists()
    assert "2026.10.6" in (install / "compose.yaml").read_text()
    assert "The previous version runs again" in status["log"]


def test_failed_download_touches_nothing(install: Path):
    docker = FakeDocker(pull_error="no space left on device")
    status = update(docker, install).snapshot()
    assert status["state"] == "failed"
    assert "no space left on device" in status["error"]
    assert [c for c in docker.calls if c[0] != "pull"] == []
    assert (install / "data" / "app.db").read_text() == "migrated"


def test_one_update_at_a_time():
    job = Job()
    assert job.begin("2026.11.1")
    assert not job.begin("2026.11.1")


@pytest.fixture
def server(install: Path, monkeypatch: pytest.MonkeyPatch):
    (install / "data" / "updater-token").write_text("tok\n")
    started = threading.Event()
    monkeypatch.setattr(updater, "run_update", lambda *args: started.set())
    httpd = ThreadingHTTPServer(
        ("127.0.0.1", 0), updater.make_handler(FakeDocker(), Job(), "tiko", install)
    )
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
    body = {"version": "2026.11.1", "current": "2026.10.6", "backup": "pre-update-2026.10.6.db"}
    status, answer = ask(url, "/update", "tok", body)
    assert (status, answer["state"], answer["target"]) == (202, "running", "2026.11.1")
    assert started.wait(2)
    assert ask(url, "/update", "tok", body)[0] == 409


@pytest.mark.parametrize(
    "body",
    [
        {"version": "latest", "current": "2026.10.6"},
        {"version": "2026.11.1", "current": "2026.10.6", "backup": "../app.db"},
        {"version": "2026.11.1"},
    ],
)
def test_server_refuses_odd_requests(server, body):
    url, _ = server
    assert ask(url, "/update", "tok", body)[0] == 400
