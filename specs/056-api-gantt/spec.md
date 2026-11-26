# Feature Specification: An agent keeps a Gantt plan

**Status**: Approved at G1 and G2 on 2026-11-26 (a copy before changing the key's own Gantt too).

**Input**: Issue #400. An agent reads a Gantt through `read_gantt` (spec 047) but cannot change it, so a plan kept by an agent still means dragging rows by hand: add a task to the quarter, move it under another goal, shift its dates, tick a stage done, link it to the task it waits for.

## Why

- Which fog does this clear: the plan drifts from what the team agreed, because updating it is manual work nobody wants to do after a planning call. An agent with the call's notes brings the plan up to date in one go.
- What this spec does not give: Planning lists (stage types, people, fields, time off stay read-only), Gantt view settings people tune by eye (folding, columns, working days, label width, filters), moving rows between Gantts (the web app cannot either).

Principles check:

| Principle | How the feature passes it |
|---|---|
| Truth | A row that follows its task keeps drawing the tracker's dates; the API never writes dates into the tracker. |
| Clarity | "Your agent edits the plan the way you do on the board: rows, dates, stages, milestones, links." |
| A fresh angle | None new. |
| Room to arrange | Nothing the web app cannot do; people reshape the plan after the agent as before. |
| Calm | One call carries a whole planning session; people with the board open see one change. |
| Trust | Every change to a plan is saved first and can be put back from Saved copies (spec 055). |

## Decisions

### Shape

1. **One tool, a list of steps.** `change_gantt(board, gantt, steps)` and `PATCH /api/v1/boards/{id}/modules/{module}` take an ordered list of steps, applied to the plan as it stands when the call lands, one after another, and checked as a whole: the plan they leave must be one the web app would save (tree order, depth 5, 200 rows, stages inside their row, links between existing rows, 256 KB). A failing step fails the call, nothing changes, and the error names the step: `step 3 (move_row): …`. A step is one flat object with an `op` and the fields its op takes.
2. **After every step, the web app's own clean-up**: a row that loses its last child spans its stages again, a row that gets stages stops following its task, a row linked to a task drops its hand-ticked `done`, a collapsed parent that gets a child opens. This is a Python port of those rules from `tree.ts`, `stages.ts` and `done.ts`, kept in step by shared JSON cases (plan before, step, plan after) that both pytest and Vitest run.
3. **Steps, slice 1 (rows):**
   - `add_row`: optional `id` (so later steps can name it), `title` or `task` (a key or a link, resolved as `add_cards` resolves it), optional `parent`, `after` (a sibling's id; `null` for first, left out for last), optional `start`/`end`. A task row follows its tracker's dates; a row without dates gets today plus six days, as in the web app. A task already in the plan is refused, naming its row, so a retry is safe.
   - `update_row`: `id` and any of `title` (plain rows), `start`, `end`, `shift` (days: the row, its branch and their stages move, as dragging a bar does; following rows stay on their tracker and are listed in the answer), `follow`, `done` (plain rows), `task` (link a plain row to a task), `values` (field id to value, `null` clears; only fields shown as columns, which is what reads show).
   - Date rules: a leaf without stages takes `start`/`end`; a leaf with stages refuses them and points at `shift` or the stage steps; a parent's dates are clamped to its children as in the web app; a following row refuses them and points at `follow: false`.
   - `move_row`: `id` with its subtree, to `parent` (`null`: top level) and `after`.
   - `remove_row`: `id`; `branch: true` removes its subtree, otherwise its children move one level up, as the row's remove button does.
   - `set_range`: `start`, `end`, `scale`.
4. **Steps, slice 2 (plan):** `add_stage` (optional `id`, `row`, `type`, `start`, `end`, `people`), `update_stage` (`id` and any of those plus `done`), `remove_stage`; `add_milestone` (optional `id`), `update_milestone`, `remove_milestone`; `link` and `unlink` (`from`, `to`: `to` waits for `from`). Stage steps on a parent are refused: a parent's stages are hidden, as in reads.
5. **Create and remove a Gantt.** `add_gantt(board, title?, start, end, scale?, x?, y?, id?)` and `POST /api/v1/boards/{id}/modules` put an empty Gantt on the board at the web app's size, 960×320, as an element the API added. A Gantt cannot sit in a frame, as in the web app. Removing one is `remove_elements` on its id.
6. **Ids.** Rows, stages and milestones are named by the ids `read_gantt` gives, or by ids earlier steps of the same call gave. Ids left out are made by the server before planning, so a retried plan gives the same ones. Stage types, people and fields are the ids `read_planning` gives to this key; an id the key cannot read, or an archived one, is refused for new use; ids already on a stage are kept as they are. With Planning off, stage and value steps are refused.
7. **The answer** is the rows the call touched, in `read_gantt`'s row shape, the ids each step created, and following rows a `shift` left on their tracker. Not the whole plan: a large one is folded in reads and new rows would hide.

### Rights

8. **A Gantt the API added is the key's**: a `write` key changes it, after a saved copy (Decision 10).
9. **A person's Gantt needs full access**: on a Gantt someone made by hand, a call needs a key with full access (spec 055) and saves a copy of the board first, under 055's rule (no new copy when the newest one already holds the Gantt as it stands). A `write` key gets `not_api_element` saying so. A plan is people's work; a moved date changes it as much as a rewritten note, and the server's change is in nobody's undo.
10. **A copy before changing the key's own Gantt too.** A Gantt the agent made collects people's edits over a quarter; without a copy, a `write` key would rewrite them with no way back. Any change to a Gantt saves a copy first under 055's rule, so a session costs about one copy.

### Live

11. **One change for people with the board open.** The call writes the Gantt once; open tabs redraw it as when someone else edits it. The plan is one value on the board: a person editing the same Gantt at the same moment and the agent overwrite each other, whichever lands last, as two people do today. Steps name rows by id, so a stale agent fails on a missing id instead of overwriting.

## Requirements

- **FR-001**: Steps MUST apply all or none, with the web app's clean-up after each, and the result MUST pass the Gantt module's validation.
- **FR-002**: A key MUST change a Gantt the API added for its person; a Gantt people made MUST need a key with full access. Every change to a Gantt MUST save a copy first, unless the newest copy already holds it.
- **FR-003**: `add_gantt` and `change_gantt` MUST be in REST and MCP; the ids `read_gantt` and `read_planning` give MUST be the ones steps take. `change_gantt` is marked destructive and not idempotent.
- **FR-004**: The answer MUST hold the touched rows as `read_gantt` reads them and the ids each step created.

## Testing

- **Shared cases** (JSON, run by pytest and Vitest): clean-up after each step kind.
- **Domain tests** (`gantt_steps.py`): every step on a plan of three levels; `after` first and last; ids from an earlier step; duplicate task refused; `shift` moves the branch and stages and leaves following rows; date rules each way; remove with and without branch; unknown, unreadable and archived planning ids; Planning off; 201st row and depth 6 fail the call and leave the plan; the error names the step.
- **API tests**: write key on its own Gantt saves a copy; write key on a person's Gantt refused; full key on a person's Gantt saves one copy, a second call none, with the board open in a tab and without; a task row resolves through the tracker as `add_cards` does.
- **MCP tests**: tool list per scope; the scenario below.
- **Contract test**: the OpenAPI snapshot grows only by additions.
- **By hand**: Claude Code with a full key on a local stack: "from these notes: add DEMO-14 under Payments, move Search two weeks later, DEMO-15 waits for DEMO-14, tick design done on DEMO-12"; the web app shows it live, Saved copies holds the plan before.
- `make check`, `make smoke`.

## Slices

0. Done in PR 411: the copy check reads a tab's Gantt as the copy does.
1. `api-gantt-rows`: Decisions 1–3, 5–11; REST, MCP, guide, CHANGELOG.
2. `api-gantt-plan`: Decision 4.

## Out of scope

- Writing a task's dates or status back into its tracker; unlinking a row from its task.
- Planning lists, Gantt view settings, moving rows between Gantts.
- Steps by condition ("every row of team X"): the agent reads, picks ids and sends steps.
