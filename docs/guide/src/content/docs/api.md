---
title: API
description: Read your boards and search your tasks from a script, with an API key.
---

The API under `/api/v1/` lets a script read what you see in tiko: your boards, what is on them, and the tasks of your trackers. Every call needs an [API key](../api-keys/) in the `Authorization` header. The full description, with every field, is at `/api/v1/openapi.json` on your tiko.

## Boards

```bash
curl -H "Authorization: Bearer tiko_…" https://tiko.example.com/api/v1/boards
```

Lists every board the key reaches, newest change first, with your role, whether the board has a public link or is shared with everyone, and its link.

`GET /api/v1/boards/<id>` gives an outline of one board: its frames with how many cards, notes and other elements each holds, and what lies outside them. Add `?frame=<frame id>` for what is in one frame, or `?elements=all` for everything. Elements come 500 at a time; when `more` is true, ask again with `&after=<id of the last element>`.

What an element looks like:

- `kind` is `card`, `note`, `text`, `shape`, `frame`, `arrow`, `image`, `module` or `timer`.
- `x` and `y` are its place on the board, whatever frame it sits in; `frame` names that frame.
- A card carries its tracker and key, and the task as the tracker shows it: title, status, assignee, due date, link and when tiko last read it. Cards are read again when the copy tiko holds is older than the board's refresh interval, with your own tracker credentials. A task you cannot see comes back as its key only.
- An arrow names the elements it joins in `from` and `to`; an end that points at nothing is `null`.

Changes people make on the board show in the API within about 10 seconds.

## Tasks

```bash
curl -H "Authorization: Bearer tiko_…" -H "Content-Type: application/json" \
  -d '{"source": "jira", "query": "project = PROJ AND status = \"In Progress\""}' \
  https://tiko.example.com/api/v1/tasks/search
```

`source` picks the tracker: `jira` takes JQL, `caldav` takes words of the title, `demo` takes quoted words as the card tool does. GitHub has no search here; add a GitHub card by its key or link.

## Limits

Each person has a budget per minute, whatever key they use: 120 reads, and 20 task searches on top. Over it, the API answers `429` with `Retry-After` in seconds.

## Errors

Every error has the same body:

```json
{"error": {"code": "not_found", "message": "board not found"}}
```

A board the key does not reach answers `404`, the same as a missing one. When your tracker refuses your credentials, the answer is `403 tracker_unauthorized`: reconnect it in Settings → My tracker. The full list of codes is in the API's description.

## Stability

Everything under `/api/v1/` only grows: new fields, element kinds and calls may appear, nothing is removed or changes meaning. Write clients that ignore what they do not know. A change that breaks this would come as `/api/v2/`, with `/api/v1/` kept working for at least six months and announced in the changelog.
