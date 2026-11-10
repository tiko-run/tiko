---
description: "Task list for tidying a board and reminders through the API and MCP"
---

# Tasks: Tidy a board and set reminders through the API and MCP

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: every person, board and task in fixtures is made-up.

## Phase 0: Before the slices

- [x] T000 Spec, plan and tasks in `specs/048-api-tidy/`; `.launch/state.json` feature

## Phase 1: Slice `feat/api-tidy`

- [x] T001 `batch.py`: style fields on `Change` and `NewElement`, `_STYLES` map, rotation folding, `_data` writes styles, `_restyle` split into owned text and unlocked style. Domain tests: each field on each kind allowed and refused, style on a person's element allowed, text on it refused, a running vote refuses style, rotation 270 → -90
- [x] T002 `api_view.py`: style fields in reads per kind. Test in `test_api_v1_read.py`: styles round-trip
- [x] T003 `PATCH /api/v1/boards/{id}` rename; MCP `rename_board`, `NoteIn` styles, `update_elements` description. Tests: rename by a read key and on a viewer's board refused, the write-key tool list
- [x] T004 Spec 046 FR-010 sentence; key dialog line (Vitest); guide `api.md`, `ai-agents.md`; CHANGELOG; OpenAPI snapshot; Claude Code by hand, recorded in the PR

## Phase 2: Slice `feat/api-reminders`

- [x] T005 `batch.py` timer adds and changes, attach rules, limit of 50 waiting timers. Domain tests per the spec
- [x] T006 Route and MCP `add_reminder`; reads gain `repeat`, `watch`, `done`; guide; CHANGELOG; snapshot; by hand: a reminder rings in an open tab
