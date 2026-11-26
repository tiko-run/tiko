---
description: "Task list for Linear"
---

# Tasks: Linear

**Input**: [spec.md](spec.md), [plan.md](plan.md), [contracts/api.md](contracts/api.md)

**Tests**: included in every slice, against a fake Linear and a fake Jira; fixtures with made-up workspaces, teams and people only.

## Format: `[ID] [P?] [Story] Description`

- Backend paths under `backend/app/`, frontend paths under `frontend/src/`

## Phase 0: Slice `refactor/sources` — every tracker described once (US0)

**Goal**: a new tracker is an adapter, a source description and a registry entry.

- [x] T001 [US0] `backend/tests/test_sources_matrix.py` on today's code: refs through `/api/tasks/resolve` and API v1 elements, `valid_key`, guest links, token stamps, usage names, the preview, the `/api/me/tracker` body, for every source. Green before any other change
- [x] T002 [US0] `domain/sources.py` with a description per tracker; `valid_key`, `token_stamps`, usage names, the preview and API v1 `_EXPLICIT` read it; `route_ref()` shared by `resolve_task` and API v1. Matrix unchanged
- [x] T003 [US0] Guest links from the source description in `domain/public.py`; the CalDAV card no longer gets a Jira link. Own commit, the matrix row changes on purpose
- [x] T004 [US0] `adapters/tasks/readers.py`: `PersonalReaders`; `NotConnected` in `domain/tasks.py`, since the domain `NoCalDav` builds on it; GitHub and CalDAV use them; `deps.providers()` loops over one tuple of builders. Matrix unchanged
- [x] T005 [US0] Settings: token methods by source; `/api/me/tracker` answers `tokens`. Own commit, the matrix row changes on purpose
- [x] T006 [P] [US0] Web: `registry.ts` carries key and link patterns, short key and token texts; `refs.ts` builds from it; `SourceTokenForm` replaces `GitHubTokenForm`; `api/settings.ts` reads `tokens`. Tests
- [x] T007 [US0] Guard test: a tracker name written in `api/` or `domain/` outside `sources.py` and an allowlist fails. `make check`, `make smoke` green; the dev stack looks and behaves as before

## Phase 1: Slice `feat/linear` — a Linear issue is a live card (US1) 🎯

- [x] T008 [US1] Live reads with a test workspace key (never committed): viewer, issue by link, a board of four, another workspace; the brand terms of the mark (no explicit grant for integrations; Linear agreed in writing on 2026-11-26, files used unchanged). A team move was not tried: it needs a write to the workspace; the poll asks a missing identifier one by one, which covers it
- [x] T009 [US1] `adapters/tasks/linear.py`: `LinearApi` (own client without redirects, auth header, both limit headers, reserve, error mapping), mapping to `Task` (state types, priority, labels, rows, due date, sub-issue), `resolve`, stateless `poll` by identifiers in pages of 100 with `includeArchived`, the capped fallback for missing ones, `check` with name and workspace. Tests on recorded made-up answers and a fake clock (SC-003)
- [x] T010 [US1] The `linear` source description and wiring; the key masked in logs; the token leak test covers it (SC-005); guest refs `private` with their link; the byte test of spec 012 on a board with a Linear task; `linear` in usage stats. API tests with a fake Linear, two people
- [x] T011 [P] [US1] Web: registry entry with the mark, Linear links in paste for everyone (without a key the card tool says to connect Linear), "Sub-issue"; the Linear key in My tracker with the link to Linear's Security & access page; `THIRD_PARTY.md`, `TRADEMARKS.md`. Tests
- [x] T012 [US1] `scripts/smoke.py`: a Linear link with no key answers "connect Linear"
- [x] T013 [US1] Check on the dev stack with a test workspace, both themes: key, link, a state change, a sub-issue, labels and rows, a due date on the Gantt, an archived issue, a teammate without a key, a guest. `make check`, `make smoke` green
- [x] T014 [US1] Guide page "Linear", trackers table, `CHANGELOG.md`, `docs/brief.md`, README trackers line

## Phase 2: Slice `feat/linear-keys` — bare keys and the prefix dialog (US2)

- [ ] T015 [P] [US2] `TaskProvider.has_prefix`: Jira by one project lookup with the person's token (DC and Cloud), cached; Linear from paged team keys; demo its own; others no. Tests with fake Jira and Linear
- [ ] T016 [P] [US2] `PrefixChoices` port, `key_prefix_choices` table and migration 014, `/api/me/key-prefixes`. Tests, demo visitor refused
- [ ] T017 [US2] `route_ref` by prefix, `source` in the resolve body, `409 ambiguous_key`; API v1 and MCP follow. Tests: the four routing cases; a person without Linear sends no extra request (SC-004)
- [ ] T018 [P] [US2] The dialog in `resolveAll` (once per prefix, remember box, link to Settings, Gantt popover stays open) and the Key prefixes list in My tracker. Tests
- [ ] T019 [US2] Check on the dev stack: a bare key of the test workspace, a prefix shared with the demo Jira, the remembered choice. `make check`, `make smoke` green; guide, `CHANGELOG.md`

## Phase 3: Slice `feat/linear-query` — many issues by a query (US3)

- [ ] T020 [US3] `domain/linear_query.py`: the JQL subset of FR-015 to Linear's filter, errors with position. One test per field, operator and function
- [ ] T021 [US3] Adapter: `search` with the filter and a saved view link, `more`; vocabulary and values from the person's workspace. Tests on recorded answers
- [ ] T022 [US3] `search` and the suggestion routes take `source: "linear"`; the card tool offers the query for Linear. Tests
- [ ] T023 [US3] Check on the dev stack: a cycle query and a view link add their issues. `make check` green; guide (fields, operators, the `labels !=` note), `CHANGELOG.md`
