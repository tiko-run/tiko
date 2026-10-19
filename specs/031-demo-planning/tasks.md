---
description: "Task list for Planning on the demo"
---

# Tasks: Planning on the demo

**Input**: [spec.md](spec.md), [contracts/api.md](contracts/api.md)

**Tests**: against an in-memory demo instance; the sample people are made-up.

## Phase 1: Slice `feat/demo-planning` (US1, US2)

- [x] T001 [US1] `contracts/api.md`: `sample` in `GET /api/planning`; spec 027's contract points to it
- [x] T002 [US1] `domain/planning_sample.py`: sample types and people with fixed ids, time off from today, `workday`; `Planning.write_sample`. Tests
- [x] T003 [US1] `main.py`: the demo cleanup loop writes the sample once a day; `api/planning.py` answers with `sample`; `api/public.py` carries the names on a demo. API tests, writes and workload `403`
- [x] T004 [US1] `domain/welcome.py`: the demo Gantt with stages, people, columns, working days and a clash with time off; the self-hosted Gantt unchanged. Tests
- [x] T005 [US1] Deleting a person clears the stage index of their boards (found by the demo eviction test)
- [x] T006 [US1] Frontend: `sample` in the schema and context; no "New type", new person, new field, "Save as view", time off edits or Settings → Planning when `sample`. Tests
- [x] T007 [US2] The demo start screen, the demo mark tooltip and the demo sticky note say the boards are private, deleted after 7 days without a visit, and not for real data; DESIGN.md
- [x] T008 On a demo compose stack: the welcome Gantt shows stages, names, columns and the red outline; the stage popover has no "New type"
- [x] T009 `CHANGELOG.md`, the guide's Gantt page; `make check` green
