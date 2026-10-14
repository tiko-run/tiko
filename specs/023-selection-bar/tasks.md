---
description: "Task list for the selection bar"
---

# Tasks: Selection bar

**Input**: [spec.md](spec.md)

**Tests**: included; made-up data only.

## Phase 1: User Story 1 - Recolor a selection in one click (P1) 🎯

Slice `selection-bar`.

- [x] T001 [US1] `frontend/src/canvas/selection-props.ts`: which properties each element type has, the shared set and the common values of a selection
- [x] T002 [US1] `SelectionBar`: placement above or below the selection box, hidden while dragging, resizing and on a view-only board; type label, "Filter N objects"
- [x] T003 [US1] Fill popover with the stack of swatches, the local preview on hover, one undo step per pick
- [x] T004 [US1] Frame fill: `color` in the frame data and the doc schema, the tint in `FrameNode`; API accepts it and refuses an unknown value
- [x] T005 [US1] Collapse for cards and the actions (timer, duplicate, delete) in the bar; the color toolbars leave `StickyNode` and `ShapeNode`
- [x] T006 [US1] Tests: shared properties, bar on single, same-type and mixed selections, API round trip; a filled frame in `scripts/smoke.py`
- [x] T007 [US1] Data model, DESIGN.md, guide, changelog; close #80 and #81

## Phase 2: User Story 2 - Style beyond color (P2)

Slice `element-style`.

- [x] T008 [US2] Data and API: `opacity`, `stroke`, `dash`, `bold`, `size` as optional fields with their listed values
- [x] T009 [US2] Nodes draw them: opacity on sticky, shape, frame and text; outline on the shape; bold on sticky, shape and text; size on shape and text
- [x] T010 [US2] Bar: opacity slider with one undo step per drag, outline popover, text size and bold
- [x] T011 [US2] Tests: each property on each type, "Mixed" values, API refusals
- [x] T012 [US2] Data model, DESIGN.md, guide, changelog

## Phase 3: User Story 3 - Colors with names (P3)

Slice `color-names`.

- [ ] T013 [US3] Board doc: `colorNames`, API validation, live edit for a rename
- [ ] T014 [US3] Fill popover: name a color, named colors as rows
- [ ] T015 [US3] Legend: rows with counts, select by color, rename in place, collapse; read-only on a view-only board
- [ ] T016 [US3] Tests: doc round trip, rename between two clients, legend counts and selection, API refusals for an unknown color and a name over 24 characters
- [ ] T017 [US3] Contracts, DESIGN.md, guide, changelog
