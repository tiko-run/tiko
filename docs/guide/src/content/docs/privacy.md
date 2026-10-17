---
title: Usage stats and error reports
description: What tiko sends about an install and its errors, why, and how to turn each off.
---

tiko does not track people. It sends a few counts about the install itself, so we know how many instances run, on what, and which trackers to support first. Nothing in them says who you are, what your boards hold or where your tracker is.

The counts are on by default and off with one setting. This page lists every field.

## Why we count

A self-hosted app has no sign-up list, so without a count we cannot tell whether ten teams run tiko or ten thousand. The platforms, processor types and trackers in use decide what we test on and what we build next. How many instances stay on an old release shows whether updating is too hard and how long old data formats must stay readable.

An install that fails reports the name of the step that failed. That way we hear about a broken release before someone has to open an issue.

## What is sent

### When you install

The installer sends one event at the end, or when a step fails.

```json
{
  "kind": "install",
  "schema": 2,
  "version": "2026.10.20",
  "os": "linux",
  "arch": "amd64",
  "installer": "sh",
  "updater": true,
  "fresh": true,
  "failed_step": null
}
```

| Field | Meaning |
|---|---|
| `kind` | `install` |
| `schema` | version of this format |
| `version` | the tiko release being installed |
| `os` | `linux`, `darwin`, `windows` or `other` |
| `arch` | processor type: `amd64`, `arm64` or `other` |
| `installer` | `sh` or `ps1` |
| `updater` | whether one-click updates were turned on |
| `fresh` | `true` when the folder had no tiko install before, `false` for a retry or a reinstall |
| `failed_step` | empty, or the step that failed: `docker-check`, `download`, `pull`, `start`, `health`; never the error text |

### Once a day

A running instance sends one ping 10 minutes after it starts and then once a day. The time of the last ping is kept in the database, so a restart within a day sends nothing extra.

```json
{
  "kind": "ping",
  "schema": 2,
  "instance_id": "0b6f1c7e-3f4a-4c55-9b1e-6d2a8f0e9c41",
  "version": "2026.10.20",
  "deploy": "installer",
  "arch": "arm64",
  "trackers": ["github", "jira_dc"],
  "people": "2-5",
  "boards": "6-20",
  "boards_active": "2-5",
  "os": "linux",
  "updater": true
}
```

| Field | Meaning |
|---|---|
| `kind` | `ping` |
| `schema` | version of this format |
| `instance_id` | a random id made on the first start and kept in the database. It is not built from anything about the host or its people, so it only tells pings of one instance from those of another |
| `version` | the tiko release that runs |
| `deploy` | how it runs: `installer`, `compose`, `railway`, `render`, `source` or `demo` |
| `arch` | processor type: `amd64`, `arm64` or `other` |
| `trackers` | kinds of trackers the cards come from: `demo`, `jira_dc`, `github`. No addresses |
| `people` | active accounts as a range: `1`, `2-5`, `6-20`, `21-100`, `100+` |
| `boards` | boards as a range, the same ranges plus `0` |
| `boards_active` | boards someone changed in the last 7 days, the same ranges. It tells an instance in use from one that only runs; it comes from the time a board last changed, not from sign-ins |
| `os` | the system tiko was installed on: `linux`, `darwin`, `windows` or `other`; empty when tiko runs in a container set up by hand, where the host is unknown |
| `updater` | whether one-click updates are on |

An admin sees the exact next ping in Settings → Privacy → Show what is sent.

## What is never sent

- Names, usernames, emails, passwords or tokens.
- Board names, board contents, task keys or task data.
- Your tiko address, host name, tracker address or any file path.
- Error messages from the installer.

The collector runs on Cloudflare, which sees the IP address of the request as any web host does. Our code reads only the country from it and does not store the address.

## Where it goes

Events go to `https://t.tiko.run/v1/events`, a small Cloudflare Worker whose code is in [`collector/`](https://github.com/tiko-run/tiko/tree/main/collector). It keeps only the fields above and adds the time it got them and the country. The rows sit in a Postgres database in the EU (Frankfurt), and only the tiko maintainers read them. We delete single rows after 13 months and keep monthly totals per field value and country.

A new field means a new `schema`, a line in the changelog and an update of this page. Schema 2 added `boards_active`, `os` and `fresh`. None of them is about a person, and the install event and the ping share no id, so an install cannot be tied to the instance it became.

## Turn it off

Any one of these is enough:

- An admin turns off "Send daily usage counts" in Settings → Privacy.
- `TIKO_USAGE_STATS=false` in `.env` or in the platform's variables. It wins over the setting and locks it.
- The installer's `--no-stats` (`install.sh`) or `-NoStats` (`install.ps1`), or `TIKO_USAGE_STATS=false` in the environment when you run it. The installer then sends nothing and writes `TIKO_USAGE_STATS=false` into `.env`.

Turned off, tiko sends nothing about the install. The release check (`UPDATE_CHECK`) is separate; see [Updates](../updates/).

## Error reports

Error reports are off until an admin turns on "Send error reports" in Settings → Privacy, or `TIKO_ERROR_REPORTS=true` is set. Then an error in the server or in the page sends a report, so we can fix what breaks in a release without waiting for an issue.

A report holds only the error type (such as `KeyError`), the lines of tiko's own code it came through and the tiko version and `deploy`. It never holds:

- the error message, which could contain a task, an address or a name;
- the request, its headers, cookies and body, the page address, or who was signed in;
- local variables, log lines, clicks, or the host name of your server.

The page sends its reports through your tiko server, so Sentry does not see the address of your tiko. While reports are off, the Sentry client sends nothing at all and adds nothing to tiko's calls to your tracker.

Reports go to the tiko project's [Sentry](https://sentry.io) in the EU (Frankfurt). `TIKO_ERROR_REPORTS_DSN` sends them to your own Sentry or a compatible server such as GlitchTip instead. With `TIKO_ERROR_REPORTS=false` the Sentry client does not start at all. Open pages start or stop sending after a reload.

## Closed networks and your own collector

tiko does not need the collector to work. Behind a firewall or without internet the ping fails quietly and nothing else changes; set `TIKO_USAGE_STATS=false` to skip even the attempt.

To count your own instances instead, for a fork or many installs inside one company, run the Worker from [`collector/`](https://github.com/tiko-run/tiko/tree/main/collector) on your own Cloudflare account and database, and point tiko at it with `TIKO_STATS_URL` (the installers read the same variable). Its default is `https://t.tiko.run/v1/events`.
