---
title: Architecture
description: How tiko is built, the two containers, the code layout and how statuses stay fresh.
---

## Overview

```text
Browser ──> Web UI (React, nginx :3000) ──/api, WebSocket──> API (FastAPI :8000) ──> SQLite (data/app.db)
                                                                   │
                                                                   └──REST──> Task tracker (Jira Data Center today)
```

tiko runs as two containers. nginx serves the built UI and proxies `/api` to the API, so the browser sees one origin. The API keeps everything in one SQLite file under `./data`.

The backend has three layers with one dependency rule, `api → domain ← adapters`: the domain knows nothing about FastAPI or any tracker SDK. Wiring happens in `backend/app/main.py`. The reasons behind each choice are in the [decision log](https://github.com/tiko-run/tiko/blob/main/docs/decisions.md).

## Backend

```text
backend/app/
  api/        routes: auth, boards, live (WebSocket), tasks, jql, settings, people, invites, me, demo, version;
              the sign-in gate and error mapping to HTTP
  domain/     accounts, sessions, invites, members, boards, live (shared document), tasks, refresh and backoff,
              jql, settings, modules, updates; ports.py
  adapters/
    tasks/    jira_dc.py (httpx), demo.py (in-memory seed)
    storage/  sqlite.py, migrations/*.sql (PRAGMA user_version)
    secrets/  fernet.py (token encryption with TIKO_SECRET_KEY)
    live/     rooms.py (open boards and their sockets)
    releases/ github.py (latest release for "update available")
  config.py   ENV, the single entry point
```

Everything external sits behind a port in `domain/ports.py`. `TaskProvider` is the tracker interface: `resolve`, `poll`, `search`, `check`, plus the query vocabulary and values. The other ports are repositories (`BoardRepo`, `MemberRepo`, `UserRepo`, `SessionRepo`, `InviteRepo`, `CredentialRepo`, `SnapshotRepo`, `SettingsRepo`), `SecretBox` for encryption, `LiveBoards` for the open sockets of live boards and `ReleaseFeed` for the update check. The tracker is a runtime setting (`demo` or `jira`), so connecting Jira needs no restart.

The main tables:

| Table | Holds |
|---|---|
| `boards` | One JSON document per board, with a `version` for compare-and-set saves, and the encoded shared document of the live board |
| `board_members` | Who can view or edit each board |
| `users`, `sessions`, `invites` | Accounts, sign-ins and one-time links |
| `user_credentials` | Each person's encrypted tracker token |
| `task_snapshots` | Latest fields per task key, kept apart for each person |
| `settings` | Tracker, its URL and the refresh interval |

`/health`, `/ready` and `/metrics` (Prometheus) are served outside `/api`. What the metrics hold is in [Monitoring](../monitoring/).

## Frontend

```text
frontend/src/
  api/        fetch client, zod schemas
  auth/       sign-in and invite screens
  board/      top bar, board menu, sharing, shortcuts dialog
  canvas/     React Flow canvas, nodes, toolbar, context menu, clipboard, undo history
  live/       shared document and its WebSocket sync
  modules/    board modules, Gantt first
  timers/     card timers
  focus/      focus timer and player
  search/     the command palette
  settings/   settings sheets
  components/ui/  shadcn components
  lib/        theme, shortcuts registry, query helpers
```

## Live boards

An open board is a shared document (a CRDT: Yjs in the browser, pycrdt on the server) synced over a WebSocket at `/api/boards/{id}/live`. The canvas edits that document, and the server merges everyone's changes, checks the person's role on every change and saves the result. `PUT /api/boards/{id}` still works: it is applied to the shared document, so people who have the board open see the change. A guest of a public link listens to the same document over `/api/public/{token}/live/{room}`: that socket only reads, carries no presence and has places of its own, 200 per board, apart from the 30 of the people on it. What merges and what wins is described in [Working together](../working-together/).

## Status refresh

1. Every 30 seconds (a setting), the open board calls `POST /api/boards/{id}/refresh`. Background tabs pause.
2. The API asks the tracker for all cards on the board in one request. For Jira that is `POST /rest/api/2/search` with `key in (...)`.
3. The API returns fresh task snapshots, and the cards update.

That is one batched request per open board per tick. The response lists every tracker with its own state (`sources`), so one failing tracker never hides the others. Backoff lives on the server, per tracker: rate limits and 5xx responses double the wait (it honours `Retry-After`, up to 300 s). Network errors retry at the normal interval, so a VPN coming back shows up on the next tick. The client polls at the interval, or at `retry_after` when a tracker asked to wait.

## Room to grow

None of this is built. It is listed so the current design does not block it.

- For more load, move from SQLite to Postgres behind the same repository ports, run several API replicas, and share refresh results between boards that show the same keys.
- For fewer requests to the tracker, add a server-side poller with a cache per key, or webhooks where admins allow them.
- A new tracker is a new `TaskProvider` adapter, with no changes to the domain. See [Task trackers](../trackers/).
