---
description: "Task list for the public API and MCP server"
---

# Tasks: Public API and MCP server

**Input**: [spec.md](spec.md), [plan.md](plan.md), [contracts/api-v1.md](contracts/api-v1.md)

**Tests**: every person, board, task and key in fixtures is made-up.

## Phase 0: Before slice 1

- [x] T000 Spec, plan, tasks and contract in `specs/046-api-mcp/`; `docs/brief.md`: Won't "LLM" → "An LLM inside tiko", a Next line; `.launch/state.json` feature

## Phase 1: Slice `feat/api-keys` (released with slice 2)

- [x] T001 `012_api_keys.sql`; `api_keys` in the global list of `test_postgres.py`
- [x] T002 Port `ApiKeyRepo`, `PgApiKeyRepo`. Repository tests
- [x] T003 `domain/api_keys.py`: create (demo refused, 20 live, password behind a `Limiter`), resolve with the 30 s cache and refusal codes, list, revoke, `last_used_on` once a day, `end_for_person`, `end_for_member`. Domain tests with a fake clock
- [x] T004 `end_keys` message; wiring in `Accounts.set_disabled`, `Accounts.set_password`, `logout_all`, `Memberships.remove`; `change_password` returns the live key count. Test in `test_workers.py`: a key revoked in one process stops in the other within the bound — no worker message: the 30 s cache re-read already bounds a revoke in other processes; ends hook into `Sessions.end_all` without a kept session and `Memberships.remove`
- [x] T005 Purge of ended keys after 30 days in `housekeeping`. Test
- [x] T006 `PasswordGate` key branch (lookup in a thread, per-address budget for unknown keys only, `WWW-Authenticate`, `must_change_password`, `/api/mcp` slash rewrite, open `openapi.json`); `WorkspaceScope` with the key's workspace, role `member`, `api_disabled`. Tests: cookie refused on v1, admin without override, removed member, a key on the live socket refused — the `/api/mcp` slash rewrite moves to slice 3 with the mount
- [x] T007 The switch: `api_keys` setting, `if created:` in `main.py`, `GET/PUT /api/settings` with the live count. Tests: new install on, existing off, off stops keys within the bound
- [x] T008 v1 sub-application: shared state, error handlers (`404`, `405`, validation, `500`, tracker sign-in → `403`), the bearer scheme, metrics label with the prefix; `GET /api/v1/me`
- [x] T009 `openapi-v1.json` committed; the contract test on a normalised document
- [x] T010 `test_workspace_walk.py`: a valid key on every route outside v1 and MCP answers `401`; a key from workspace A never reaches B through v1
- [x] T011 Internal routes `GET/POST/DELETE /api/me/api-keys`
- [x] T012 [P] Web: `api/apiKeys.ts`; `ApiKeys.tsx` (list, create with `read` scope only, boards picker, expiry, password; reveal; revoke); section id in `store.ts`, hidden for visitors and on demo; `Security.tsx` wording and the toast after a password change; the switch in `Sharing.tsx`. Vitest for the section and for who sees it — after a password change the toast links to the keys list instead of revoking them all at once
- [x] T013 Guide page "API keys"; CHANGELOG; `make smoke` makes a key and calls `/api/v1/me`

## Phase 2: Slice `feat/api-read`

- [x] T014 `api/v1/schemas.py` and `domain/api_view.py`: kinds, absolute coordinates, `null` arrow ends, timers with `attached_to`, outline counts, pages by id with `after`. Tests on made-up boards with frames, free arrows, modules and timers
- [x] T015 `GET /api/v1/boards` (no welcome board), `GET /api/v1/boards/{id}` with `frame`, `elements`, `after`; chosen boards as `404`; `public`, `shared_with_everyone`; links `/?board=` from `X-Forwarded-Host`
- [x] T016 `RefreshService.refresh(max_age_s=...)`; reads refresh by age; `fetched_at`; an unreadable card as key and source. Test: a read within the interval does not reach the tracker
- [x] T017 `POST /api/v1/tasks/search` for `jira`, `demo`, `caldav` with their limits; `github` refused with the message
- [x] T018 Budgets for reads and search through `Attempts.spend`. Test across processes
- [x] T019 nginx: `X-Forwarded-Host`, v1 board routing in `api-workers.envsh`. Test with an instance on a port — the port test is in `make smoke` through nginx
- [x] T020 Measure budgets and key lookups with the load scripts on a laptop stand — a quick latency comparison on a local stack instead of the load scripts: v1 adds a couple of milliseconds to a board read
- [x] T021 OpenAPI snapshot (additions only); guide page "API"; CHANGELOG; `make smoke` reads a board

## Phase 3: Slice `feat/mcp-read`

- [ ] T022 Confirm on a real call of each protocol version: the request on the tool context, `tools/list` filtered by middleware. Outcome noted in `plan.md`
- [ ] T023 `mcp` dependency; `make licenses`; `THIRD_PARTY.md`; image size before and after
- [ ] T024 `api/mcp.py`: `MCPServer` with `scope_filter`, the mount, the lifespan
- [ ] T025 Read tools over the v1 operations; `ToolError` mapping; budgets as tool errors; `in_workspace` from the key
- [ ] T026 nginx `/.well-known/` → `404`
- [ ] T027 Tests with the SDK client: a read key's tools, a call on the second process, a host other than localhost, `/api/mcp` with and without the slash, workspace isolation through MCP, the older protocol if the client can be pinned
- [ ] T028 `make smoke`: an MCP call through nginx without the slash, and the `.well-known` 404
- [ ] T029 By hand: Claude Code, Cursor, Codex on a local stack with made-up boards; recorded in the PR
- [ ] T030 Guide page "Connect your AI agent" (Claude Code, Cursor, VS Code, Codex, Claude Desktop through connectors or `mcp-remote`; what leaves tiko through the agent); CHANGELOG

## Phase 4: Slice `feat/api-write`

- [ ] T031 `013_api_elements.sql`; `ApiElementRepo`, `PgApiElementRepo`; the policy test covers it; read across workspaces refused
- [ ] T032 `frontend/src/canvas/sizes.ts` with the defaults now in `layout.ts`, `Canvas.tsx`, `shapes.ts`; `domain/layout.py` constants and the test that reads both
- [ ] T033 `domain/batch.py`: schema bounds, id rules, idempotent re-add, `conflict`, `not_api_element`, `vote_running`, `keeps_people_work`, cascades, coordinates to stored places, placement, frames that grow, acceptance by an unchanged repair. Tests per rule, including each repair note a valid batch used to cause
- [ ] T034 `LiveRooms` loop at start; `LiveRooms.apply` awaiting the lock of a room it opened; `Room.apply` with `_stay`/`_left`, reuse of the last check, save before answering; the drop guard. Tests: an API add reaches an open tab, a person's concurrent edit survives, a write during a slow drop is kept, the first batch on a cold board under a vote
- [ ] T035 `Workers.apply` and its error codes. Test in `test_workers.py`
- [ ] T036 `api_elements` rows before the room, deleted on refusal. Test: a refused batch leaves no rows
- [ ] T037 Card resolution: one `poll` per tracker, links, 50 a call, search budget, `invalid_ref`, `host_mismatch`, `task_not_found`
- [ ] T038 `POST /api/v1/boards` (board limit, chosen-board keys extended), `POST`, `PATCH /elements`, `POST /elements/remove`; the public-link rule; write budget; `write` in the key dialog
- [ ] T039 Write tools with optional ids and hints
- [ ] T040 Measure `Room.apply` on a 2000-element board with sockets open
- [ ] T041 OpenAPI snapshot; guide pages; CHANGELOG; `make smoke` adds and removes a note

## Phase 5: Slice `feat/api-arrange`

- [ ] T042 `domain/layout.py` grid and status columns inside a named, new or no frame; the frame grows; no overlaps. Tests
- [ ] T043 `POST /api/v1/boards/{id}/arrange` and the `arrange` tool
- [ ] T044 By hand: "lay out the open tasks of the demo project by status" from Claude Code; guide; CHANGELOG
