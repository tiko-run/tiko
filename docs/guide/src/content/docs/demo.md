---
title: Running a demo
description: Let anyone try your tiko instance in one click, without an account, and stay on it when they sign up.
---

A demo is an ordinary tiko instance started with `TIKO_DEMO=1`. The demo then lives at `/demo`: a page with one button, "Try the demo". One click gives the visitor a board of their own with the demo tasks, and nobody else sees it. Opening the page makes nobody; the button does, so link previews and crawlers leave no accounts behind.

The first screen of the instance stays the sign-in form, with a "Try the demo" link under it. Send people who come to look straight to `https://your-tiko/demo`.

```sh
# .env
TIKO_DEMO=1
```

The switch does not touch the tracker. The instance can run on the demo tasks alone, or be [connected to Jira](../jira-data-center/) for the people who have an account. A visitor works on the demo tasks either way and is not shown the tracker's address.

## What a visitor gets

- A temporary account made by the button: no username, no password, a session cookie in their browser.
- The welcome board and up to three boards in all.
- The demo tasks: `DEMO-1` to `DEMO-12`, whatever tracker the instance is connected to.
- Their own task statuses: a status one visitor changes stays as it was for everyone else.
- Seven days. Each visit starts the count again; after seven days away the visitor and their boards are deleted.

A visitor cannot share a board, turn on a public link, change a name or a password, store a tracker token, or reach Settings → Security and My tracker. A visitor who signs out, or clears cookies, cannot open their boards again.

## Signing up

The top bar shows "Demo · 7 days", the time the boards are still kept. "Sign up to keep it" next to it asks for a name, a username and a password. The visitor becomes a regular member on the spot: the same boards, the same task statuses, the same session, and no seven-day clock. From then on they sign in from any device, share boards and turn on public links. If the instance is connected to a tracker, they add their own token in Settings → My tracker and put its tasks next to the demo cards they already have.

How many boards a person with an account may own is up to you: set `TIKO_BOARD_LIMIT`, for example `TIKO_BOARD_LIMIT=3` to keep the visitor's three. Without it there is no limit after sign-up. Admins are never limited.

On an instance with `TIKO_DEMO=1` the share picker finds a person by their whole username only, so strangers are not listed to each other. A person can run 20 such searches a minute, so usernames cannot be gone through by guessing. For the same reason Share has no "Everyone in tiko", and each person has their own statuses of the demo tasks.

There is no mail on a demo, so a forgotten password cannot be reset by the person; an admin can make a reset link in Settings → People. An account that nobody signed in to for 90 days is deleted with its boards. Admins are never deleted.

## Limits

Two of them are yours to set, the rest are fixed:

| Limit | Value |
|---|---|
| New visitors from one address | 5 an hour; an IPv6 /64 network counts as one address |
| Visitors on the instance | `TIKO_DEMO_LIMIT`, 500 when empty |
| Boards per visitor | 3 |
| Searches for a person in Share | 20 a minute per person |
| Boards per person with an account, admins aside | `TIKO_BOARD_LIMIT`, no limit when empty |

A visitor who changed nothing is deleted an hour after their last request, and is the first to give up their place when the instance is full. A script that only presses the button therefore cannot keep people out: "The demo is full" shows only when that many visitors have real work on a board.

## Before you publish it

- Publish the web port only. The API reads the visitor's address from a header that the web container sets; whoever reaches the API port directly can set it themselves. `compose.release.yml` already keeps the API port inside.
- Put tiko behind a proxy on the same host or private network. The web container believes forwarded addresses only from private networks, so the address limit counts real visitors.
- Admins are not limited and sign in on the first screen like everyone with an account. They see people who signed up, not visitors, and their list of other people's boards leaves visitors' boards out.
- Anyone who signs up can test a tracker token against the address the instance is set to. Only an admin can point that test at another address.
- Turning the demo on does not undo "Everyone in tiko" on boards shared that way before: visitors do not see them, everyone who signs up will. Their owners can still set it to "No access" in Share.
- A demo collects what visitors put on their boards. Publish a privacy notice and terms with it.
