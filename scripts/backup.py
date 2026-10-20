"""Dump the database of the running stack to data/backups/app-<timestamp>.dump, keep the newest few.
Stdlib only, runs on the host through `docker compose exec`; safe while the stack is up."""

import subprocess
import sys
from datetime import datetime
from pathlib import Path

BACKUPS = Path("data/backups")
KEEP = 20
# The image's superuser through the socket inside the container: it alone reads past row-level
# security. Restore with pg_restore, as the guide's Data and upgrades page shows.
DUMP = ["docker", "compose", "exec", "-T", "db", "pg_dump", "-U", "postgres", "-d", "tiko", "-Fc"]


def main() -> int:
    running = subprocess.run(
        ["docker", "compose", "ps", "--status", "running", "-q", "db"],
        capture_output=True,
        text=True,
    )
    if running.returncode != 0 or not running.stdout.strip():
        print("backup: the db service is not running, nothing to back up")
        return 0
    BACKUPS.mkdir(parents=True, exist_ok=True)
    target = BACKUPS / f"app-{datetime.now():%Y%m%d-%H%M%S}.dump"
    partial = target.with_suffix(".partial")
    with partial.open("wb") as out:
        done = subprocess.run(DUMP, stdout=out)
    if done.returncode != 0:
        partial.unlink(missing_ok=True)
        print("backup: pg_dump failed", file=sys.stderr)
        return 1
    partial.replace(target)
    for old in sorted(BACKUPS.glob("app-*.dump"))[:-KEEP]:
        old.unlink()
    print(f"backup: {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
