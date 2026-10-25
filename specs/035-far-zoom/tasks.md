---
description: "Task list for Far zoom"
---

# Tasks: Far zoom

**Input**: [spec.md](spec.md)

**Tests**: frontend only; no API, document or live contract change.

## Phase 1: Slice `feat/far-zoom` (US1, US2)

- [x] T001 Spike: arrows without DOM grips. React Flow takes grip positions from `node.handles`, but a measured node overwrites them with what it finds in the DOM, and a node first shown in far view finds none. Find the way that keeps every arrow (FR-002, SC-004) and write it down in the PR; check with an arrow count at 10% on a fresh board
- [x] T002 Zoom without restyling: `--zoom` no longer written on the board root every frame; resize grips get their size another way. SC-002 measured before and after. Tests
- [x] T003 Far view flag: one store selector for zoom ≤ 0.2, handed to nodes through context, so crossing the threshold renders each node once and a zoom inside one view renders none. Tests
- [x] T004 Far view of each element type per Decision 2, theme tokens, no grips, no text editing, double-click zooms in. Tests per type
- [x] T005 Threshold check: screenshots at 15%, 20%, 25%, 30%. SC-001…SC-004 on a 2000-element board, numbers in the PR; `DESIGN.md` far view section, `CHANGELOG.md`, the guide; `make check`, `/ui-review`

## Phase 2: Slice `feat/remote-drag-renders` (US1, SC-001 in Firefox)

- [x] T006 One redraw per frame for another person's drag: drags come as a feed past the canvas state, the move is drawn on the next animation frame. Watcher fps before and after in both engines, renders per frame counted. Tests
