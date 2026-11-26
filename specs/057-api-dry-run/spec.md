# Feature Specification: Try a change before making it

**Status**: Approved at G1 and G2 on 2026-11-26 (no release is planned yet, so Decision 10 holds by itself).

**Input**: Cut from spec 055 (architect review): an agent about to tidy a large board, or to rearrange a plan, cannot show what its call would do before it does it. With a key with full access the copy makes it undoable, but a person still wants to approve a big change before it lands.

## Why

- Which fog does this clear: "what will the agent do to my board?" The agent shows the person the result first, the person says yes, the agent sends the same call.
- What this spec does not give: a preview in the web app, a diff view, a pending change a person approves inside tiko.

Principles check:

| Principle | How the feature passes it |
|---|---|
| Truth | The answer is the plan the board would take, computed by the same code on the same live state. |
| Clarity | "Add `dry_run: true` and tiko answers as if it made the change, without making it." |
| A fresh angle | None new. |
| Room to arrange | The person sees and approves before anything moves. |
| Calm | Nothing changes, nothing reaches open tabs, no copy is saved. |
| Trust | It names the people's elements the call would change or remove, and the arrows that would go with them. |

## Decisions

1. **On the writes that change what is there.** REST: `dry_run: true` on `POST .../elements`, `PATCH .../elements`, `POST .../elements/remove`, `POST .../arrange`, and `PATCH .../modules/{module}` of spec 056 from its first slice. MCP: on `update_elements`, `remove_elements`, `arrange` and `change_gantt`. The MCP add tools take none: adding touches nobody's work and the key can remove what it added.
2. **The same plan, not written.** The call is planned exactly as the real one, on the board as it stands in its room (or as stored, when nobody has it open), and stops right after the plan: no change to the board, no copy, no rows in `api_elements`, nothing to open tabs. A dry run never opens a room. It spends the write budget like a real call and passes the same checks (scope, board rights, public boards).
3. **The answer** has the real call's shape, built from the planned board the room returns, plus `dry_run: true`. Elements the call would create read as editable, as they would after the real call.
4. **`overwrote` on every write answer**, dry or real: ids of people's elements, arrows and reminders the call changes the text of or removes. When it is not empty, the real call leaves that work in a saved copy (spec 055).
5. **Arrows that go with removed elements are listed in `removed`**, dry or real. A remove answers `204` as today; a dry remove answers `200` with `removed` and `overwrote`. The MCP `remove_elements` answers an object in both modes (`removed`, `overwrote`) instead of a line of text: a deliberate change of its answer, with a CHANGELOG line.
6. **Ids.** Ids the caller did not give are new on every call. An agent that will send the call again after approval gives its own ids, and the real call makes the same elements. A new frame from `arrange` takes no caller id, so it differs.
7. **Cards ask their tracker each time.** A dry run that adds cards resolves them as the real call does: it spends the search budget, and the tracker's answer is kept as any task read keeps it. Dry run plus real call asks twice.
8. **Errors are the real ones**, on the same state: a vote lock or a missing frame shows up before the person says yes.
9. **The board may move on.** The answer is true for the board as it stood; the real call is planned again when it is sent.
10. **Same release as full keys.** A server before this spec ignores an unknown `dry_run` field in REST and would make the change. Shipping it in the same release as keys with full access means no server that can change people's work lacks it. MCP is safe either way: clients send only parameters a tool lists.

## Requirements

- **FR-001**: The writes in Decision 1 MUST take `dry_run`; with it the board, copies, element ownership and open tabs MUST stay as they were, on both the open-room and the stored path, and through another process.
- **FR-002**: A dry run MUST answer what the real call would on the same state, with `dry_run: true`, or fail with the error it would fail with.
- **FR-003**: Write answers MUST carry `overwrote`; removed arrows MUST be in `removed`.

## Testing

- **Room tests**: dry runs of add, change, remove, arrange leave the board version, stored state, copies and `api_elements` unchanged, with the board open in a tab, without, and through another worker process; the answer equals the real call's on the same state; `overwrote` for a full key on people's work; a vote lock fails the same way; `dry` with a restore is refused.
- **API and MCP tests**: the flag on each route and tool; dry remove answers 200; MCP `remove_elements` answers an object.
- **Contract test**: additions only, except the MCP remove answer, noted in CHANGELOG.
- **By hand**: Claude Code with a full key: "show me what tidying the Archive frame would do", then "do it".

## Slices

1. `api-dry-run`: all of it, including the Gantt route of spec 056.

## Out of scope

- A preview or approval flow in the web app; a diff between the board and the dry run.
