---
title: Task trackers
description: Which task trackers tiko supports today and which are planned.
---

tiko reads tasks from your tracker and never changes them. Each person connects their own token, so a card shows only what that person's tracker access allows. Public GitHub issues need no token at all.

| Tracker | Status |
|---|---|
| Demo tasks (built in) | Available |
| Jira Data Center and Server 8.14+ | Available, see [Connect Jira Data Center](../jira-data-center/) |
| GitHub Issues and pull requests, public repositories | Available, see [GitHub Issues](../github-issues/) |
| GitHub private repositories | Available with [your own token](../github-issues/#your-own-token) |
| Jira Cloud | Planned |
| Linear | Planned |
| Plane | Planned |
| Todoist | Planned |
| TickTick | Planned |
| Windshift | Planned |

The demo tasks need no keys or accounts, so a fresh install has something to show.

Demo tasks keep working after you connect a tracker: the welcome board stays live next to your own cards. Every task belongs to its tracker, so the same key in two trackers is two different tasks, and the sync indicator lists each tracker on its own row. Once a board mixes trackers, each card starts with the logo of its tracker.

## Add a tracker

tiko talks to trackers through one provider interface, so a new tracker does not touch the board. That makes a provider a good first contribution: see [Architecture](../architecture/) for the interface and [CONTRIBUTING.md](https://github.com/tiko-run/tiko/blob/main/CONTRIBUTING.md) for the setup.

Missing your tracker? Vote or ask in [Discussions](https://github.com/tiko-run/tiko/discussions).
