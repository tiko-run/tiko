---
title: Data, backups and upgrades
description: Where tiko keeps its data, how to back it up and how to upgrade.
---

All data is one SQLite file in `./data`, which survives rebuilds and upgrades.

## Back up and restore

- **Back up:** copy `data/app.db` while the stack is stopped. From a source checkout, `make backup` copies it to `data/backups/` with a timestamp and keeps the newest 20; `make up` runs it before every rebuild.
- **Restore:** stop the stack and copy a backup over `data/app.db`.
- **Before an upgrade that rewrites boards**, tiko copies the database itself to `data/backups/before-v<number>-<time>.db`, where the number is the version of the data format it moves to. It makes the copy once, on the first start of the new version, and never deletes it: remove it when you are sure of the upgrade. To go back, restore it and start the previous version.

## Know when to upgrade

tiko asks GitHub for new releases every 30 minutes, unless `UPDATE_CHECK=false`. A dot on the About button in the bottom left means a newer release is out; **Check now** in About asks at once. About lists every release you missed and marks how much each matters:

- **Security**: fixes a security issue. The dot turns red, and admins see a banner until they upgrade; closed, it comes back the next day.
- **Breaking changes**: read the notes before you upgrade; something works differently.
- **Hotfix**: fixes a bug of the release before.

Releases without a mark bring new features and fixes. When you are several releases behind, About shows the most important mark among them.

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
