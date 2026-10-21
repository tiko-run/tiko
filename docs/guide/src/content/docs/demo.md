---
title: Running a demo
description: Let anyone try your tiko instance in one click, without an account, and stay on it when they sign up.
---

A demo is an ordinary tiko instance started with `TIKO_DEMO=1`. The demo then lives at `/demo`: a page with one button, "Try the demo". One click gives the visitor a workspace of their own with a board of the demo tasks, and nobody else sees it. Opening the page makes nobody; the button does, so link previews and crawlers leave no accounts behind.

The first screen of the instance stays the sign-in form, with a "Try the demo" link under it. Send people who come to look straight to `https://your-tiko/demo`.

```sh
# .env
TIKO_DEMO=1
```

The switch does not touch the tracker. The instance can run on the demo tasks alone, or be [connected to Jira](../jira-data-center/) for the people who have an account. A visitor works on the demo tasks either way and is not shown the tracker's address.

## What a visitor gets

- A temporary account made by the button: no username, no password, a session cookie in their browser.
- A workspace of their own. Nobody else is in it, and nothing in it shows anywhere else.
- The welcome board and up to three boards in all.
- The demo tasks: `DEMO-1` to `DEMO-12`, whatever tracker the instance is connected to.
- Their own task statuses: a status one visitor changes stays as it was for everyone else.
- [Planning](../gantt/#stages) turned on, with made-up stage types and people. They are the visitor's own copy: add a stage type, a person or time off, and nobody else sees it. Workload counts the visitor's own boards.
- Seven days. Each visit starts the count again; after seven days away the visitor is deleted with their workspace: boards, Planning lists and task statuses.

A visitor cannot share a board, turn on a public link, change a name or a password, store a tracker token, or reach Settings → Security and My tracker. A visitor who signs out, or clears cookies, cannot open their boards again.

## Signing up

The top bar shows "Demo · 7 days", the time the boards are still kept. "Sign up to keep it" next to it asks for a name, a username and a password. The visitor becomes a regular member on the spot: the same workspace, boards, Planning lists, task statuses and session, and no seven-day clock. From then on they sign in from any device and turn on public links. The workspace stays theirs alone, so Share finds nobody to add. If the instance is connected to a tracker, they add their own token in Settings → My tracker and put its tasks next to the demo cards they already have.

How many boards a person with an account may own is up to you: set `TIKO_BOARD_LIMIT`, for example `TIKO_BOARD_LIMIT=3` to keep the visitor's three. Without it there is no limit after sign-up. Admins are never limited.

Share has no "Everyone in this workspace" on a demo.

A demo that ran before visitors got workspaces of their own moves its people once, at the first start of the new version: everyone in the default workspace who is not its admin gets a workspace of their own, with their boards, task statuses and a copy of the Planning lists. Boards they had shared with each other stay with their owners only.

There is no mail on a demo, so a forgotten password cannot be reset by the person; the server admin can make a reset link in Settings → Accounts. An account that nobody signed in to for 90 days is deleted with its boards. Admins are never deleted.

## Limits

Two of them are yours to set, the rest are fixed:

| Limit | Value |
|---|---|
| New visitors from one address | 5 an hour; an IPv6 /64 network counts as one address |
| Visitors on the instance | `TIKO_DEMO_LIMIT`, 500 when empty |
| Boards per visitor | 3 |
| Boards per person with an account, admins aside | `TIKO_BOARD_LIMIT`, no limit when empty |

A visitor who changed nothing is deleted an hour after their last request, and is the first to give up their place when the instance is full. A script that only presses the button therefore cannot keep people out: "The demo is full" shows only when that many visitors have real work on a board.

## Before you publish it

- Publish the web port only. The API reads the visitor's address from a header that the web container sets; whoever reaches the API port directly can set it themselves. `compose.release.yml` already keeps the API port inside.
- Put tiko behind a proxy on the same host or private network. The web container believes forwarded addresses only from private networks, so the address limit counts real visitors.
- Admins are not limited and sign in on the first screen like everyone with an account. Visitors and their boards are in workspaces of their own, which no admin opens. The server admin sees the people who signed up in Settings → Accounts.
- Anyone who signs up can test a tracker token against the address the instance is set to. Only an admin can point that test at another address.
- Turning the demo on does not undo "Everyone in this workspace" on boards shared that way before. Visitors never see them, signed up or not, but people of the default workspace do. Their owners can still set it to "No access" in Share.
- A demo collects what visitors put on their boards. Publish a privacy notice and terms with it.
