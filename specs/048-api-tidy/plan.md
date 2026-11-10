# Implementation Plan: Tidy a board and set reminders through the API and MCP

**Spec**: [spec.md](spec.md) | **Contract**: additions to [046's contract](../046-api-mcp/contracts/api-v1.md) and its OpenAPI snapshot

## Summary

Styles and timers already exist in the stored board, with validated models; the API only learns to write them. Renaming wraps the internal rename. Nothing new is stored; no migration.

## Today

- `domain/boards.py` validates every style on save: `StickyData` (`opacity`, `bold`, `rotation`), `ShapeData` (adds `stroke`, `dash`, `size`), `TextData` (`opacity`, `bold`, `size`, `rotation`), `FrameData` (`color`, `opacity`). `Opacity` is 10–100 in steps of 5, `Rotation` an integer -180–180, `TextSize` small/medium/large, strokes 1/1.5/3. `TimerData` holds `note`, `dueAt`, `snoozedUntil`, `repeat`, `watch`, `done`.
- `domain/batch.py`: `Change` and `NewElement` carry `text`, `title`, `color`, `shape`; `_restyle` calls `_own` for any of them, so colour is limited to API-made elements. `_own` also refuses an element in a running vote.
- `domain/api_view.py`: `FIELDS` per kind; reads show `color` but no other style; `editable` means "takes text, colour and removal".
- `domain/boards.py` `rename_board(person, board_id, name, boards, live)`: renames and ends public sessions. The internal route allows an editor.
- `api/v1/elements.py`: the writing router (`/boards`, write budget, `Writable`).

## Decisions

### Slice 1 `api-tidy`

- **Style fields.** `Change` and `NewElement` gain `bold`, `size`, `opacity`, `rotation`, `stroke`, `dash`, typed with the board's own `Opacity`, `TextSize` and stroke literal. `rotation` takes any number and is folded to -180–180 and rounded, as `Rotator.tsx` stores it.
- **Which kind takes what** is one map in `batch.py`, `_STYLES`: note `color bold opacity rotation`, shape `color bold size opacity rotation stroke dash`, text `bold size opacity rotation`, frame `color opacity`. A field outside the map is refused with `422`, as colour on a card is today. `_data` writes the given style keys for new elements.
- **Ownership split.** `_restyle` becomes two steps: text, title and the shape's form stay behind `_own`; colour and styles keep only the running-vote check. FR-010 of spec 046 gains one sentence.
- **Reads.** `Element` gains the six fields; `FIELDS` adds them per kind as the map says; `_element` copies them from the node data. Unset is `null`, as other optional fields are. The `editable` comment changes to "takes text changes and removal".
- **Rename.** `PATCH /api/v1/boards/{id}` with `{name}` (`BoardName`) in `api/v1/elements.py`, `Writable`, write budget; answers the board as `GET /boards` lists it. MCP `rename_board(board, name)` in the write tools.
- **MCP.** `update_elements` description names the styles and that they reach people's elements; `NoteIn` gains `bold`, `size`, `opacity`, `rotation`.
- **Web.** The key dialog's write line says a key can rename boards and restyle any element.
- **Contract.** OpenAPI snapshot regenerated; the subset check from spec 047 proves it grows only by additions.

### Slice 2 `api-reminders`

- `NewElement` takes `kind: "timer"` with `note`, `at`, `repeat`, `task`, `status`, `on`; `_data` builds `TimerData` as `watchStatus` and `setDue` do. A timer is placed with `parentId` and the `BESIDE` offset (`-46, 0`) when attached, below the board otherwise.
- `status` defaults to the task's current status from the refresh the route already does for cards; an unreadable task is `422`.
- The limit counts timers with `done` false on the board, inside the plan, so a batch is checked whole. Over 50 → `409 timer_limit`.
- `Change` takes `note`, `at`, `repeat` for timers, behind `_own`.
- Reads gain `repeat`, `watch`, `done`.
- MCP `add_reminder`; its description says it rings in an open tiko tab only.

## Risks

- A person's look can now change behind their back. A server change is in nobody's undo history (spec 046 Decision 11), but live sync shows it at once and the style bar sets it back; text and removal stay theirs.
- Slice 2 writes timers the web app then runs. Fixtures reuse `timer.test.ts` shapes so a field the web app expects is not missed.

## Slices

1. `feat/api-tidy`: rename, styles, reads, key dialog line, guide, CHANGELOG.
2. `feat/api-reminders`: reminders.
