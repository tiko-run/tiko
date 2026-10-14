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

## Update from About

With one-click updates on, an admin clicks **Update now** in About. tiko then:

1. copies the database to `data/backups/pre-update-<version>.db`, keeping the 3 newest such copies; other backups stay;
2. downloads the new release, with the progress in the bottom left;
3. restarts the `api` and then the `web` container on it and reloads the page. Other people get a "Reload" notice.

If the new version does not start within 2 minutes, tiko starts the previous one again, puts the database copy back and shows the log in About. After a good update it removes images older than the previous release, so the disk holds two releases. A release marked **Breaking changes** asks to read its notes first. People who are not admins see "Ask an admin to update".

The one-line installers ask whether to turn it on, yes by default. They add `COMPOSE_PROFILES=updater` to `.env`, which starts a small `updater` service next to tiko. It is the only part of tiko with access to Docker, has no port outside the tiko network and answers only the `api` container, which holds a token from `data/updater-token`. It updates `api` and `web`; the updater itself is updated by running the installer again. To turn it off, set `COMPOSE_PROFILES=` in `.env` and run `docker compose up -d --remove-orphans`.

On Railway and Render, About says to redeploy the service instead.

## Upgrade by hand

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
