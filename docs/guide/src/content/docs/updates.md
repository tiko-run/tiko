---
title: Updates
description: How tiko tells you about a new release, how one-click updates work, and what the updater service can and cannot do.
---

tiko checks for new releases on its own. With one-click updates on, an admin installs a release from the About button, and a small service next to tiko swaps the containers.

## Learn about a release

tiko asks GitHub for new releases every 30 minutes, unless `UPDATE_CHECK=false`. A dot on the About button in the bottom left means a newer release is out, and **Check now** in About asks right away. About lists every release you missed and marks how much each one matters:

- **Security**: fixes a security issue. The dot turns red, and admins see a banner until they update. If you close it, it comes back the next day.
- **Breaking changes**: something works differently, so read the notes before you update.
- **Hotfix**: fixes a bug in the release before it.

Releases without a mark bring new features and fixes. If you are several releases behind, About shows the most important mark among them.

The check sends GitHub no data about you or your boards.

## Update with one click

An admin opens About and clicks **Update now**. tiko then:

1. Downloads the new release and shows the progress in About.
2. Stops the `api` container and dumps the database to `data/backups/pre-update-<version>.dump`, so the dump holds every change made up to that moment. It keeps the 3 newest of these dumps and leaves other backups alone.
3. Starts `api` on the new release, then restarts the `web` container the same way. Once the new version serves the page, About shows a **Reload** button. Other people get a notice with a **Reload** button, so nobody loses a change they have not saved yet.

People who are not admins see "Ask an admin to update". A release marked **Breaking changes** asks you to read its notes first.

### When something goes wrong

With your own Postgres server in `DATABASE_URL` there is no `db` container to dump, so the update does not start: back the database up yourself and run the installer. See [Your own Postgres server](../data-and-upgrades/#your-own-postgres-server).

If a new container does not start within 2 minutes, tiko goes back on its own. It starts the previous containers again and restores the database from the dump. About then says that the update failed and shows its log.

If the disk is too full for the dump, the update does not start, and About tells you how much space it needs. If the disk fills up during the download, the download fails before any container is touched, and the running version stays as it was.

After a good update tiko removes images older than the previous release. The disk then holds two releases: the one running and the one before it.

The first `docker compose up -d` you run by hand after a one-click update recreates `api` and `web` once more, so tiko is down for about 10 seconds. Compose recognizes its containers by a hash of the whole service config, and the updater cannot compute that hash for the new version. Data is not affected, and the next `up` leaves the containers alone. Restarts of the host or of Docker do not trigger it.

### When a release needs the installer

Some releases change more than the `api` and `web` containers, for example by adding a container next to them. **Update now** cannot install those, so their notes carry the line `Requires: installer`. When any release you missed has it, About shows the installer command instead of the button, and nothing is stopped. About does the same when tiko is more than 100 releases behind, because it cannot see the marks that far back. Run it again on the server, with `--dir` (`-Dir` on Windows) if tiko lives in another folder:

```bash
curl -fsSL https://tiko.run/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://tiko.run/install.ps1 | iex
```

The installer keeps your `.env`, your answers and your data, and updates to the latest release. After that, **Update now** works again for the releases that follow.

## What the updater is

A container cannot replace itself, so something outside the tiko containers has to stop them and start the new ones. That is the `updater`: a small service that runs next to tiko. It is one Python file with no dependencies, [`updater/updater.py`](https://github.com/tiko-run/tiko/blob/main/updater/updater.py), published as the image `ghcr.io/tiko-run/tiko-updater` with every release. Nextcloud All-in-One and Coolify update themselves the same way.

To start and stop containers it talks to Docker through the Docker socket, `/var/run/docker.sock`. Access to that socket gives full control of Docker on the host, which is about the same as root. That is why the updater is a separate service, it is optional, and the `api` container, the part that faces the network, never gets the socket.

What the updater does:

- downloads the `tiko-api` and `tiko-web` images of the new release from `ghcr.io`;
- replaces the `api` and `web` containers of your tiko with the same settings, ports and volumes;
- writes the new version into your `compose.yaml`, so a later `docker compose up` stays on it;
- copies the database aside once the old `api` has stopped, and back if the new version fails;
- removes old tiko images.

What it does not do:

- it never updates on its own or on a schedule. It acts only when an admin clicks **Update now**;
- it publishes no port and cannot be reached from outside the tiko network. It answers only requests that carry the token in `data/updater-token`, which the `api` container creates on its first start;
- it touches no other containers on the host. It finds `api` and `web` by the labels Docker Compose puts on your tiko;
- it reads no boards and sends nothing anywhere. Its only traffic out is the image download from `ghcr.io`;
- it does not update itself. Running the installer again updates the updater.

## Turn it on or off

The one-line installers ask "Turn on one-click updates?", yes by default, and store the answer in `.env`. On later runs they do not ask again. To install without it, use `--no-updater` (`-NoUpdater` on Windows) or `TIKO_UPDATER=no`. Running the installer again with `TIKO_UPDATER=yes` or `TIKO_UPDATER=no` changes the stored answer.

To turn it off later, set this in `.env` in the tiko folder:

```bash
COMPOSE_PROFILES=
```

Then run `docker compose up -d --remove-orphans`. To turn it on, set `COMPOSE_PROFILES=updater` and run `docker compose up -d`. Without the updater, About tells you to run the installer again, and the steps in [Upgrade by hand](../data-and-upgrades/#upgrade-by-hand) still work.

With rootless Docker the updater cannot reach Docker, so the installer leaves it off.

On Railway and Render the platform runs the containers, so there is no updater, and About says to redeploy the service instead. A build from source updates with `git pull`.
