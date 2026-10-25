---
title: Quick start
description: Run tiko with one command, from source or in the cloud, and take a first look.
---

## One command

On Linux or macOS:

```bash
curl -fsSL https://tiko.run/install.sh | sh
```

It installs Docker if needed, starts tiko and prints the address and the password. Never used Docker, or on Windows? See [Install](../install/) for every step.

## From source

```bash
git clone https://github.com/tiko-run/tiko.git
cd tiko
docker compose up --build
```

## On Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/tiko?referralCode=wFuy8y&utm_medium=integration&utm_source=button&utm_campaign=tiko)

The template runs the released images: `api` keeps your boards on a volume, `web` is the only public service, and the key that encrypts tracker tokens and the password are generated on deploy. A tracker that is reachable only from a corporate network is out of reach from Railway.

To sign in after the deploy:

1. In the Railway project open the `web` service and click its public address.
2. Open the `api` service, then the Variables tab, and reveal `TIKO_PASSWORD`.
3. Sign in with the username `admin` and that password, then pick a password of your own on the screen that follows.

## On Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/tiko-run/tiko)

The Blueprint creates a project named `tiko` with a `production` environment and, in it, a Postgres database `tiko-db` for your boards and two services: `tiko-api`, a private service with a 1 GB disk for backups, and `tiko-web`, the public one. The disk needs paid instances, about $20 a month with the database. Updates are manual: Deploy → Deploy latest reference on each service.

Render asks for a Blueprint name: any name will do. Leave "Blueprint Path" empty, the file is found on its own.

To sign in after the deploy:

1. Open the address of `tiko-web` from the Render dashboard.
2. Open the `tiko-api` service, then Environment, and reveal `TIKO_PASSWORD`.
3. Sign in with the username `admin` and that password, then pick a password of your own on the screen that follows.

To upgrade, redeploy `api` and `web`: they pull the latest release.

## First look

Open http://localhost:3000, or the Railway or Render URL, and sign in as `admin`. On your machine the installer printed the password and keeps it in `.env` in the tiko folder. From source it is in the log: `docker compose logs api | grep 'tiko password'`, with `Select-String` in place of `grep` in PowerShell. If you lost it, see [Lost the password](../install/#lost-the-password). On Railway and Render it is the `TIKO_PASSWORD` variable of the API service, as described above. tiko then asks you to pick a password of your own. A fresh install opens on [Home](../home/) with a sample board built from demo tasks; open it. Move things around, then add more with the card tool at the bottom: type `DEMO-5` for one task, or `project = DEMO` for all twelve. Delete the sample board when you are done with it.

The first time you open a board you can edit, other than one you just made with New board, a short tour shows where adding tasks, search, reminders, the Gantt chart and the focus timer live. Close it at any step; About (the ⓘ button in the bottom left) → Take the tour runs it again.

After the tour, Getting started next to About lists eight things to try. Each one ticks itself when you do it, and Show me walks you through it on your board. Hide the list at any time; About → Getting started brings it back.

No keys or accounts are needed for the demo. To see your real tasks, [connect Jira Data Center](../jira-data-center/).
