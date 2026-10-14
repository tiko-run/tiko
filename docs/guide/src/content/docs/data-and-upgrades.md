---
title: Data, backups and upgrades
description: Where tiko keeps its data, how to back it up and how to upgrade.
---

All data is one SQLite file in `./data`, which survives rebuilds and upgrades. A commit is not flushed to disk on its own, so a power cut or a crash of the host may lose the last changes, of boards, settings or accounts alike; a crash of tiko loses nothing, and the file stays intact either way.

## Back up and restore

- **Back up:** copy `data/app.db` while the stack is stopped. From a source checkout, `make backup` copies it to `data/backups/` with a timestamp and keeps the newest 20; `make up` runs it before every rebuild.
- **Restore:** stop the stack and copy a backup over `data/app.db`.
- **Before an upgrade that rewrites boards**, tiko copies the database itself to `data/backups/before-v<number>-<time>.db`, where the number is the version of the data format it moves to. It makes the copy once, on the first start of the new version, and never deletes it: remove it when you are sure of the upgrade. To go back, restore it and start the previous version.

## Upgrade

From images:

```bash
docker compose -f compose.release.yml pull
docker compose -f compose.release.yml up -d
```

Pin a version with `TAG`, for example `TAG=2026.10.6`. Release notes are on [GitHub Releases](https://github.com/tiko-run/tiko/releases).

From source:

```bash
git pull
docker compose up --build -d
```
