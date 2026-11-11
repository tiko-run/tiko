---
title: API
description: Read and arrange your boards and search your tasks from a script, with an API key.
---

The API under `/api/v1/` lets a script read what you see in tiko, your boards, what is on them and the tasks of your trackers, and, with a key that can write, add to boards and lay them out. Every call needs an [API key](../api-keys/) in the `Authorization` header. The full description, with every field, is at `/api/v1/openapi.json` on your tiko.

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

What people change on the board itself, such as notes, frames and where cards sit, shows in the API within about 10 seconds. Task fields follow the refresh interval above.

## Gantts

The outline lists the board's modules under `modules`, each with its `id`, its kind in `module` (`gantt`), its title and, for a Gantt, how many rows it holds.

```bash
curl -H "Authorization: Bearer tiko_…" https://tiko.example.com/api/v1/boards/<id>/modules/<gantt id>
```

Reads the plan as the Gantt draws it, all rows at once, collapsed or filtered out on screen or not:

- Rows come in the order you see them, with `parent` and `depth` for the tree. A task row carries `key`, `source` (its tracker) and `task`, as a card does; a plain row carries its `title`.
- `start` and `end` are the dates the bar shows. `dates` says where they come from: `tracker` for a row that follows the tracker (`guessed` names a side the tracker has no date for, drawn a week from the other), `own` for dates set on the plan, and `stored` for a row that follows the tracker while its task cannot be read right now.
- `tracker` appears where the task's own dates differ from the bar, as the dashed frame does on screen. A parent row carries `span`, the dates its whole branch covers.
- With Planning on, a row carries its `stages`, with the type and the people on each, and the values of the columns the Gantt shows. Each comes with its id and name, since two people may share a name.
- `milestones` and `links` complete the plan; a link means its `to` row starts after its `from` row ends.

## Planning

`GET /api/v1/planning` gives the lists the Gantts plan with: stage types, people with their teams and the time off still ahead, fields, and the workspace's days off from today on. With Planning off, it says only `{"enabled": false}`. A key for chosen boards gets only the people, types and fields those boards' Gantts use.

`GET /api/v1/planning/people/<id>/workload?from=2026-11-09&weeks=12` shows how busy one person is, as Settings does: for each week from that Monday, how many stages they are on, whether two overlap on a working day and whether they are away, and the stages themselves. A stage on a board the key does not reach shows only its dates; a key for chosen boards counts only the stages on its boards. Up to 26 weeks.

## Writing

A key with read and write access can change the boards you can edit:

- `POST /api/v1/boards` makes a new board, and `PATCH /api/v1/boards/<id>` with `{"name": "…"}` renames one.
- `POST /api/v1/boards/<id>/elements` adds notes, text, shapes, frames, cards (by a task key or link) and arrows. Without `x` and `y` they are laid out in rows below what is on the board, or inside the frame you name, which grows to hold them. Give each element your own `id` and a retry never adds it twice.
- `PATCH /api/v1/boards/<id>/elements` moves and resizes elements, puts them in and out of frames, and changes their look: `color`, `bold`, `size` (`small`, `medium`, `large`), `opacity` (10 to 100 in steps of 5), `rotation` (degrees), and a shape's `stroke` (1, 1.5, 3) and `dash`. New elements take the same fields. A field an element does not have in the web app, such as bold on a frame, is refused.
- `POST /api/v1/boards/<id>/arrange` lays cards out as a grid or in a column per status, in a frame or below the board. Only the cards you name move.
- `POST /api/v1/boards/<id>/elements/remove` removes elements.

```bash
curl -H "Authorization: Bearer tiko_…" -H "Content-Type: application/json" \
  -d '{"elements": [{"id": "qa-note", "kind": "note", "text": "Blocked on QA", "frame": "<frame id>"}]}' \
  https://tiko.example.com/api/v1/boards/<id>/elements
```

What people made stays theirs: a key moves and restyles any element, but changes the text of, and removes, only what was added through the API by you. Text people wrote never changes behind their back, and nothing they made disappears. During a vote, the elements in it keep their words and look.

### Reminders

A reminder is an element of kind `timer`. It rings in tiko for whoever has the board open, as one you set by hand: nothing reaches anyone without an open tiko tab.

- At a moment: `{"kind": "timer", "note": "Call legal", "at": "2026-11-12T15:00:00+01:00"}`, with `repeat` (`daily`, `weekdays`, `weekly`) if it should come back. Give `on` with an element's id to hang it on a card, note, shape, text, picture or Gantt; without it, it stands alone.
- When a task moves: `{"kind": "timer", "ref": "PROJ-12"}` goes off when the task leaves the status it has now, or the one you give in `status`. It sits on the task's card, so the card must be on the board; when several cards show the task, name one in `on`. The board notices the move only while it is open.

A board holds at most 50 reminders that have not gone off and been marked done; one more is refused with `409 timer_limit`. A moment in the past is refused. `PATCH …/elements` changes the `note`, `at` and `repeat` of reminders you added; removing an element you added takes your reminders on it along.

A call is applied whole or not at all: if one element breaks a rule, the board stays as it was and the answer says why. People with the board open see the change at once.

A key for all your boards does not write to a board with a public link. To write there, make a key for chosen boards and choose it.

## Tasks

```bash
curl -H "Authorization: Bearer tiko_…" -H "Content-Type: application/json" \
  -d '{"source": "jira", "query": "project = PROJ AND status = \"In Progress\""}' \
  https://tiko.example.com/api/v1/tasks/search
```

`source` picks the tracker: `jira` takes JQL, `caldav` takes words of the title, `demo` takes quoted words as the card tool does. GitHub has no search here; add a GitHub card by its key or link.

## Limits

Each person has a budget per minute, whatever key they use: 120 reads, 60 writes, and 20 task searches on top. Adding cards counts as a search too, since tiko asks your tracker about them. Over it, the API answers `429` with `Retry-After` in seconds.

## Errors

Every error has the same body:

```json
{"error": {"code": "not_found", "message": "board not found"}}
```

A board the key does not reach answers `404`, the same as a missing one. When your tracker refuses your credentials, the answer is `403 tracker_unauthorized`: reconnect it in Settings → My tracker. The full list of codes is in the API's description.

## Stability

Everything under `/api/v1/` only grows: new fields, element kinds and calls may appear, nothing is removed or changes meaning. Write clients that ignore what they do not know. A change that breaks this would come as `/api/v2/`, with `/api/v1/` kept working for at least six months and announced in the changelog.
