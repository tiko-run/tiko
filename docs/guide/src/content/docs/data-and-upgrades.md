---
title: Data, backups and upgrades
description: Where tiko keeps its data, how to back it up and how to upgrade.
---

tiko keeps boards, people and settings in Postgres 18. With the compose files it runs in the `db` container, and its data lives in the Docker volume `pgdata`, which survives rebuilds, upgrades and `docker compose down`. **`docker compose down -v` deletes that volume, and every board with it.** The `data/` folder next to the compose file keeps the rest: the generated admin password, the updater's token and backups.

The `db` service publishes no port; only the `api` container reaches it. Its password is `POSTGRES_PASSWORD` in `.env`, written by the installer. Postgres reads it once, when the volume is made, so changing it later locks tiko out of its data.

## Back up and restore

- **Back up** while tiko runs, in the tiko folder. The dump is written inside the `db` container and copied out, so it stays intact in any shell, PowerShell too:

  ```bash
  docker compose exec db pg_dump -U postgres -d tiko -Fc -f /tmp/tiko.dump
  docker compose cp db:/tmp/tiko.dump ./tiko.dump
  docker compose exec db rm /tmp/tiko.dump
  ```

  From a source checkout, `make backup` writes the same dump to `data/backups/` with a timestamp and keeps the newest 20; `make up` runs it before every rebuild.
- **Restore:** stop the API, put the dump back, start it again:

  ```bash
  docker compose stop api web
  docker compose cp ./tiko.dump db:/tmp/tiko.dump
  docker compose exec db psql -U postgres -d tiko -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION tiko_owner;"
  docker compose exec db pg_restore -U postgres -d tiko --exit-on-error /tmp/tiko.dump
  docker compose exec db rm /tmp/tiko.dump
  docker compose up -d
  ```

- **Before every one-click update** the updater dumps the database to `data/backups/pre-update-<version>.dump` and keeps the 3 newest. See [Updates](../updates/).

## Coming from an SQLite release

Releases up to 2026.10.23 kept everything in one SQLite file, `data/app.db`. The first start on Postgres copies that file into the database: every account, board, setting, Planning list and public link, with the same passwords and links. The copy compares the row count of every table before it commits; if anything differs, nothing is kept and the file stays as it was. After a good copy the file is renamed to `data/app.db.copied-<date>` and kept.

Run the installer to make this move: it adds the `db` service and its password. **Update now** cannot add a container, so About shows the installer command for such a release.

### On Railway and Render

The platform runs the containers, so the release that moves to Postgres needs a database added by hand before you redeploy. Without `DATABASE_URL` the new `api` stops at start and says so in its log. The SQLite file on the `api` volume is copied at the first start, as above.

- **Render:** open the Blueprint in the Render dashboard and sync it. The sync adds the `tiko-db` database and gives `tiko-api` its `DATABASE_URL`; then redeploy `tiko-api` and `tiko-web`.
- **Railway:** in the project, add a Postgres database (**Create → Database → PostgreSQL**). In the `api` service's Variables, add `DATABASE_URL` with the value `${{Postgres.DATABASE_URL}}`, then redeploy `api` and `web`.

To go back to an SQLite release, rename `data/app.db.copied-<date>` to `data/app.db` before you start the old version. Without the file the old version starts as a new, empty instance. Changes made on Postgres in the meantime stay in Postgres.

## Your own Postgres server

Set `DATABASE_URL` in `.env` to use a server of your own, such as a managed one, instead of the `db` service. tiko needs Postgres 16 or later, a database of its own and a role that owns it and may create roles. At its first start tiko creates two roles without login, `tiko_app` and `tiko_jobs`, and switches to them for its work, so row-level security keeps workspaces apart. It refuses to start when either of them is a superuser or has `BYPASSRLS`.

As a superuser on that server:

```sql
CREATE ROLE tiko_owner LOGIN CREATEROLE PASSWORD 'choose-a-password';
CREATE DATABASE tiko OWNER tiko_owner;
\c tiko
ALTER SCHEMA public OWNER TO tiko_owner;
```

Then `DATABASE_URL=postgresql://tiko_owner:choose-a-password@db.example.com:5432/tiko`. The password goes into a URL, so use letters and digits. One-click updates need the `db` service to take their dump: with your own server, back it up yourself and update with the installer.

## Updates

How tiko tells you about a new release and how an admin updates it from About: [Updates](../updates/).

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
