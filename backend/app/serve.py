"""Starts the API: one process, or TIKO_WORKERS of them on ports 8000, 8001 and so on."""

import argparse
import os
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request

from app.config import get_settings

START_TIMEOUT_S = 120.0


def _command(port: int) -> list[str]:
    return [
        sys.executable,
        "-m",
        "uvicorn",
        "--factory",
        "app.main:create_app",
        "--ws-per-message-deflate",
        "false",
        "--host",
        "0.0.0.0",  # noqa: S104  the container's network is the boundary
        "--port",
        str(port),
    ]


def _healthy(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1):  # noqa: S310
            return True
    except OSError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000, help="port of the first process")
    parser.add_argument("--healthy", action="store_true", help="only check that all answer")
    args = parser.parse_args()
    port = args.port
    count = get_settings().tiko_workers
    if args.healthy:
        # The web container waits for this: a board may belong to the last process to start.
        return 0 if all(_healthy(port + index) for index in range(count)) else 1
    if count == 1:
        os.execv(sys.executable, _command(port))  # noqa: S606

    children: list[subprocess.Popen] = []

    def stop(*_: object) -> None:
        for child in children:
            child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    with tempfile.TemporaryDirectory(prefix="tiko-workers-") as directory:
        for index in range(count):
            env = {**os.environ, "TIKO_WORKER": str(index), "TIKO_WORKERS_DIR": directory}
            children.append(subprocess.Popen(_command(port + index), env=env))  # noqa: S603
            if index == 0:
                # The first one alone migrates the database and makes the first admin.
                deadline = time.monotonic() + START_TIMEOUT_S
                while not _healthy(port) and time.monotonic() < deadline:
                    if children[0].poll() is not None:
                        return children[0].returncode or 1
                    time.sleep(0.2)
        # A board lives in one process only, so they stand and fall together: the container
        # restarts whole.
        while all(child.poll() is None for child in children):
            time.sleep(0.5)
        stop()
        codes = [child.wait() for child in children]
    return next((code for code in codes if code), 0)


if __name__ == "__main__":
    sys.exit(main())
