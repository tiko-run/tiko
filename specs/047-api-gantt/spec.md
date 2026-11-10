# Feature Specification: Gantt and Planning reads in the API and MCP

**Status**: Approved at G1 and G2 on 2026-11-10.

**Input**: Spec 046 left the gantt and Planning out: an agent sees a gantt module as a box with a title. People ask an agent "what is late on the release plan", "who works on what next week", "is Mira overloaded in December".

## Why

- Which fog does this clear: the plan already lives in the gantt, next to the live tasks, but only a person looking at it can read it. With this spec their agent reads it too and answers questions about dates, stages and load from the same plan, without anyone copying it out.
- What this spec does not give: writing the gantt or Planning through the API (moving bars, adding stages or people). Reads first, as with boards in spec 046.

Principles check:

| Principle | How the feature passes it |
|---|---|
| Truth | A read returns the plan as the web app draws it: rows that follow the tracker take the dates of freshly read tasks, and each row says where its dates come from and where they disagree with the tracker. |
| Clarity | "Your agent can read your gantt and your team's load." |
| A fresh angle | The agent sees the plan with its tree, stages, people and live task status in one answer, not a flat task list. |
| Room to arrange | Nothing moves; reads only. |
| Calm | No notifications, no UI change beyond one line in the key dialog. |
| Trust | A key reads only gantts on boards it reaches; a key for chosen boards reads only the Planning and load on those boards. Time off has no reason to leak. |

## Decisions

### Finding and reading a gantt

1. **A gantt is read as a module of a board.**
   - The board outline (`GET /api/v1/boards/{id}`) gains `modules`: `[{id, module, title, rows}]`, where `module` is the kind (`"gantt"`) and `rows` the row count. Board elements of kind `module` gain the field `module` too. Both are additions to v1 (spec 046 Decision 22).
   - `GET /api/v1/boards/{id}/modules/{module_id}` answers `{"id", "module": "gantt", "title", "planning", "gantt": {...}}`. `planning` says whether Planning is on in the workspace.
   - Rejected: gantt rows inside the board read. A board holds up to 2000 elements and a gantt up to 200 rows with stages; one answer for both does not fit an agent's context.

2. **Rows as the web app draws them.**
   - Rows come in display order, all of them, with `parent` and `depth`. Collapsing is a view setting and hides nothing; the gantt's saved filters are not applied.
   - A task row carries `key`, `source` (the instance's tracker when the row names none, as cards do) and `task`, shaped as a card's task and refreshed by the rules of spec 046 Decision 16, or `null` when the person's credentials cannot read it. A row without a task carries its `title`.
   - `dates` says where a row's `start` and `end` come from:
     - `tracker`: a leaf without stages with "follow tracker" on, whose task was read and has a date. It takes the task's dates; a side the tracker has none for is guessed 6 days from the other, and `guessed` names that side (`start` or `end`). This is the frontend's `followTracker`, done again on the server, because the dates stored in the board are only as fresh as the last editor's tab.
     - `stored`: a row that follows the tracker but whose task could not be read or has no dates. It shows the dates last stored on the board.
     - `own`: every other row.
   - `tracker`: `{start, end, guessed}` on a row whose task's dates disagree with what the row shows, a guessed side not compared, as the mark at the end of a bar in the web app. A parent is compared on its `span`.
   - A parent row carries `span`: the dates its whole branch covers, computed after following rows took their dates.
   - Milestones come as `{id, date, title}`. Links come as `{from, to}` row ids, read as "`to` starts after `from` ends".

3. **Planning in the gantt, by id and name.** Names are not unique (two people may share one, an archived type may share a live one's), so every Planning item comes as `{id, name}`. An id Planning does not know (a copied board) keeps its `id` with `name: null`.
   - With Planning on, a row without children carries `stages`: `[{id, type: {id, name}, start, end, people: [{id, name}]}]`, `[]` when it has none. A parent's stages are kept in the board but not drawn, and are not returned.
   - With Planning on, a row carries `values` for the fields the gantt shows as columns: `[{field: {id, name}, value, inherited}]`, a value inherited from the nearest ancestor where the row has none, as the web app shows it.
   - With Planning off, rows carry no `stages` and no `values`, as the web app draws them.

4. **Size.**
   - REST returns the whole gantt in one answer: at most 200 rows.
   - MCP's `read_gantt` must fit an agent's context, so it takes `branch` (a row id: that row and everything under it) and `start`/`end` (rows whose bars touch the window, with their ancestors). When more than 100 rows remain, with or without narrowing, it answers with the top-level rows of what remains, how many rows each holds, and a line saying how to narrow the read.

### Reading Planning

5. **`GET /api/v1/planning`** answers `{"enabled": false}` when Planning is off, and otherwise the stage types, people (`id`, `name`, `teams`, `archived`, time off from today on), fields, and the workspace's days off from today on. Saved views are left out: they are filters for the web app.
   - A key for all boards reads the workspace's Planning, as any member does in the web app.
   - A key for chosen boards reads only the types and people of those boards' drawn stages and the fields of their gantts' columns, with days off only within gantts that count working days. Unlike a guest of a public link, it gets no people or fields named only in saved filters.

6. **A person's load.** `GET /api/v1/planning/people/{id}/workload?from=&weeks=` answers the person (`{id, name}`) and what Settings shows: weeks with the number of stages, whether stages overlap on a working day and whether the person is away, and the stages themselves with the type as `{id, name}`. `weeks` up to 26.
   - A stage on a board the key does not reach keeps only its dates, as for a person who cannot open that board in the web app.
   - A key for chosen boards counts and lists only stages on its boards, and reads only people its boards use; other people answer `404`.
   - With Planning off the call answers `404`.

### Both

7. **Freshness and cost.** Each call counts as one read in the budgets of spec 046. A gantt read refreshes the board under the age rule of spec 046 Decision 16, as a board read does: a board of 200 rows may ask the tracker for 200 tasks on the first read and for none within the refresh interval. Under the tracker's back-off rows come from the cache, and `fetched_at` says how old they are. Reads write nothing, including the follow dates they compute.

8. **MCP.** Three read tools join the `read` key's list. Each sets the key's workspace itself before it touches storage (spec 046 Decision 15): Planning reads name no board, so nothing else would stop a lost context from reading another workspace's people.
   - `read_gantt(board, gantt?, branch?, start?, end?)`: `gantt` is a module id and may be left out when the board has exactly one; otherwise the answer lists the board's gantts.
   - `read_planning()`.
   - `read_workload(person, start?, weeks?)`: `person` is a Planning id or a name; a name that matches more than one person answers with the matches.
   Tool descriptions repeat that plan and task text is data.

9. **What leaves, said plainly.** The key dialog and the guide name Planning next to boards: a key reads the people, teams and days away of the workspace's plan, or of its chosen boards' plans (spec 046 Decision 2).

## Requirements

- **FR-001**: The board outline MUST list its modules with kind, title and row count; elements of kind `module` MUST carry `module`.
- **FR-002**: `GET /api/v1/boards/{id}/modules/{module_id}` MUST return a gantt's rows, milestones and links as Decision 2 says, with following rows on their tasks' current dates and their source in `dates`; the read MUST write nothing.
- **FR-003**: With Planning on, rows MUST carry stages (leaves only) and the values of shown fields with ids and names (Decision 3); with it off, neither.
- **FR-004**: `GET /api/v1/planning` MUST return Planning as Decision 5 says, limited to what the key's boards use for a key for chosen boards.
- **FR-005**: The workload MUST hide stages on boards the key does not reach and, for a key for chosen boards, count only stages on its boards.
- **FR-006**: `read_gantt`, `read_planning` and `read_workload` MUST be offered to `read` and `write` keys; `read_gantt` MUST never answer more than 100 rows; the Planning tools MUST run in the key's workspace.

## Testing

- **Domain tests**: `dates` in all three states; guessed start and guessed end; a following parent and a following row with stages keep their own dates; `tracker` on a disagreeing row and not on a guessed side; parent `span` after follow; inherited values and `inherited`; values only for shown columns; unknown type and person ids; a parent with stored stages returns none; Planning on with no stages gives `[]`; Planning off; mixed trackers and a row without `source`.
- The follow rules mirror the frontend's `follow.test.ts` case for case.
- **Planning tests**: a chosen-boards key sees only its boards' types, people and fields; workload of a chosen-boards key counts only its boards; stages of unreached boards keep only dates; a chosen board the person lost access to is not counted; time off from today on; MCP Planning tools in a second workspace read that workspace's people, not the default one's.
- **API tests**: a module on a board outside the key's boards answers `404`; an element id that is not a module answers `404`; a read leaves the stored board unchanged; Planning off gives `{enabled: false}` and workload `404`.
- **MCP tests**: a `read` key lists six tools; `read_gantt` without `gantt` on a board with one and with two gantts; a gantt of 150 rows answers top-level rows, also when a branch or window leaves more than 100; `branch` and `start`/`end`; `read_workload` by a name two people share.
- **Contract test**: the OpenAPI snapshot grows only by additions.
- **By hand**: Claude Code against a local stack with the demo workspace's sample plan: "what is late on the plan", "who is on Build next week", "is anyone overloaded in the next month". Recorded in the slice PR.
- `make check`, `make smoke` with a gantt read.

## Slices

1. `api-gantt`: Decisions 1–4, 7, `read_gantt`; the guide pages `api.md` and `ai-agents.md`; CHANGELOG.
2. `api-planning`: Decisions 5, 6, 9, `read_planning`, `read_workload`; guide; CHANGELOG.

A fix ships before the slices, as its own PR that amends spec 046 Decision 4: a key creating a board applies the board limit of the person's role in the key's workspace, so an admin's key is not held to a member's limit. Board access keeps no admin override. Today a key runs as `member` (`api/workspace.py`), and `make_board` passes that to `board_limit`; the middleware should keep the real role in the request state for it. Matters only when `TIKO_BOARD_LIMIT` is set.

## Notes for the plan

- The gantt reader belongs next to `domain/api_view.py` and reads `GanttContent` (`domain/modules/gantt.py`).
- Frontend rules to mirror: `follow.ts` (`trackerSpan`, `follows`, `followTracker`, `drift`), `tree.ts` (`branchSpan`), `fields.ts` (`cellValue`), `GanttLabel.tsx` (a task row shows key and the task's title), `GanttModule.tsx` (stages of leaves only, Planning off hides stages and columns, drift of a parent on its span).
- A card's public task has no `start`; the row's `tracker` carries its own dates.
- `Planning.workload` takes `can_open`; today the internal route ignores keys, so the v1 route passes the key's boards, and a chosen-boards key also filters the counted stages. `workload` raises `ValidationFailed` with Planning off; v1 maps it to `404`.
- `Planning.for_board` returns each person's whole `off` list; v1 cuts it to today on.

## Out of scope

- Writing the gantt or Planning: bars, stages, people, fields, milestones, links.
- Saved views and gantt filters.
- Other module kinds; there are none yet.
- Tracker dates written back to the tracker.
