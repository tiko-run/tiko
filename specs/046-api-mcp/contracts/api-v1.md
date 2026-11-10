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
| 403 | `scope_required` | A `read` key on a write call |
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
| `shape` | `shape` (`rectangle`, `rounded`, `ellipse`, `rhombus`, `triangle`, `parallelogram`, `hexagon`, `cylinder`), `text`, `color` |
| `frame` | `title`, `color` |
| `arrow` | `from`, `to`: element ids, or `null` for an end that points at no element; no `x`, `y`, `w`, `h`, `frame` |
| `timer` | `note`, `due_at`, `attached_to` (an element id or `null`); read-only |
| `image`, `module` | `title` where there is one; read-only |

`editable` is true for an element the key's person added through the API, with any of their keys: only those take changes of text and colour, and removal. Elements other people added through the API are false.

`w` and `h` are present when the board stores a size; a card's height is measured by the browser and may be absent.

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
- Sizes: `w` and `h` within 1 – 20 000 for notes, shapes and frames, `w` only for text; cards take none. Coordinates within ±1 000 000.
- An arrow joins two elements of the board or of the same call, never an element to itself. v1 makes no arrow with a free end.
- Answers `200` with `{"elements": [...]}` as they now stand, each with `created: true`, or `false` for a re-add of an id the person already added through the API.

### `PATCH /api/v1/boards/{id}/elements`

```json
{"changes": [
  {"id": "c9", "x": 400, "y": 40},
  {"id": "agent-n1", "text": "QA done", "frame": null}
]}
```

- On any element: `x`, `y` (together), `w`, `h` (as for adding), `frame`.
- Only on elements added through the API: `text`, `title`, `color`, `shape`.
- `frame: null` takes the element out of its frame and keeps it where it is on the board. Leaving `frame` out never changes it, even when `x` and `y` move the element outside the frame. Moving a frame moves its content.
- Answers with the changed elements.

### `POST /api/v1/boards/{id}/elements/remove`

`{"ids": ["agent-n1"]}` → `204`. Only elements added through the API. An id that is already gone counts as removed, so a retry succeeds. Arrows added through the API that touch a removed element go with it; a person's arrow or timer on it refuses the call (`keeps_people_work`). Removing a frame keeps its content in place.

### `POST /api/v1/boards/{id}/arrange`

```json
{"cards": ["c1", "c2", "c9"], "layout": "status", "frame": {"title": "Sprint 12"}}
```

- `layout`: `grid` (4 per row) or `status` (a column per status: to do, then in progress, then done, by the tracker's status category, and by name within each).
- `frame`: `{"id": "f1"}` for an existing frame, which grows to hold the cards; `{"title": "..."}` to make one below what is on the board; absent to lay the cards out below what is on the board.
- Only the named cards move. Answers with the moved cards and the frame.

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
| `read_board(board, frame?, all?, after?, coordinates?)` | read | read-only | `GET /boards/{id}`; coordinates only when `coordinates` is true |
| `search_tasks(source, query, done?, limit?)` | read | read-only | `POST /tasks/search` |
| `create_board(name)` | write | — | `POST /boards` |
| `add_cards(board, cards: [{ref, id?}], frame?)` | write | idempotent where ids are given | `POST /elements`, kind `card` |
| `add_notes(board, notes: [{text, color?, kind?, id?}], frame?)` | write | idempotent where ids are given | `POST /elements`, kind `note` or `text` |
| `add_frame(board, title, id?, x?, y?, w?, h?)` | write | idempotent with an id | `POST /elements`, kind `frame` |
| `connect(board, from, to, id?)` | write | idempotent with an id | `POST /elements`, kind `arrow` |
| `update_elements(board, changes)` | write | idempotent | `PATCH /elements` |
| `arrange(board, cards, layout, frame?)` | write | — (a frame by title is made anew on a retry) | `POST /arrange` |
| `remove_elements(board, ids)` | write | destructive, idempotent | `POST /elements/remove` |

A `read` key lists only the first three; a write tool called with one answers `scope_required`. Every answer that names a board carries its `url`.

## Internal routes for the web app (not v1)

Signed in with the session cookie; not part of the public contract.

- `GET /api/me/api-keys` → `{"keys": [{"id", "name", "scope", "boards", "prefix", "created_at", "expires_at", "last_used_on"}], "enabled": true}`
- `POST /api/me/api-keys` `{"name", "scope", "boards", "days", "password"}` → `201 {"key": {...}, "token": "tiko_..."}`; a wrong password `401 invalid_credentials`, counted like sign-in.
- `DELETE /api/me/api-keys/{id}` → `204`.
- `GET /api/settings` gains `api_keys` and, for an admin, `api_keys_live`; `PUT /api/settings {"api_keys": true|false}` by an admin.
