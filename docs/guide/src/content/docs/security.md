---
title: Security and privacy
description: Sign-in, people, board sharing, and what tiko stores and talks to.
---

Every page and API route except `/health` and `/ready` asks you to sign in with a username and password. `/metrics` is for admins and for a monitoring system that sends `TIKO_METRICS_TOKEN`; see [Monitoring](../monitoring/).

## Signing in

- The first account is `admin`. Its password is `TIKO_PASSWORD`; when that is empty, tiko generates one on first start, prints it once to the API log (`docker compose logs api | grep 'tiko password'`) and saves it to `data/password`.
- The one-line installer generates the password itself and writes it as `TIKO_PASSWORD` into `.env` in the tiko folder, so the log does not have it. Commands for Windows, Linux and macOS are in [Lost the password](../install/#lost-the-password).
- On Railway and Render the template generates it: see `TIKO_PASSWORD` in the `api` service's Variables on Railway, or the `tiko-api` service's Environment on Render.
- Once the account exists, `TIKO_PASSWORD` and `data/password` are no longer read. Change your name and username in Settings → Profile and your password in Settings → Security.
- A sign-in lasts 30 days in that browser. Changing your password signs out your other devices; "Sign out everywhere" in Settings → Security signs out all of them.
- Passwords are stored as salted scrypt hashes, and sessions as hashes of their tokens.
- After 10 wrong passwords for one username in 15 minutes, sign-in for that username pauses until the window passes.
- On the open internet use HTTPS, which Railway and Render give you.

## People

- An admin invites people in Settings → People: "Invite" gives a link to send in a chat. It works once and expires in 7 days. The person picks a username, a name and a password and is signed in. tiko sends no mail.
- From a person's menu an admin makes them admin or member, disables them (they are signed out at once and cannot sign in) or creates a password reset link that works once within 24 hours.
- Only the hash of a link's token is stored, so a link is shown once. Unused links are listed under "Open links" and can be revoked.
- Whoever deploys tiko can hand it over: invite the business owner "As admin", then make yourself a member or disable your account. Set the tracker in the environment first (`TIKO_TRACKER`, `JIRA_BASE_URL`) so it stays as deployed.
- There is always at least one active admin. If the only admin forgets their password, run `docker compose exec api python -m app.reset_password admin` (or the username) in the tiko folder and open the printed link on your tiko address.

## Sharing boards

- A board belongs to the person who made it. "Share" in the top bar lists who has access; the owner adds people as "Can edit" or "Can view", removes them, makes someone else the owner, or opens the board to "Everyone in tiko".
- Editors change the board and its name. Viewers see it with a "View only" badge: no toolbar, nothing moves or changes, and the server refuses their saves. Only the owner deletes a board or changes who has access.
- A board you cannot open is not in your list, and its link answers as if it did not exist.
- Admins act as owner on every board, so a board is never stranded when its owner is disabled. Boards nobody shared with them are under "All boards" in the board menu.
- Each new person gets their own welcome board once.
- Shared boards are live ([Working together](../working-together/)). The live connection uses the same sign-in as the pages, checks the role on the server for every change, accepts only pages served from tiko's own address, and closes at once when a person is disabled, signs out everywhere or loses access to the board.
- A board is private until its owner turns on a public link ([Public link](../working-together/#public-link)). A link shows that one board view-only, without its people and without task data from a tracker, and opens no other route. An admin can switch public links off in Settings → Sharing.
- Each person connects their own tracker token in Settings → My tracker, and task data is fetched and cached per person: a shared board never shows you a task your own Jira or GitHub access does not allow.

## What tiko stores

- Your boards, settings and account: username, name and password hash.
- Each person's tracker token, encrypted with `TIKO_SECRET_KEY` and kept with the URL it was entered for. It is never sent back to the browser, written to logs or sent to another URL.
- A cached copy of each card's key, summary, status, type, assignee, priority and last update, kept apart for each person.

## What tiko talks to

- The tracker URL you configure.
- The GitHub API for the latest tiko release, unless `UPDATE_CHECK=false`. No data about you or your boards is sent.

With one-click updates on, the `updater` service mounts the Docker socket, which gives it control of Docker on the host. It is off unless the installer turned it on or `COMPOSE_PROFILES=updater` is set, publishes no port, and acts only for the `api` container with the token in `data/updater-token`; only admins can start an update. See [Update from About](../data-and-upgrades/#update-from-about).

There is no telemetry. Fonts and icons ship with the app.

Report vulnerabilities privately as described in [SECURITY.md](https://github.com/tiko-run/tiko/blob/main/SECURITY.md), not in a public issue.
