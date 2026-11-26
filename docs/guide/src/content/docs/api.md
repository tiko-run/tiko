---
title: API
description: Read and arrange your boards and search your tasks from a script, with an API key.
---

The API under `/api/v1/` lets a script read what you see in tiko: your boards, what is on them and the tasks of your trackers. With a key that can write, it also adds to boards and lays them out.

- **Sign-in:** every call needs an [API key](../api-keys/) in the `Authorization` header.
- **Every field:** each call with its fields, errors and samples is in the [API reference](../reference/). Your tiko serves the same schema at `/api/v1/openapi.json`.
- **From an AI agent:** the same calls over MCP, see [Connect your AI agent](../ai-agents/).

This page walks through what the API is for; the reference is the source for every field.

## Boards

```bash
curl -H "Authorization: Bearer tiko_…" https://tiko.example.com/api/v1/boards
```

Lists every board the key reaches, newest change first, with your role, whether the board has a public link or is shared with everyone, and its link. Reference: [List Boards](../reference/operations/list-boards/).

`GET /api/v1/boards/<id>` gives an outline of one board: its frames with how many cards, notes and other elements each holds, and what lies outside them. Reference: [Read Board](../reference/operations/read-board/).

- `?frame=<frame id>` gives what is in one frame, `?elements=all` everything.
- Narrow the elements down with `kind=` (repeat it for several kinds), `status=` (cards whose task has that status), `done=true` or `done=false`, and `outside_frames=true`. Filters combine, and any of them reads elements without `elements=all`: `?done=true&outside_frames=true` gives the finished cards nobody has filed yet.
- `compact=true` gives each card its task's title and status only and leaves out empty fields, so a big board fits in fewer pages.
- Elements come 500 at a time; when `more` is true, ask again with `&after=<id of the last element>`.

What an element looks like:

- `kind` is `card`, `note`, `text`, `code`, `shape`, `frame`, `arrow`, `image`, `module` or `timer`. A `code` block has its `title`, `text`, `language`, whether it is `collapsed` and `numbered`, and its `marked` lines, counted from 1.
- `x` and `y` are its place on the board, whatever frame it sits in; `frame` names that frame. `w` and `h` are its size; a card is 320 by 50, the room a layout keeps for it, and grows taller when someone opens it.
- A card carries its tracker and key, and the task as the tracker shows it: title, status, assignee, due date, link and when tiko last read it. Cards are read again when the copy tiko holds is older than the board's refresh interval, with your own tracker credentials. A task you cannot see comes back as its key only.
- An arrow names the elements it joins in `from` and `to`; an end that points at nothing is `null`. Its `label` holds the words on it, empty when it has none.

What people change on the board itself, such as notes, frames and where cards sit, shows in the API within about 10 seconds. Task fields follow the refresh interval above.

## Gantts

The outline lists the board's modules under `modules`, each with its `id`, its kind in `module` (`gantt`), its title and, for a Gantt, how many rows it holds.

```bash
curl -H "Authorization: Bearer tiko_…" https://tiko.example.com/api/v1/boards/<id>/modules/<gantt id>
```

Reads the plan as the Gantt draws it, all rows at once, collapsed or filtered out on screen or not. Reference: [Read Module](../reference/operations/read-module/).


- Rows come in the order you see them, with `parent` and `depth` for the tree. A task row carries `key`, `source` (its tracker) and `task`, as a card does; a plain row carries its `title`.
- `start` and `end` are the dates the bar shows. `dates` says where they come from: `tracker` for a row that follows the tracker (`guessed` names a side the tracker has no date for, drawn a week from the other), `own` for dates set on the plan, and `stored` for a row that follows the tracker while its task cannot be read right now.
- `tracker` appears where the task's own dates differ from the bar, as the dashed frame does on screen. A parent row carries `span`, the dates its whole branch covers.
- `done: true` marks a row that is [done](../gantt/#track-progress): ticked on the plan, or done in the tracker for a task row. A parent row carries `progress`, `{done, total}` over the rows of its whole branch.
- With Planning on, a row carries its `stages`, with the type and the people on each, and the values of the columns the Gantt shows. Each comes with its id and name, since two people may share a name.
- `milestones` and `links` complete the plan; a link means its `to` row starts after its `from` row ends.

## Planning

`GET /api/v1/planning` gives the lists the Gantts plan with: stage types, people with their teams and the time off still ahead, fields, and the workspace's days off from today on. Reference: [Read Planning](../reference/operations/read-planning/).

- With Planning off, it says only `{"enabled": false}`.
- A key for chosen boards gets only the people, types and fields those boards' Gantts use.

`GET /api/v1/planning/people/<id>/workload?from=2026-11-09&weeks=12` shows how busy one person is, as Settings does: for each week from that Monday, how many stages they are on, whether two overlap on a working day and whether they are away, and the stages themselves. Up to 26 weeks. Reference: [Read Workload](../reference/operations/read-workload/).

- A stage on a board the key does not reach shows only its dates.
- A key for chosen boards counts only the stages on its boards.

## Writing

A key with read and write access can change the boards you can edit:

| Call | Does | Reference |
|---|---|---|
| `POST /api/v1/boards` | Makes a new board | [Make Board](../reference/operations/make-board/) |
| `PATCH /api/v1/boards/<id>` with `{"name": "…"}` | Renames a board | [Rename](../reference/operations/rename/) |
| `POST /api/v1/boards/<id>/elements` | Adds notes, text, code blocks, shapes, frames, cards (by a task key or link) and arrows | [Add Elements](../reference/operations/add-elements/) |
| `PATCH /api/v1/boards/<id>/elements` | Moves and resizes elements, puts them in and out of frames, and changes their look | [Change Elements](../reference/operations/change-elements/) |
| `POST /api/v1/boards/<id>/arrange` | Lays cards out as a grid or in a column per status, in a frame or below the board, sorted as you ask, and can size the frame to fit them. Only the cards you name move. | [Arrange](../reference/operations/arrange/) |
| `POST /api/v1/boards/<id>/elements/remove` | Removes elements | [Remove Elements](../reference/operations/remove-elements/) |

- **Placing:** without `x` and `y`, new elements are laid out in rows below what is on the board, or inside the frame you name, which grows to hold them.
- **Arranging:** a grid fills as many columns as fit the frame, or the number you give in `columns`. `order` sorts the cards by `key` (DEMO-9 before DEMO-10) or by `status`, and `fit: true` makes the frame just big enough for what it holds.
- **Retries:** give each element your own `id` and a retry never adds it twice.
- **Arrow labels:** an arrow takes a `label`, the words on it, when you add it: `{"kind": "arrow", "from": "<id>", "to": "<id>", "label": "blocks"}`. `PATCH …/elements` with `{"id": "<arrow>", "label": "…"}` changes the label of an arrow you drew, and an empty one removes it. Where the label sits and how it looks stay in the web app. An arrow's ends never change: remove it and draw another.
- **Look:** `color`, `bold`, `size` (`small`, `medium`, `large`), `opacity` (10 to 100 in steps of 5), `rotation` (degrees), and a shape's `stroke` (1, 1.5, 3) and `dash`. A code block's `language`, `collapsed`, `numbered` and `marked` lines count as its look too, so a key may fix the language of a block a person made. New elements take the same fields; a code block holds up to 10,000 characters of `text`. A field an element does not have in the web app, such as bold on a frame, is refused.

```bash
curl -H "Authorization: Bearer tiko_…" -H "Content-Type: application/json" \
  -d '{"elements": [{"id": "qa-note", "kind": "note", "text": "Blocked on QA", "frame": "<frame id>"}]}' \
  https://tiko.example.com/api/v1/boards/<id>/elements
```

What people made stays theirs: a key moves and restyles any element, but changes the text of, and removes, only what was added through the API by you, unless it has full access (below). Text people wrote never changes behind their back, and nothing they made disappears. During a vote, the elements in it keep their words and look.

### Reminders

A reminder is an element of kind `timer`. It rings in tiko for whoever has the board open, as one you set by hand: nothing reaches anyone without an open tiko tab.

- At a moment: `{"kind": "timer", "note": "Call legal", "at": "2026-11-12T15:00:00+01:00"}`, with `repeat` (`daily`, `weekdays`, `weekly`) if it should come back. Give `on` with an element's id to hang it on a card, note, shape, text, picture or Gantt; without it, it stands alone.
- When a task moves: `{"kind": "timer", "ref": "PROJ-12"}` goes off when the task leaves the status it has now, or the one you give in `status`. It sits on the task's card, so the card must be on the board; when several cards show the task, name one in `on`. The board notices the move only while it is open.

- **Limit:** a board holds at most 50 reminders that have not gone off and been marked done; one more is refused with `409 timer_limit`.
- **Past moments** are refused.
- **Changes:** `PATCH …/elements` changes the `note`, `at` and `repeat` of reminders you added; removing an element you added takes your reminders on it along.
- **Moving:** a reminder on an element goes wherever the element goes and takes no place of its own. `{"id": "<reminder>", "on": "<element>"}` hangs it on another element, `"on": null` sets it free where it is. A free reminder takes `x`, `y` and a `frame`, as when you add it.

### Full access and saved copies

A key with full access changes the text of, and removes, anything on boards you can edit, once an admin allows it in **Settings → Sharing**. Before a call changes people's work, tiko saves a copy of the board; one tidying session makes one copy, and work someone does in between gets a copy of its own.

- `GET /api/v1/boards/<id>/copies` lists the copies, newest first: when, by whom, and whether it came before a key's change or a restore.
- `POST /api/v1/boards/<id>/copies/<copy>/restore` puts the board back as that copy has it, for everyone at once. It needs a key with full access. The board as it is now is saved first, so a restore can be undone the same way. During a vote it is refused.
- A board keeps its newest 20 copies, for up to 14 days.
- In the web app, anyone who may edit the board finds them under **Saved copies** in the board menu and restores one there, with no agent needed.

### How writes behave

- **Whole or nothing:** if one element breaks a rule, the board stays as it was and the answer says why.
- **Live:** people with the board open see the change at once.
- **Public boards:** a key for all your boards does not write to a board with a public link. To write there, make a key for chosen boards and choose it.

## Tasks

```bash
curl -H "Authorization: Bearer tiko_…" -H "Content-Type: application/json" \
  -d '{"source": "jira", "query": "project = PROJ AND status = \"In Progress\""}' \
  https://tiko.example.com/api/v1/tasks/search
```

`source` picks the tracker. Reference: [Search](../reference/operations/search/).

| `source` | `query` takes |
|---|---|
| `jira` | JQL |
| `caldav` | Words of the title |
| `demo` | Quoted words, as the card tool does |

GitHub has no search here; add a GitHub card by its key or link.

## Limits

Each person has a budget per minute, whatever key they use:

| Calls | Per minute |
|---|---|
| Reads | 120 |
| Writes | 60 |
| Task searches, on top | 20 |

Adding cards counts as a search too, since tiko asks your tracker about them. Over it, the API answers `429` with `Retry-After` in seconds.

## Errors

Every error has the same body:

```json
{"error": {"code": "not_found", "message": "board not found"}}
```

- A board the key does not reach answers `404`, the same as a missing one.
- When your tracker refuses your credentials, the answer is `403 tracker_unauthorized`: reconnect it in **Settings → My tracker**.

The full list of codes per call is in the [API reference](../reference/).

## Stability

Everything under `/api/v1/` only grows: new fields, element kinds and calls may appear, nothing is removed or changes meaning. Write clients that ignore what they do not know. A change that breaks this would come as `/api/v2/`, with `/api/v1/` kept working for at least six months and announced in the changelog.
