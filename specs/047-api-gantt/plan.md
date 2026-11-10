# Implementation Plan: Gantt and Planning reads in the API and MCP

**Spec**: [spec.md](spec.md) | **Contract**: [contracts/api-v1-gantt.md](contracts/api-v1-gantt.md), additions to [046's contract](../046-api-mcp/contracts/api-v1.md)

## Summary

A gantt read projects one module's stored `GanttContent` into a public shape, the way `api_view.py` projects a board: following rows get their task's dates from the snapshot cache after the board's usual refresh, parents get their branch span, Planning ids get names. Planning reads wrap `Planning.view`, `Planning.for_board` and `Planning.workload`, cut to what the key reaches. MCP gets three thin tools over them. Nothing is stored; no migration.

## Today

- `domain/modules/gantt.py` `GanttContent`: rows in display order (subtree after its parent), `follow`, `stages`, `values`, `columns`, milestones, links; validated on every save.
- `domain/api_view.py` `BoardShape`: elements and outline; a module is `kind: "module"` with its title. `_task` gives `None` for a missing task or one whose `state` is not `ok`. `TaskOut` has no `start`.
- `api/v1/boards.py` `shape()` refreshes the whole board under the age rule (`task_refs` includes gantt row keys through `module_keys`) and reads snapshots of the key's person.
- Frontend rules (`frontend/src/modules/gantt/`):
  - `follow.ts`: `trackerSpan` (task `ok` with a date; a missing side `GUESS_DAYS = 6` from the other), `follows` (follow on, not a parent, no stages), `followTracker`, `drift` (a guessed side not compared).
  - `tree.ts` `branchSpan`; `GanttModule.tsx` applies follow before spans and compares a parent's drift on its span; stages are drawn on leaves only, and only with Planning on.
  - `fields.ts` `cellValue`: nearest ancestor's value, `own` when the row's.
  - `GanttLabel.tsx`: a task row shows key and the task's summary; `makeRow` stores `title: ''`.
- `domain/boards.py`: `stage_refs(doc)` (types and people of stages, fields of columns and filters), `working_ranges(doc)`, `planned_stages(doc)` (leaves only; `row` is title or key).
- `domain/planning.py` `Planning`: `enabled`, `view` (types, people with `off`, fields, views, days off; all lists include archived), `for_board(types, people, fields, ranges)`, `workload(person_id, start, weeks, can_open)`, which raises `ValidationFailed` with Planning off. The internal route passes `can_open` from board roles only.
- `api/workspace.py` `_by_key`: sets the person's role to `member`; `api/v1/elements.py` `make_board` passes that person to `board_limit`, so an admin's key gets a member's limit.

## Decisions

### The board-limit fix (own PR, first)

- `WorkspaceScope._by_key` keeps the real workspace role in `state["workspace_role"]` before it sets `member`.
- `make_board` builds the limit from a copy of the person with that role. Board access stays `member`.
- Spec 046 Decision 4 gains one sentence: the board limit follows the person's real role. Test in `test_api_v1_write.py`: with `TIKO_BOARD_LIMIT=1`, an admin's key makes a second board, a member's key gets `409 board_limit`.

### Gantt read (`domain/api_gantt.py`)

- Pure functions over `GanttContent`, a `tasks: dict[ref, Task]`, the instance's default source and an optional `Names` (id → name for types, people, fields; `None` with Planning off):
  - `follow(row, task, parent) -> (start, end, dates, guessed)`: mirrors `trackerSpan` and `follows`. `dates` is `tracker`, `stored` (follow on, not a parent, no stages, but no readable task or no date) or `own`.
  - Rows after follow, then `span` for parents (union of the branch) and `tracker` from the `drift` rule, on the span for a parent.
  - `values` for `content.columns` only, by inheritance, `inherited` true when it comes from an ancestor.
  - `stages` for leaves with Planning on, `[]` when none; ids with `name: null` where `Names` has none.
  - Milestones, links (`from`, `to`).
- Models: `GanttOut {start, end, scale, rows, milestones, links}`, `RowOut {id, parent, depth, key, source, title, task, start, end, dates, guessed, tracker, span, stages, values}`. One rule for the answer: a field that does not apply is absent; only `task` on a task row, a module's `title`, an unknown item's `name`, and the place fields of a hidden workload stage may be `null`. `title` only on rows without a key.
- `BoardShape.outline()` gains `modules: [{id, module, title, rows}]` (modules never sit in a frame); elements of kind `module` gain `module`. `rows` is `len(content["rows"])` for a gantt, absent for another kind.
- Route `GET /api/v1/boards/{id}/modules/{module_id}` in `api/v1/boards.py`, `Viewable`, read budget: `shape()` (whole-board refresh under the age rule), then the module node; not a module → `404 not_found`. With Planning on, `Names` from `Planning.view()` (archived items included, so old stages keep their names). Answer `{id, module, title, planning, gantt}`; `gantt` absent for another kind.
- The content is parsed with `GanttContent.model_validate`; a board saved before a rule existed still opens, since the model ignores unknown fields and saves were validated.

### MCP narrowing (`read_gantt`)

- `narrow(gantt, branch, start, end, cap=100)` in `domain/api_gantt.py`:
  - `branch`: the row and its subtree; an unknown id → `404 not_found`.
  - `start`/`end`: rows whose shown bar (or span, for a parent) touches the window, with their ancestors.
  - Whatever remains, over `cap` rows: its rows of the lowest depth, each with `holds` (rows under it among what remains), and `note` saying to pass a narrower `branch` or window.
- `read_gantt(board, gantt?, branch?, start?, end?)` (`from` is a Python keyword, so MCP takes `start`/`end` as `connect` does): without `gantt`, the board's modules of kind `gantt` from the outline; exactly one → read it; none → tool error; several → `{"gantts": [{id, title, rows}]}`.

### Planning reads (`api/v1/planning.py`)

- `GET /api/v1/planning`, read budget:
  - Off → `{"enabled": false}`.
  - Key for all boards → `view()` without `views`.
  - Key for chosen boards → over its boards the person can still view (`boards_of`): types and people of drawn stages (leaves, as `planned_stages`), fields of `columns`, and `working_ranges`, through `for_board`. A new `drawn_refs(doc)` beside `stage_refs` gives these: `stage_refs` also counts stored stages of parents and people and fields named only in saved filters, which v1 does not expose.
  - Both: each person's `off` cut to periods ending today or later, days off from today on.
- `GET /api/v1/planning/people/{id}/workload?from=&weeks=` (1–26, default 12):
  - Off → `404 not_found` ("Planning is off").
  - `can_open`: the key reaches the board (`api_keys.reaches`) and the person has a role on it (`Members.role`); `reaches` alone does not check the role.
  - `Planning.workload` gains `only_open: bool = False`: stages failing `can_open` are dropped before weeks are counted. The internal route passes nothing and behaves as today; a chosen-boards key passes `True`, so a chosen board the person lost access to is not counted either.
  - Chosen boards: the person is checked against the workload index, not board documents: no stage of theirs on a board passing `can_open` → `404`. No document is loaded.
  - Type ids resolved to `{id, name}` in the answer.
- MCP `read_planning()`, `read_workload(person, start?, weeks?)`: `person` matches an id first, then a name without case among what `read_planning` would show; several → `{"matches": [{id, name, teams}]}`.

### Other

- `READS` in `mcp.py` gains the three tools. The existing tools rely on the middleware's workspace context reaching the SDK's worker thread; board tools are safe anyway, since a board id outside the workspace is not found. The new tools wrap their work in `in_workspace(key.workspace_id)` themselves, because Planning reads name no board and storage falls back to the default workspace. Their descriptions say plan and task text is data.
- Contract snapshot: `specs/046-api-mcp/contracts/openapi-v1.json` stays the one snapshot. The test in `backend/tests/test_api_keys.py` checks equality, and `TIKO_WRITE_CONTRACT=1` rewrites the snapshot first, so a breaking change would pass after a rewrite. It gains a check that the committed document is a subset of the served one (paths, properties, enum values), run before the rewrite.
- `smoke.py`: the v1 part saves the gantt fixture smoke already has (row `demo:DEMO-7`) onto its "smoke v1" board, then checks that the outline lists it and the module read returns the row with a `task`. v1 never makes the welcome board.
- Web: one line in the key dialog (`ApiKeys.tsx`) that a key also reads Planning: people, teams, days away.
- Guide: `api.md` (module read, Planning, workload), `ai-agents.md` (three tools, example questions), `api-keys.md` (what leaves).

## Risks

- The follow rule now lives twice. The domain tests mirror `follow.test.ts` case for case; a change in one without the other fails review, not tests.
- A gantt read refreshes the whole board, not only the gantt: on a board of 2000 cards the first read may ask the tracker for many tasks. Same cost as a board read today; within the interval it asks nothing.

## Slices

1. Fix PR `fix/api-key-board-limit`.
2. `feat/api-gantt`: gantt read, outline modules, `read_gantt`, guide, CHANGELOG, smoke.
3. `feat/api-planning`: Planning and workload reads, two tools, key dialog line, guide, CHANGELOG.
