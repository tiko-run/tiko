---
description: "Task list for Canvas polish"
---

# Tasks: Canvas polish

**Input**: [spec.md](spec.md)

**Tests**: frontend only; no API, document or live contract change.

## Phase 1: Slice `feat/side-resize` (US1)

- [x] T001 Side grips: 8 screen pixels at any zoom, resize cursors, arrow dots keep priority, for every element with `NodeResizer`. Tests
- [x] T002 `canvas/layout.ts`: columns of up to five, top to bottom, same center; a close-up by measured sizes (12px in a column, 16px between columns) run once the new cards are measured, inside the undo capture window. Tests in `layout.test.ts`, one undo step
- [x] T003 `CHANGELOG.md`, the guide; `make check`, screenshots of a side drag at 25% and 200% zoom

## Phase 2: Slice `feat/align` (US2)

- [ ] T004 `canvas/align.ts`: six alignments and two distributions on board boxes, skipping children of a selected frame. Tests
- [ ] T005 Align button and popover in `SelectionBar`, one undo step, live for a second client. Tests
- [ ] T006 `DESIGN.md` selection bar section, `CHANGELOG.md`, the guide; `make check`, `/ui-review`

## Phase 3: Slice `feat/minimap` (US3)

- [ ] T007 Minimap: theme tokens for each element type, click and drag to move the view, hidden below 640px. Tests
- [ ] T008 Show and hide button in the zoom controls, `tiko.minimap` in `localStorage`. Tests
- [ ] T009 SC-001 on a 1000-element board; `DESIGN.md`, `CHANGELOG.md`, the guide; `make check`, `/ui-review`
