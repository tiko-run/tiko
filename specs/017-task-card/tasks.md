---
description: "Task list for the task card node type"
---

# Tasks: Task card node type

**Input**: [spec.md](spec.md)

**Tests**: included; made-up data only. The check on a real database runs on a copy outside the repository.

## Format: `[ID] [P?] [Story] Description`

- Backend paths under `backend/app/`, frontend under `frontend/src/`

## Phase 1: Slice `feat/task-card` — an upgrade keeps every board (US1) 🎯

- [x] T001 [US1] `domain/boards.py`: `TaskCardNode` and `TaskCardData` with the type `task_card`; `BoardDoc` reads `jira_card` as `task_card`. `domain/welcome.py`. Tests
- [x] T002 [US1] `domain/live.py`: the repair renames a card under the old name instead of dropping it; `LiveDoc.rename_type`. Tests
- [x] T003 [US1] `adapters/storage/sqlite.py`: migrations take a step written as code; the database is copied to `backups/` before one; step 12 renames cards in `doc` and `ydoc`, an unreadable state is dropped. Tests: upgrade, second start, new database
- [x] T004 [P] [US1] Web app: `task_card` in the board schema, the node registry, search, timers and modules; `TaskCardNode.tsx`; a card under the old name in a live document shows as a task card. Tests
- [x] T005 [US1] `scripts/smoke.py`, `scripts/bench_board.py`, fixtures shared by both projections
- [x] T006 [US1] Check on a copy of a real database of schema 11 (spec, Independent Test)
- [ ] T007 [US1] Check on the compose stack: boards open, a new card is added, live edits in two tabs. `make check`, `make smoke`
- [x] T008 [US1] Guide ("Data, backups and upgrades"), `CHANGELOG.md`, data models of specs 009 and 013, `DESIGN.md`
