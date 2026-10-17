---
description: "Task list for Modules and the Gantt module"
---

# Tasks: Modules and the Gantt module

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/api.md](contracts/api.md)

**Tests**: included: content schemas and `task_keys` on the backend, timeline math and the module shell on the frontend, smoke per slice.

**Organization**: 3 vertical slices, each one `feat/<slice>` branch ending with G3. Order inside a slice: domain + tests → API → UI → smoke.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: disjoint files, no dependency on an unfinished task in the same slice
- Backend paths under `backend/app/` and `backend/tests/`, frontend under `frontend/src/`

## Phase 1: Slice 12 `feat/module-host` — module host and Gantt timeline (US1, US2) 🎯

**Goal**: pick Gantt from the picker, shape its timeline, and have it behave like any other element.

**Independent Test**: add a Gantt from the toolbar and from the right-click menu; switch scale; add a quarter on both sides; set dates; resize; copy, paste, undo; reload: all the same. A board saved with `kind: "future_thing"` opens with a placeholder and saves back unchanged.

### Domain and tests

- [x] T001 [P] [US1] Create `domain/modules/__init__.py`: `ModuleKind` (content model, `keys`), `MODULES` registry, `validate_module(kind, content)`; kind pattern, 256 KB limit, unknown kinds pass through. Tests in `tests/test_modules.py`
- [x] T002 [P] [US2] Create `domain/modules/gantt.py`: `GanttContent` with `start`, `end`, `scale`, empty-by-default `rows`, `milestones`, `links` and all rules from [data-model.md](data-model.md) (row, milestone and link rules land now so the schema is fixed once); register `gantt`. Tests in `tests/test_gantt.py`
- [x] T003 [US1] Add `ModuleNode` to the node union in `domain/boards.py`; `check_doc` validates modules, rejects `parentId` on a module and children of a module; rename `card_keys` to `task_keys` and include module keys; update `refresh.py` and tests (depends on T001, T002)

### API

- [x] T004 [US1] API tests in `tests/test_api_boards.py`: module round-trip, unknown kind round-trip, invalid gantt content → 422 with the reason, gantt task keys returned in `tasks` (depends on T003) Done: content errors come as `invalid_request` like other schema errors; contract updated.

### UI

- [x] T005 [P] [US1] Create `modules/registry.ts` (`ModuleDef`, `ModuleViewProps`, `ModuleHost`, `MODULES`, `findModule`) and add `module` to `canvas/types.ts` and the zod board schema in `api/boards.ts`
- [x] T006 [P] [US2] Create `modules/gantt/timeline.ts`: days between dates, `pxPerDay`, date ↔ x, snapping, quarter and month and week header cells, add quarter before and after, current quarter range. Tests in `modules/gantt/timeline.test.ts`
- [x] T007 [US1] Create `canvas/nodes/ModuleNode.tsx`: header as drag handle with name and settings slot, `NodeResizer` with the def's min size, zod parse of content, placeholder for unknown kind or invalid content; register `module` in `nodeTypes`; keep modules out of `reparent`. Tests in `canvas/nodes/ModuleNode.test.tsx` (depends on T005)
- [x] T008 [US1] Create `modules/ModulePicker.tsx` (shadcn popover gallery: icon, name, description); add a "Modules" button to `Toolbar.tsx` and "Add module…" to `CanvasContextMenu.tsx`; place at viewport center or clicked point (depends on T007)
- [x] T009 [US2] Create `modules/gantt/` `schema.ts`, `index.ts`, `GanttModule.tsx`: header rows, grid, weekend shading at day scale, today line, "+ quarter" on both sides, settings popover with start, end and scale; all controls `nodrag nopan`; tokens from `DESIGN.md` in both themes (depends on T006, T007)
- [x] T010 [US1] Copy, paste, duplicate and undo work for modules: tests in `canvas/clipboard.test.ts` and `canvas/useHistory.test.ts`
- [x] T011 [US1] Smoke: save and load a board with a gantt module and with an unknown kind in `scripts/smoke.py`; `DESIGN.md` module section; `CHANGELOG.md`

**Checkpoint**: `make check`, `make smoke`, screenshot of a Gantt in light and dark → G3.

## Phase 2: Slice 13 `feat/gantt-tasks` — live tasks on the Gantt (US3)

**Goal**: plan live tasks as bars.

**Independent Test**: drop two demo cards into a Gantt, add `DEMO-5` by key and a plain row, drag and stretch bars, reorder rows, drag one row out as a card; change a demo task status: the bar updates in the refresh interval; reload keeps dates.

- [x] T012 [P] [US3] Row math in `modules/gantt/timeline.ts`: bar box from dates, clip to range, date from drop point, move and stretch with snapping, end ≥ start. Tests
- [x] T013 [P] [US3] Create `modules/gantt/GanttRow.tsx` and `GanttBar.tsx`: label column with key and title (editable for plain rows), bar colored by `status_category`, done struck through, not-found state; drag body and ends with pointer capture
- [x] T014 [US3] Add rows in `GanttModule.tsx`: "Add task" (key or URL via `host.resolveTask`, same errors as cards) and "Add row" (plain); delete row; reorder by dragging the label; node min height follows rows (depends on T012, T013)
- [x] T015 [US3] Card drop: `acceptCard` on the gantt def; `Canvas.tsx` `onNodeDragStop` moves a dropped card into the module in one history step. Tests
- [x] T016 [US3] Row eject: dragging a row label out of the module creates a card (task row) or sticky note (plain row) at the pointer via `host.ejectCard` and `host.ejectNote`, one history step. Tests Done: the module host (`ModuleHost`: `addTasks`, `ejectCard`, `ejectNote`) comes through a React context; "Add task" reuses the Jira card form, so it also takes JQL.
- [x] T017a [US2] [US3] After review: module title in the header, `quarter` scale, resizable task column (`labelWidth`), plain bars distinct from task bars (card surface vs status color with type icon)
- [x] T017 [US3] Smoke: board with gantt task rows returns their `tasks`, and refresh polls them; `CHANGELOG.md`

**Checkpoint**: `make check`, `make smoke`, screenshot → G3.

## Phase 2b: Slice 13b `feat/gantt-tree` — rows in a tree (US3b)

**Goal**: plans read as stages, sub-stages and tasks.

**Independent Test**: see US3b in [spec.md](spec.md).

- [x] T022 [P] [US3b] Backend: `parent` and `collapsed` on `Row`; rule that a parent is the row above or one of its ancestors, depth ≤ 5. Tests in `tests/test_gantt.py`
- [x] T023 [P] [US3b] Create `modules/gantt/tree.ts`: depths, visible rows, summary spans, move a subtree to an index and depth, indent, outdent, add a child, remove a row with its children moved up. Tests in `tree.test.ts`
- [x] T024 [US3b] Label: indent by depth, collapse chevron, hover indent, outdent and "+ child"; row drag picks the depth from the horizontal offset; summary bars are not draggable; card drop becomes a sibling of the row above; eject and delete lift children (depends on T023)
- [x] T025 [US3b] Smoke, `DESIGN.md`, `CHANGELOG.md`
- [x] T025a [US3] [US3b] After review: tracker link only in the row's hover actions; task parents keep their key, title and status color on the summary bar; one "Add" with a tab per tracker and a "Plain task" tab

**Checkpoint**: `make check`, `make smoke`, screenshot → G3.

## Phase 3: Slice 14 `feat/gantt-milestones` — milestones and dependencies (US4)

**Goal**: checkpoints and order on the plan.

**Independent Test**: add two milestones, rename and drag one; connect two bars; move the first bar past the second's start: the line turns to the warning color; delete a row: its lines go; reload keeps all.

- [x] T026 [P] [US4] Create `modules/gantt/Milestone.tsx`: diamond, vertical line, editable title, drag in whole days; "Add milestone" in the module toolbar at the visible center date
- [x] T027 [P] [US4] Create `modules/gantt/Links.tsx`: SVG paths from bar end to bar start, warning token on conflict, select and delete; link pure helpers with tests in `timeline.test.ts`
- [x] T028 [US4] Connect bars: drag from the bar's end handle onto another bar creates a link; no self or duplicate links; deleting a row removes its links (depends on T027)
- [x] T029 [US4] Smoke and `CHANGELOG.md`; README feature list mentions modules and Gantt
- [x] T029a [US4] After review: link helpers live in `plan.ts`; exact dates of a bar in a tooltip on hover and below the bar while dragging, a milestone's date on hover; titles open on double-click under pointer capture

**Checkpoint**: `make check`, `make smoke`, screenshot → G3.

## Phase 4: Slice 15 `feat/module-expand` — expand a module (US5)

**Goal**: a module that needs the whole screen opens over the board.

**Independent Test**: see US5 in [spec.md](spec.md).

- [x] T030 [US5] Host: `expandable` on a module kind, `expanded` in its view props, a zoom hook so pointer math works at 1:1; Expand in the module header; the view over the dimmed board with the module's controls, Collapse at the header's right, a sideways scroll bar that starts after the module's fixed columns; Backspace off and undo on while it is open
- [x] T031 [US5] Gantt: a minimum day width per scale when expanded, sticky filters, date header and task column, "+ quarter" in the date header, opens on today; title and field columns on their own panel color, also on the board; no eject to the board from there. Tests in `rows.test.ts` and `ModuleExpanded.test.tsx`
- [x] T032 [US5] Guide, `CHANGELOG.md`

**Checkpoint**: `make check`, screenshot → G3.

## Dependencies

- Slice 12 → 13 → 14, each merged into `main` before the next starts.
- T002 fixes the whole Gantt schema in slice 12 so later slices change no backend code except tests.

## Parallel execution examples

- Slice 12: T001, T002 on the backend with T005, T006 on the frontend.
- Slice 13: T012 and T013.
- Slice 14: T026 and T027.
- Fewer than 3 independent zones per slice after the first tasks: Orca is not worth it.
