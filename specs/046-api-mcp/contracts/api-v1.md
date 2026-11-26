# Contract: public API v1 and MCP

Each slice fixes its part before its code. Names here are final for v1: a later change may only add (spec Decision 22).

## Rules for every call

- Base path `/api/v1/`. JSON in and out, UTF-8.
- Sign-in: `Authorization: Bearer tiko_<40 base62>`. Nothing else signs in here; a session cookie is ignored. `/api/v1/openapi.json` needs no key.
- Every answer carries `X-Request-Id`.
- Errors: `{"error": {"code": "...", "message": "..."}}`, including unknown routes (`404 not_found`) and wrong methods (`405 method_not_allowed`). A body over 1 MB is refused by the proxy with `413` before tiko sees it; that answer may not be JSON.
- Clients must ignore codes, fields and element kinds they do not know.
- Coordinates are absolute board coordinates in pixels at zoom 1, whatever frame an element sits in.
- Ids of boards and elements are opaque strings.
- Writes through the API show in reads at once. Changes people make in the web app show in reads within 10 seconds.

### Status and codes

| Status | Code | When |
|---|---|---|
| 401 | `auth_required` | No key, an unknown key, or a key on a route outside v1 and MCP. Comes with `WWW-Authenticate: Bearer` |
| 401 | `token_expired` | The key's expiry passed |
| 401 | `token_revoked` | The key was revoked, or ended by an account event |
| 403 | `api_disabled` | The workspace admin switched API keys off |
| 403 | `scope_required` | A `read` key on a write call; a key without full access on a restore (spec 055) |
| 403 | `password_change_required` | The person must set a new password in the web app first |
| 403 | `forbidden` | The person's role on the board does not allow the call |
| 403 | `public_board` | A key for all boards writing to a board with a public link that was not chosen for it |
| 403 | `tracker_unauthorized` | The person's tracker rejected their credentials; reconnect it in Settings |
| 404 | `not_found` | Board or element missing, outside the key's workspace, or not among the key's boards; an unknown route |
| 404 | `task_not_found` | The tracker has no task with that key |
| 405 | `method_not_allowed` | The route exists with another method |
| 409 | `conflict` | An element id taken by something the person did not add through the API |
| 409 | `not_api_element` | Changing text or colour of, or removing, an element not added through the API |
| 409 | `keeps_people_work` | A removal would take a person's arrow or timer with it |
| 409 | `vote_running` | Changing text or colour of, or removing, an element in a running vote (moving is allowed) |
| 409 | `board_limit` | The person's board limit is reached |
| 400 | `jira_not_configured` | Jira search on a tiko that does not read Jira |
| 422 | `invalid_request` | The body or query does not match the schema |
| 422 | `validation_failed` | The batch would break a board rule; the message names it |
| 422 | `invalid_ref` | A card reference is neither a key nor a link tiko reads |
| 422 | `host_mismatch` | A link points at another tracker than the instance's |
| 422 | `invalid_jql` | Jira refused the query |
| 429 | `rate_limited` | Over a budget; `Retry-After` in seconds |
| 429 | `tracker_rate_limited` | The tracker asked to slow down; `Retry-After` |
| 429 | `too_many_repositories` | GitHub cards from more repositories than tiko reads at once |
| 500 | `internal` | A fault in tiko; the request id finds it in the log |
| 503 | `tracker_unavailable` | The tracker did not answer |

### Budgets

Per person per minute, whatever key and workspace, shared by every API process:

| What | Budget |
|---|---|
| Reads | 120 |
| Writes (each call, whatever its batch size) | 60 |
| Task search, and any write that adds cards | 20 |
| Requests with a key tiko does not know, per client address | 30 |

Expired and revoked keys do not count against the last budget, so an old key gets its own code. Batches hold up to 200 elements, of which at most 50 cards. A request body is at most 1 MB.

## Key

### `GET /api/v1/me`

```json
{
  "id": "u1", "name": "Mira Example", "username": "mira",
  "workspace": {"id": "w1", "name": "Default"},
  "key": {"name": "laptop agent", "scope": "write", "boards": null, "expires_at": "2027-02-08T10:00:00Z"}
}
```

`boards` is `null` for all boards, or a list of board ids.

## Boards

### `GET /api/v1/boards`

Every board the key reaches, newest change first.

```json
{"boards": [{
  "id": "b1c3", "name": "Release 4.2", "role": "editor",
  "updated_at": "2026-11-10T09:12:00Z",
  "public": false, "shared_with_everyone": true,
  "url": "https://tiko.example.com/?board=b1c3"
}]}
```

### `POST /api/v1/boards` (write)

`{"name": "Sprint 12"}` → `201` with one board as above. A key for chosen boards adds the new board to its list. A retry after a lost answer may make a second board.

### `GET /api/v1/boards/{id}`

Without parameters, an outline:

```json
{
  "board": {"id": "b1c3", "name": "Release 4.2", "role": "editor", "public": false, "shared_with_everyone": true, "url": "..."},
  "frames": [
    {"id": "f1", "title": "In review", "x": 0, "y": 0, "w": 900, "h": 600, "counts": {"card": 7, "note": 2}}
  ],
  "outside": {"counts": {"card": 3, "text": 1, "arrow": 4}}
}
```

- `?frame=f1`: the frame's elements, and arrows with at least one end among them.
- `?elements=all`: every element.
- Filters (spec 054), combined with AND, on either: `?kind=` (repeated) element kinds; `?status=` (repeated) cards whose task is in one of these statuses, case ignored; `?done=true|false` cards whose task is or is not done; `?outside_frames=true` elements not in a frame. A filter on tasks keeps cards only. A filter without `frame` or `elements` reads all elements.
- `?compact=true`: each card carries `title` and `status` next to its `key` instead of `task`, and null fields are left out.
- Both come in pages of at most 500, ordered by id; `?after=<last id of the previous page>` asks for the next one. `{"elements": [...], "more": true}`; `more` is false on the last page. A page boundary stays valid while people edit.

### Element

```json
{"id": "n7", "kind": "note", "x": 120, "y": 80, "w": 200, "h": 200, "frame": "f1",
 "text": "Ask legal about the export", "color": "yellow", "editable": true}
```

| Kind | Fields besides `id`, `kind`, `x`, `y`, `w`, `h`, `frame`, `editable` |
|---|---|
| `card` | `source`, `key`, `task`: `{title, status, assignee, due, url, fetched_at}`, or `null` when the person's credentials cannot read it |
| `note` | `text`, `color` |
| `text` | `text` |
| `code` | `title` (empty for none), `text`, `language` (one of the 28 ids of spec 049, `plain` for none), `collapsed`, `numbered`, `marked` (line numbers from 1) |
| `shape` | `shape` (`rectangle`, `rounded`, `ellipse`, `rhombus`, `triangle`, `parallelogram`, `hexagon`, `cylinder`), `text`, `color` |
| `frame` | `title`, `color` |
| `arrow` | `from`, `to`: element ids, or `null` for an end that points at no element; `label`: the words on the arrow, empty for none (spec 051); no `x`, `y`, `w`, `h`, `frame` |
| `timer` | `note`, `due_at`, `attached_to` (an element id or `null`), `frame` for a free timer in a frame (spec 054) |
| `image`, `module` | `title` where there is one; read-only |

`editable` is true for an element the key's person added through the API, with any of their keys: only those take changes of text and removal. Elements other people added through the API are false. For a key with full access (spec 055) every element is true.

`w` and `h` are present when the board stores a size. A card answers 320 and 50: the room a layout keeps for one; the browser measures it, and an opened card is taller (spec 054).

## Writing (write scope)

### `POST /api/v1/boards/{id}/elements`

```json
{"elements": [
  {"id": "agent-n1", "kind": "note", "text": "Blocked on QA", "color": "pink", "frame": "f1"},
  {"id": "agent-c1", "kind": "card", "ref": "PROJ-42"},
  {"kind": "card", "ref": "https://github.com/acme/app/issues/7"},
  {"kind": "arrow", "from": "agent-n1", "to": "agent-c1"}
]}
```

- `id` is optional: `[A-Za-z0-9-]{1,64}`, not a name `Object.prototype` holds, free among elements and arrows. Without one, a retry adds the element again.
- `x` and `y` come together or not at all. Without them, the call's new elements are placed in a grid of 4 per row below everything on the board, or below the content of `frame` when it is given; the frame grows downwards to hold them.
- A card takes `ref`: a key or a link, resolved the way the card tool resolves it. At most 50 cards per call.
- A code block (spec 049) takes `text` up to 10 000 characters, `language` (default `plain`), `title`, `collapsed`, `numbered` and `marked`; those fields on any other kind, or `text` over 5000 characters on one, answer `422`.
- Sizes: `w` and `h` within 1 – 20 000 for notes, shapes and frames, `w` only for text and code; cards take none. Coordinates within ±1 000 000.
- An arrow joins two elements of the board or of the same call, never an element to itself. v1 makes no arrow with a free end. It takes an optional `label` up to 500 characters (spec 051); empty or only spaces is none; `label` on any other kind answers `422`.
- Answers `200` with `{"elements": [...], "created": [ids]}`: the elements as they now stand, and which of them this call made. A re-add of an id the person already added through the API answers with the element as it is and leaves it out of `created`.

### `PATCH /api/v1/boards/{id}/elements`

```json
{"changes": [
  {"id": "c9", "x": 400, "y": 40},
  {"id": "agent-n1", "text": "QA done", "frame": null}
]}
```

- On any element: `x`, `y` (together), `w`, `h` (as for adding), `frame`. A timer on an element takes none of them: it moves with its element (spec 054).
- On a timer: `on`, an element id it moves to sit on, beside its top-left corner; `null` frees it where it stands. A status timer stays on a card of its task. `on` with `x`, `y` or `frame` answers `422`.
- On any code block: `language`, `collapsed`, `numbered`, `marked`.
- Only on elements added through the API: `text`, `title`, `color`, `shape`.
- On an arrow added through the API: `label` only (spec 051); an empty one removes the label, a new one keeps the label's place and look. Any other field on an arrow answers `422`; `label` on a person's arrow answers `409 not_api_element`, on any other kind `422`.
- `frame: null` takes the element out of its frame and keeps it where it is on the board. Leaving `frame` out never changes it, even when `x` and `y` move the element outside the frame. Moving a frame moves its content.
- Answers with the changed elements.

### `POST /api/v1/boards/{id}/elements/remove`

`{"ids": ["agent-n1"]}` → `204`. Only elements added through the API. An id that is already gone counts as removed, so a retry succeeds. Arrows added through the API that touch a removed element go with it; a person's arrow or timer on it refuses the call (`keeps_people_work`). Removing a frame keeps its content in place.

### Trying first (spec 057)

`"dry_run": true` in the body of `POST /elements`, `PATCH /elements`, `POST /elements/remove`, `POST /arrange` and `PATCH /modules/{module}` plans the call on the board as it stands and answers as the real call would, plus `"dry_run": true`; nothing is written, no copy is saved, open tabs see nothing. Errors are the real ones. Ids the caller did not give are new on every call, so give your own to get the same elements from the real call. A dry remove answers `200` with `{removed, overwrote, dry_run}`; the real one stays `204`. Every write answer carries `overwrote`: people's elements, arrows and reminders the call changes the words of or removes. `removed` lists arrows that go with a removed element. A dry run spends the write budget, and a card in it asks its tracker as the real call does.

### Full access (spec 055)

A key is `read`, `write` or `full`; each does what the one before does. A `full` key, while the workspace setting `full_keys` is on, changes the text and title of any element and removes any element, arrow and reminder on a board its person may edit. With the setting off it acts as a `write` key, and a refusal (`409 not_api_element`) says the admin does not allow it. A running vote still locks its elements (`409 vote_running`).

Before a call by a `full` key changes the words of, or removes, people's work, tiko saves a copy of the board in the same step: no copy, no change. No copy is saved when the newest one already has every element the call overwrites as it stands now, or as a key wrote it since. A board keeps its newest 20 copies, none older than 14 days.

- `GET /api/v1/boards/{id}/copies` (write) → `{"copies": [{"id", "saved_at", "by", "reason", "elements"}]}`, newest first. `by` is the person's name, `reason` `key` or `restore`.
- `POST /api/v1/boards/{id}/copies/{copy}/restore` (full) → `204`. Puts the board back as the copy has it, for everyone at once; the board as it is now is saved first unless it equals the newest copy. Refused while a vote runs (`409 vote_running`). Elements the API added come back as people's.

### `POST /api/v1/boards/{id}/arrange`

```json
{"cards": ["c1", "c2", "c9"], "layout": "status", "frame": {"title": "Sprint 12"}}
```

- `layout`: `grid` or `status` (a column per status: to do, then in progress, then done, by the tracker's status category, and by name within each).
- `columns` (1–20, spec 054): cards a row in the grid. Absent: as many 320 px columns as fit an existing frame's width, at least one; otherwise 4.
- `order`: `given` (default), `key` (numbers compared as numbers), `status` (category, name, then key). In the status layout it sorts each column.
- `fit`: `true` sizes the frame to what it holds plus its margins, smaller or larger; without a frame it answers `422`.
- `frame`: `{"id": "f1"}` for an existing frame, which grows to hold the cards; `{"title": "..."}` to make one below what is on the board; absent to lay the cards out below what is on the board.
- Only the named cards move. Answers like adding elements: the moved cards and the frame, with a new frame in `created`.

### Gantts (spec 056)

- `POST /api/v1/boards/{id}/modules` (write) `{id?, title?, start, end, scale?, x?, y?}` → `201`, the elements answer. An empty Gantt at 960×320, below the board when x/y are left out. It cannot sit in a frame.
- `PATCH /api/v1/boards/{id}/modules/{module}` (write) `{steps: [{op, ...}]}`, up to 200 steps → `{rows, created: [{step, id}], kept}`. Steps apply in order, all or none; a failing one answers `422` with `step N (op): …`. Ops: `add_row`, `update_row`, `move_row`, `remove_row`, `set_range`, `add_stage`, `update_stage`, `remove_stage`, `add_milestone`, `update_milestone`, `remove_milestone`, `link`, `unlink`. `rows` are the rows the call touched, in `read_gantt`'s shape; `kept` lists rows that follow their task and stayed when their branch shifted. A Gantt the key's person added through the API is the key's; a person's Gantt needs full access (`not_api_element` otherwise). Every change saves a copy of the board first, unless the newest copy already holds the Gantt as it stands, so key calls in a row with no other edit between share one copy. At most 50 steps of a call name a task (`task`).

## Tasks

### `POST /api/v1/tasks/search`

```json
{"source": "jira", "query": "project = PROJ AND status = \"In Progress\"", "limit": 50}
{"source": "caldav", "query": "invoice", "done": false}
{"source": "demo", "query": "\"login\""}
```

- `jira`: JQL; `limit` up to 100, default 50.
- `caldav`: words of the title across every list the person shows; `done` includes done tasks; `limit` up to 50, default 20.
- `demo`: as the card tool takes it, with quoted words; `limit` up to 100.
- `github` has no search: add a GitHub card by its key or link.

Answers `{"tasks": [{"source", "key", "title", "status", "assignee", "due", "url", "fetched_at"}], "total": 120, "estimated": false}`.

## MCP at `/api/mcp`

Streamable HTTP, JSON answers, the same key as `Authorization: Bearer`. `/api/mcp` and `/api/mcp/` both work. A tool error carries the message the API would give in `error.message`.

| Tool | Scope | Hints | Maps to |
|---|---|---|---|
| `list_boards` | read | read-only | `GET /boards` |
| `read_board(board, frame?, all?, after?, coordinates?, kinds?, status?, done?, outside_frames?, compact?)` | read | read-only | `GET /boards/{id}`; coordinates only when `coordinates` is true |
| `search_tasks(source, query, done?, limit?)` | read | read-only | `POST /tasks/search` |
| `create_board(name)` | write | — | `POST /boards` |
| `add_cards(board, cards: [{ref, id?, x?, y?}], frame?)` | write | idempotent where ids are given | `POST /elements`, kind `card` |
| `add_notes(board, notes: [{text, color?, kind?, id?, x?, y?, w?, h?}], frame?)` | write | idempotent where ids are given | `POST /elements`, kind `note` or `text` |
| `add_frame(board, title, id?, x?, y?, w?, h?)` | write | idempotent with an id | `POST /elements`, kind `frame` |
| `connect(board, start, end, label?, id?)` | write | idempotent with an id | `POST /elements`, kind `arrow` |
| `update_elements(board, changes)` | write | idempotent | `PATCH /elements` |
| `arrange(board, cards, layout, frame?, new_frame?, columns?, order?, fit?)` | write | — (a frame by title is made anew on a retry) | `POST /arrange` |
| `remove_elements(board, ids, dry_run?)` | write | destructive, idempotent; answers `{removed, overwrote, dry_run}` | `POST /elements/remove` |
| `add_gantt(board, start, end, title?, scale?, x?, y?, id?)` | write | idempotent with an id | `POST /modules` |
| `change_gantt(board, gantt, steps)` | write | destructive | `PATCH /modules/{module}` |
| `list_copies(board)` | write | read-only | `GET /copies` |
| `restore_copy(board, copy)` | full | destructive, idempotent | `POST /copies/{copy}/restore` |

A `read` key lists only the read tools, a `write` key all but `restore_copy`; a tool beyond the key's scope answers `scope_required`. Every answer that names a board carries its `url`.

## Internal routes for the web app (not v1)

Signed in with the session cookie; not part of the public contract.

- `GET /api/me/api-keys` → `{"keys": [{"id", "name", "scope", "boards", "prefix", "created_at", "expires_at", "last_used_on"}], "enabled": true, "full": false}`; `full` says whether the admin allows keys with full access.
- `POST /api/me/api-keys` `{"name", "scope", "boards", "days", "password"}` → `201 {"key": {...}, "token": "tiko_..."}`; a wrong password `401 invalid_credentials`, counted like sign-in.
- `DELETE /api/me/api-keys/{id}` → `204`.
- `GET /api/settings` gains `api_keys` and, for an admin, `api_keys_live`; `PUT /api/settings {"api_keys": true|false}` by an admin.
