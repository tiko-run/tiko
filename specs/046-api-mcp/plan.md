# Implementation Plan: Public API and MCP server

**Spec**: [spec.md](spec.md) | **Contract**: [contracts/api-v1.md](contracts/api-v1.md)

## Summary

Keys live in a global table looked up by hash, each bound to a workspace. `PasswordGate` signs a request in with a key on `/api/v1/` and `/api/mcp` only; `WorkspaceScope` runs it in the key's workspace with the role `member` and refuses it when the workspace switched keys off. v1 is a FastAPI sub-application mounted at `/api/v1`, with its own OpenAPI document and error mapping, sharing the main app's state. Reads project the stored board into the public shape. Writes go through one new room operation, `apply`: it builds the board as it would be after the batch, cascades included, refuses it if the repair would still change anything, writes only the touched keys into the live document, and saves before it answers. MCP is the official SDK mounted at `/api/mcp`; each tool calls the same operations as v1.

## Today

- `api/gate.py` `PasswordGate`: resolves the session cookie on every path, on the event loop; `/metrics` alone reads a bearer token.
- `api/workspace.py` `WorkspaceScope`: board routes run in the board's workspace if the person is a member there, the rest in the person's own; lookups run in a thread. `effective_role` makes an `admin` owner of every board (`domain/members.py`).
- `domain/sessions.py`: SHA-256 hashes, a per-process cache re-read after `CACHE_S = 30`, ends told to other processes by `Workers.tell`.
- `Attempts.spend(scope, key, limit, window_s, at)`: a fixed-window budget in Postgres, shared by all processes, with no workspace.
- `adapters/live/rooms.py`:
  - A room applies socket updates at once; `check` runs `LiveDoc.repair` later and keeps the last valid board; it never refuses.
  - A room saves 2 to 10 seconds after a change; the board's version moves only on that save. `Room.put` saves before it answers.
  - `LiveRooms` learns its event loop only when a first socket opens a room; `put` skips the loop while it is unset.
  - A room's vote lock loads in a task that is not awaited.
  - A room without sockets never schedules its own drop; `drop` awaits a save, then deletes and stops the room.
- `domain/live.py`: `LiveDoc.read`, `LiveDoc.write(nodes, edges, current=...)` touching only what differs with origin `SERVER`, `repaired(...)` with notes. Removing an element drops its arrows (`edge_dropped`) and their free ends (`anchor_dropped`); removing a frame detaches its children (`node_detached`).
- `domain/refresh.py` `RefreshService.refresh` polls the tracker on every call; snapshots keep `fetched_at`.
- Task search: Jira by JQL up to 100, demo by quoted words, CalDAV through its finder (title words, a list id, `done`, at most 50). GitHub has no search. A card reference resolves one at a time.
- The web app opens a board at `/?board=<id>` (`frontend/src/lib/navigation.ts`).
- Settings per workspace in `settings`; a boolean is `"1"` or absent; "on for a new install" is `if created:` in `main.py`.
- Migrations `adapters/storage/pg_migrations/NNN_*.sql`, last `011_votes.sql`. `backend/tests/test_postgres.py` lists global tables that carry a `workspace_id`.

## Decisions

### Storage

- `012_api_keys.sql` (slice 1): `api_keys`, global like `invites`, no row-level security, added to the global list in `test_postgres.py`:
  `id text PK`, `token_hash text UNIQUE NOT NULL`, `user_id → users ON DELETE CASCADE`, `workspace_id → workspaces ON DELETE CASCADE`, `name text`, `scope text CHECK (scope IN ('read','write'))`, `boards text[]` (null = all), `prefix text`, `created_at`, `expires_at`, `last_used_on date`, `ended_at timestamptz`, `ended_reason text`. Index on `(user_id, workspace_id)`. Rows of ended keys stay 30 days, so the answer can say `token_revoked` or `token_expired`, then `housekeeping` (process 0, `main.py`) deletes them.
- `013_api_elements.sql` (slice 4): `api_elements(workspace_id, board_id, element_id, user_id, created_at)`, primary key `(workspace_id, board_id, element_id)`, composite reference to `boards (workspace_id, id)` with cascade, forced row-level security and both policies as in `009_stickers.sql`.
- The switch is the workspace setting `api_keys` (`"1"` or absent). `main.py` sets it under `if created:`; existing installs and later workspaces start without it, so off.

### Keys (`domain/api_keys.py`)

- `ApiKeys(repo, role_in, attempts, clock)`; it depends on a membership lookup only, so `Memberships` can call it without a cycle.
  - `create(person, workspace, name, scope, boards, days, password)`: refuses a demo visitor or a demo instance and more than 20 live keys; checks the password with `verify_password` behind a `Limiter` with scope `"api-key-password"` and the sign-in limits; makes `tiko_` + 40 characters from `secrets.choice` over base62; stores the hash; returns the key once. Until slice 4 the dialog offers `read` only.
  - `resolve(token, now) -> KeyIdentity | KeyRefusal`: a per-process cache by hash, re-read after 30 s like `Sessions`. Refusals carry their code. `last_used_on` is written at most once a day per key, decided from the cache.
  - `list`, `revoke`, `end_for_person(user_id, reason)`, `end_for_member(user_id, workspace, reason)`: set `ended_at`, drop the cache here and, through a told message `end_keys` with the user id, in the other processes.
- Account events, where sessions already end: `Accounts.set_disabled`, `Accounts.set_password` (reset by link), `logout_all`, `Memberships.remove`. `Accounts.change_password` keeps keys and returns how many are live.

### Signing a request in

- `PasswordGate`, for a path under `/api/v1/` or `/api/mcp`:
  - `/api/mcp` without the slash is rewritten to `/api/mcp/` in the scope, so the mount never answers a `307` built from the inner address.
  - `/api/v1/openapi.json` is open.
  - Otherwise only `Authorization: Bearer tiko_…` is read, never the cookie. The lookup runs in a thread, as `WorkspaceScope` does its own. Unknown → `401 auth_required` and a spend of the per-address budget (`"api-key-wrong"`; over it `429`); expired or ended → `401` with its code and no spend. `WWW-Authenticate: Bearer realm="tiko", error="invalid_token"` on each. `must_change_password` → `403`. Otherwise `state.person` and `state.api_key`.
- Everywhere else a bearer key is ignored: the request falls to the cookie as today. The live socket reads only the cookie.
- `WorkspaceScope` with `state.api_key`: the key's workspace; no membership there → `401 token_revoked`; the switch off → `403 api_disabled`; the person's role set to `member`. This covers v1 and MCP alike.
- Scope: a v1 dependency on write routes; for MCP, the SDK middleware below.

### v1 application (`api/v1/`)

- A `FastAPI` sub-application mounted at `/api/v1`: `docs_url=None`, `openapi_url="/openapi.json"`, an `HTTPBearer` security scheme, `state` shared with the main app (`v1.state = app.state`; `request.app` is the sub-app). Its own handlers: the main mapping, tracker sign-in errors → `403 tracker_unauthorized`, `404`/`405` and validation errors in the error body, anything else `500 internal`. The metrics label of a mounted route loses its `/api/v1` prefix today (`observability.py` reads the inner app's route); the label is built with the mount's path in front.
- Files: `__init__.py`, `deps.py` (key, scope, board access, budgets, links), `me.py`, `boards.py`, `elements.py`, `tasks.py`, `schemas.py`.
- Board access: `Members.require` with the role `member` (no override); a board outside the key's list → `404`; a write to a board with a public link not chosen for the key → `403 public_board`.
- Budgets: `Attempts.spend("api-read" | "api-write" | "api-search", person_id, limit, 60, now)` in a dependency; over → `429 rate_limited` with `Retry-After`. The budget is per person across workspaces, as the table has none.
- Links: `scheme://host/?board=<id>`, host from `X-Forwarded-Host` (nginx sends `$http_host`, port included), falling back to `Host`; scheme from `X-Forwarded-Proto` as in `api/auth.py`.

### Reads

- `domain/api_view.py`: kinds by name, absolute coordinates (frame offsets added), anchors hidden behind `null` arrow ends, `attached_to` for timers, `editable` from `api_elements` rows of the key's person (all false before slice 4), outline counts, pages of 500 ordered by id with `after`.
- The board read comes from storage. Writes through the API save before they answer, so they show at once; browser edits show after the room's save, within 10 seconds, as the contract says.
- Listing boards calls `boards.listing(person.id, others=False)` directly, never `create_welcome`.
- Fresh cards: `RefreshService.refresh(..., max_age_s=interval)` polls only keys whose snapshot `fetched_at` is older than the interval; the browser path passes nothing and behaves as today.
- Task search: `jira` and `demo` through `search_tasks` with that source's provider, built as `deps.providers` builds it; `caldav` through its finder across every shown list; `github` → `422 invalid_request` naming key or link.

### Writes

- `domain/batch.py`, pure functions over stored nodes and edges:
  - `plan_batch(nodes, edges, ops, made_by_api, locked, person) -> (nodes, edges, changed)`.
  - Schema bounds first, from the contract: sizes, coordinates, ids, arrows between two elements and not to themselves, no handles.
  - Rules: `conflict` and idempotent re-adds; `not_api_element`; `vote_running` for text, colour and removal; `keeps_people_work`.
  - Cascades applied here, not left to the repair: an API arrow touching a removed element goes with it; a removed frame's children keep their absolute place.
  - Public coordinates to stored places; elements without coordinates placed by `domain/layout.py`; a frame that receives placed elements grows downwards.
  - Acceptance: `repaired(new, previous=current, changed=changed, locked=locked)` must return the state unchanged; any note → `422 validation_failed` with that note in plain words. Since the repair already enforces every rule of `check_doc`, no second `check_doc` runs.
- `Room.apply(plan)` on the event loop: `_stay()`; a pending `check` first, so the document and `last` agree; read, using what the last check left where it can (`LiveDoc._checked`) instead of reading and validating the whole board again; `plan_batch`; `LiveDoc.write(new, current=read)`, which touches only changed keys with origin `SERVER`; `check`; `await self.save()`, as `put` does; `_left()` when no socket is there. Nothing awaits between the read and the write.
- `LiveRooms`:
  - It gets its loop in the lifespan, so a process without sockets can open a room.
  - `apply` opens the room if needed, awaits its vote lock when this call opened it (`_load_lock`), then calls `Room.apply`.
  - `drop` gives up when the room became dirty during its save or its drop timer is no longer the current one, so a write that lands during a drop is kept.
- `Workers.apply` forwards to the room's process like `put`, with a message `apply`; the new error codes join `_ERRORS`.
- `api_elements` rows are written after the room took the batch, only for what it created. A row written ahead would count an element as the caller's for a moment, even a person's one under a taken id, and a parallel call could change it. A crash between the two leaves an element counted as a person's: the safe side.
- Cards by `ref`: keys grouped by tracker and resolved with one `poll` per tracker before the room is asked; links parsed as the card tool does; at most 50 cards a call; the call spends the search budget too.
- `domain/layout.py`: default sizes as the web app makes them, card 320 × 50 (`CARD_GUESS`, `canvas/layout.ts`), note 200 × 200, text 240 wide, frame 480 × 320 (`Canvas.tsx`), shape 160 × 100 (`canvas/shapes.ts`). They move into `frontend/src/canvas/sizes.ts`; a backend test reads that file and fails when the Python constants differ. Placement: a grid of 4 per row, 40 px gaps, below the board's lowest element or the frame's content. Status columns ordered by `Task.status_category` (`new`, `indeterminate`, `done`), then `status_name`.

### MCP (`api/mcp.py`)

- `mcp` 2.x: `server = MCPServer("tiko", instructions=..., middleware=[scope_filter])`. Tools are plain `def`; the SDK runs them on a worker thread, where `LiveRooms.apply` may block on the loop's result.
- Mounted: `app.mount("/api/mcp", server.streamable_http_app(streamable_http_path="/", stateless_http=True, json_response=True, transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False)))`; the main lifespan enters `server.session_manager.run()`.
- Identity: `ctx.request_context.request.state` holds what the gate and the scope set. Each tool sets `in_workspace(key.workspace)` itself.
- `scope_filter`: drops write tools from `tools/list` for a `read` key and refuses their `tools/call` with `scope_required`.
- Slice 3 starts by confirming two things on a real call of each protocol version: the request is on the context, and the middleware can filter `tools/list`. If the first fails, an ASGI wrapper puts the identity into a context variable; if the second fails, all tools are listed and write tools refuse.
- Confirmed with `mcp` 2.3.0 on both protocol versions, through a real HTTP client: a tool sees the gate's `request.state` and a context variable set around the mounted app, on a worker thread. The middleware list is provisional in the SDK, so `scope_filter` became an override of `MCPServer.list_tools`, which reads that context variable. `/api/mcp` without the slash answers `307`, so the gate adds the slash.
- Errors: domain errors and budgets become `ToolError` with the contract's message. Answers are the pydantic models of `api/v1/schemas.py`.

### nginx

- `frontend/nginx.conf.template`: `location ^~ /.well-known/` returns `404` (OAuth and OpenID discovery alike); `proxy_set_header X-Forwarded-Host $http_host;` in `/api/`.
- `frontend/api-workers.envsh`: `"~^/api/v1/boards/([^/]+)" $1;` in `$board_key`, so v1 board calls land in the room's process; MCP calls rely on `Workers.apply`.

### Web app

- `api/apiKeys.ts` (zod) over the internal routes of the contract.
- `settings/sections/ApiKeys.tsx` in the Account group; hidden for demo visitors and on a demo instance; "Your admin has switched API keys off" when off. List as in `People.tsx`. Create dialog: name; scope (`radio-group`, `write` from slice 4); boards, all or chosen (checkbox list over `listBoards()` in the `CalDavPicker` pattern); expiry (`radio-group`: 7, 30, 90, 365); current password, its error shown by the field. Reveal through `LinkBox`, worded for a key.
- `Security.tsx`: "Sign out everywhere" says it ends API keys too; after a password change the toast says how many keys stay active.
- `Sharing.tsx`: the admin switch "API keys" with the count of live keys.

## Structure

```text
backend/app/
  adapters/storage/pg_migrations/012_api_keys.sql  013_api_elements.sql
  adapters/storage/postgres.py      PgApiKeyRepo, PgApiElementRepo
  adapters/live/rooms.py            Room.apply, LiveRooms.apply, loop at start, drop guard
  adapters/live/workers.py          apply, end_keys
  api/gate.py  api/workspace.py  api/me.py
  api/v1/                           sub-application
  api/mcp.py
  domain/api_keys.py  api_view.py  batch.py  layout.py
  domain/ports.py                   ApiKeyRepo, ApiElementRepo, LiveBoards.apply
  domain/refresh.py                 max_age_s
frontend/src/
  api/apiKeys.ts  canvas/sizes.ts
  settings/sections/ApiKeys.tsx  Sharing.tsx  Security.tsx
frontend/nginx.conf.template  frontend/api-workers.envsh
docs/guide/src/content/docs/        api-keys.md  api.md  ai-agents.md
specs/046-api-mcp/contracts/openapi-v1.json
```

## Slices and releases

1. `feat/api-keys`: storage of keys, `ApiKeys`, gate and scope, account events and `end_keys`, the switch, Settings with `read` keys, `GET /api/v1/me`, the v1 app with its error handlers, the OpenAPI document and its contract test, the route walk with a key.
2. `feat/api-read`: the public view, boards and board pages, refresh by age, task search, budgets, links, nginx board routing for v1.
3. `feat/mcp-read`: the confirmations, the SDK, mount and lifespan, the slash rewrite, read tools, `scope_filter`, `/.well-known/` 404.
4. `feat/api-write`: `api_elements`, sizes, `batch.py`, `layout.py` placement, `Room.apply` and `LiveRooms` changes, `Workers.apply`, card resolution, write routes and tools, `write` in the dialog.
5. `feat/api-arrange`: grid and status columns, route and tool.

Slices 1 and 2 go out in one release: keys that reach only `/me` are not worth a release line. Slices 3 to 5 may each go out on their own. Each slice has its CHANGELOG line (skill `release-notes`), its guide page, `make check` and `make smoke`.

## Risks

| Risk | What we do |
|---|---|
| The request is missing from the tool context on one protocol version | Confirmed first in slice 3; the context-variable fallback is planned |
| A batch that passes `plan_batch` is still changed by the repair under a vote | The lock is awaited before the first batch on a cold room; a test per lock case |
| A write lands while a room without sockets is being dropped | `_stay`/`_left` around `apply` and the drop guard; a test with a slow save |
| The OpenAPI test breaks on a FastAPI or Pydantic upgrade | Compare a normalised document (sorted keys, no titles, descriptions or `servers`); the diff names the path |
| Budgets and key lookups add database work per request | One `spend` per request, the key lookup cached 30 s, `last_used_on` once a day; measured in slice 2 with the load scripts on a laptop stand |
| `Room.apply` validates on the loop that serves sockets | It reuses the last check's state and validates only changed elements; measured with a 2000-element board |
| The SDK pulls `httpx2` and `truststore` into the image | Size checked in slice 3; tiko's own clients stay on `httpx` |

## New dependencies

- `mcp` 2.x (MIT) and what it pulls in (all permissive when checked at G2: MIT, BSD-3-Clause, Apache-2.0, PSF). `make licenses` in slice 3; `THIRD_PARTY.md` names `mcp`.
