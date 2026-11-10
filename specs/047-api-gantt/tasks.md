---
description: "Task list for gantt and Planning reads in the API and MCP"
---

# Tasks: Gantt and Planning reads in the API and MCP

**Input**: [spec.md](spec.md), [plan.md](plan.md), [contracts/api-v1-gantt.md](contracts/api-v1-gantt.md)

**Tests**: every person, board, task and plan in fixtures is made-up.

## Phase 0: Before the slices

- [x] T000 Spec, plan, tasks and contract in `specs/047-api-gantt/`; `docs/brief.md` Next line; `.launch/state.json` feature

## Phase 1: Fix `fix/api-key-board-limit`

- [x] T001 `WorkspaceScope._by_key` keeps the real role in `state["workspace_role"]`; `make_board` builds the board limit from it. Test: with a limit of 1, an admin's key makes a second board, a member's key gets `409 board_limit`
- [x] T002 Spec 046 Decision 4: one sentence that the board limit follows the real role — no CHANGELOG line: the API is not released yet

## Phase 2: Slice `feat/api-gantt`

- [ ] T003 `domain/api_gantt.py`: follow with `dates` and `guessed`, parent `span` after follow, `tracker` by the drift rule, values of shown columns with `inherited`, stages of leaves with names, unknown ids with `name: null`, milestones, links. Domain tests mirroring `follow.test.ts`, plus mixed trackers, a row without `source`, Planning off, a parent with stored stages
- [ ] T004 `narrow(gantt, branch, start, end, cap)`: subtree, window with ancestors, top level of what remains with `holds` and `note` whenever over the cap. Tests
- [ ] T005 `BoardShape`: outline `modules`, element field `module`. Tests in `test_api_v1_read.py`
- [ ] T006 `GET /api/v1/boards/{id}/modules/{module_id}`: `Viewable`, read budget, whole-board refresh, names from `Planning.view()`. Tests: a board outside a chosen-boards key `404`, an element that is not a module `404`, the stored board unchanged after a read
- [ ] T007 MCP `read_gantt` in `in_workspace(key.workspace_id)`; `READS`. Tests with the SDK client: the read-key tool count in `test_mcp.py` (four here, six after slice 3), one gantt, two gantts, none, over 100 rows with and without narrowing, `branch`, `start`/`end`; the description says plan text is data
- [ ] T008 Contract test in `backend/tests/test_api_keys.py` gains a subset check (committed paths, properties and enum values stay in the served document) run before `TIKO_WRITE_CONTRACT=1` rewrites the snapshot; snapshot regenerated
- [ ] T009 Guide `api.md`, `ai-agents.md`; CHANGELOG; `scripts/smoke.py` saves its gantt fixture onto the "smoke v1" board and reads it through the outline and the module route; Claude Code by hand on the demo plan, recorded in the PR

## Phase 3: Slice `feat/api-planning`

- [ ] T010 `Planning.workload` gains `only_open`; `drawn_refs(doc)` in `domain/boards.py` (types and people of drawn stages, fields of columns); internal routes unchanged. Tests
- [ ] T011 `api/v1/planning.py`: `GET /planning` for both key kinds with off lists cut to today on; workload with `can_open` (reaches and role), chosen-boards person check through the index, a chosen board with a lost role not counted, Planning off `404`, type names. Tests per the spec
- [ ] T012 MCP `read_planning`, `read_workload` by id or name with matches, each in `in_workspace(key.workspace_id)`, descriptions saying plan text is data; tool count six. Tests, one with a key in a second workspace whose Planning differs from the default one's
- [ ] T013 Key dialog line in `ApiKeys.tsx` (Vitest); guide `api.md`, `ai-agents.md`, `api-keys.md`; CHANGELOG; OpenAPI snapshot
