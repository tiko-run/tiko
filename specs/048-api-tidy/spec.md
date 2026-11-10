# Feature Specification: Tidy a board and set reminders through the API and MCP

**Status**: Approved at G1 and G2 on 2026-11-10 (Decision 3: style reaches people's elements; Decision 6: reminders ring in an open tab only).

**Input**: After specs 046 and 047 an agent can fill a board and read the plan, but cannot tidy what is there: it cannot rename a board, make a heading bold or a note larger, or colour a person's frame. People also ask an agent "remind me at 3 pm to call about DEMO-4" or "tell me when DEMO-2 moves to Done", and tiko already has timers for both.

## Why

- Which fog does this clear: a board an agent filled still has to be tidied by hand before it reads well. With this spec the agent finishes the job, and a reminder about a task lives next to that task on the board, not in a separate app.
- What this spec does not give: reminders that reach a person when no tiko tab is open. Timers ring in the browser today; this spec does not change that.

Principles check:

| Principle | How the feature passes it |
|---|---|
| Truth | A status reminder watches the live task, as one set by hand does. |
| Clarity | "Your agent can rename a board, style its elements and set reminders." |
| A fresh angle | A reminder sits on the card it is about, so the board shows what is waited for. |
| Room to arrange | Styles change the look only: no text of a person changes. |
| Calm | A reminder rings once, like a hand-set one; the agent cannot set more than a board's limit. |
| Trust | Text and removal stay limited to what the API added (spec 046 FR-010); the key dialog says the agent can restyle elements. |

## Decisions

### Rename a board

1. `PATCH /api/v1/boards/{id}` with `{"name"}` renames a board the key may write (`writable`), by the web app's rule: an editor may rename. MCP gains `rename_board(board, name)`. Same 100-character limit as `create_board`.

### Element styles

2. **Every style the web app has.** `update_elements` and `PATCH /api/v1/boards/{id}/elements` take, next to `color`:
   - `bold`: note, shape, text.
   - `size`: `small`, `medium`, `large`; shape, text.
   - `opacity`: 10 to 100 in steps of 5; note, shape, text, frame.
   - `rotation`: degrees clockwise; note, shape, text. Stored from -180 to 180 as the web app's rotate handle stores it (`Rotator.tsx`), any other value folded into that range.
   - `stroke`: `1`, `1.5`, `3`; shape.
   - `dash`: shape.
   A field a kind does not have is refused, as `color` on a card is today. `add_notes` and `POST .../elements` take the same fields for new elements.
   - Opacity, rotation, stroke and dash cost the same as bold and size: each is a key in the element's data. Doing them all now spares a second round.
3. **Style changes reach any element; text stays the person's.** A key may change the colour and style of any element on a board it may write, the person's own included. Text, titles and removal stay limited to what the API added. This amends spec 046 FR-010, which today covers colour.
   - Why: tidying a board means colouring the frames and bolding the headings people made. A style change loses no words and the person can set it back in one click.
4. **Reads show styles.** Board reads return `bold`, `size`, `opacity`, `rotation`, `stroke` and `dash` where set, so an agent sees what it changes. An addition to v1 (spec 046 Decision 22).

### Reminders

5. **A reminder is a timer element.** MCP gains `add_reminder(board, note, at?, repeat?, task?, status?, on?)`; REST takes `kind: "timer"` in `POST .../elements`.
   - `at`: an ISO moment, with `repeat` (`daily`, `weekdays`, `weekly`) as the editor offers.
   - `task` and `status`: a status reminder that goes off when the task leaves `status`. `status` defaults to the task's current status read through the person's credentials; a task the person cannot read is refused.
   - Exactly one of `at` or `task` is given.
   - `on`: an element id the reminder attaches to (card, note, shape, text, image, module). Without it, a status reminder attaches to the task's card when exactly one is on the board, and any other reminder stands alone below what is on the board.
6. **Where it rings, said plainly.** A reminder rings in the web app for whoever has the board open, as a hand-set one does; a status reminder is checked only while a tab of the board is open. The tool description says so, so the agent does not promise a message to the person's phone.
7. **Limits.** At most 50 waiting timers on a board at a time, people's included, so a looping agent cannot fill it with reminders. A timer marked done no longer counts. Only the API is held to it: the web app has no limit, and an API call that would pass 50 is refused with `409`. A reminder in the past is refused.
8. **Reads.** Timer elements in a read gain `repeat`, `watch` (`{key, source, status, changed_to}`) and `done`, next to the `note`, `due_at` and `attached_to` they have.
9. **Change and removal.** `update_elements` changes the `note`, `at` and `repeat` of a reminder the API added; `remove_elements` removes it. A person's timers stay theirs.

## Requirements

- **FR-001**: A key MUST rename a board it may write; MCP MUST offer `rename_board` to `write` keys.
- **FR-002**: Element changes and additions MUST take `bold`, `size`, `opacity`, `rotation`, `stroke` and `dash` for the kinds Decision 2 names and refuse them elsewhere.
- **FR-003**: A key MUST change colour and style of any element on a board it may write ; text and removal MUST stay limited as spec 046 FR-010 says.
- **FR-004**: Reads MUST return set style fields and the timer fields of Decision 8.
- **FR-005**: `add_reminder` MUST make a clock or a status timer as the web app stores it, attached as Decision 5 says, and MUST refuse a past moment, both or neither of `at` and `task`, an unreadable task, and a 51st waiting timer.

## Testing

- **Domain tests**: each style field on each kind, allowed and refused; style on a person's element allowed, text on it refused; rotation folded into -180..180; rename limits; a clock timer with each repeat; a status timer with and without `status`; attach to a given element, to the one card of a task, standalone when two cards show it; the limit of 50 waiting timers, done ones not counted; a past moment.
- **Frontend check**: a board with API-made reminders and styles opens and rings as hand-made ones do (`timer.test.ts` shapes reused as fixtures).
- **API tests**: rename on a read-only key and on a viewer's board refused; styles round-trip through a read.
- **MCP tests**: a `write` key lists `rename_board` and `add_reminder`; a `read` key does not.
- **Contract test**: the OpenAPI snapshot grows only by additions.
- **By hand**: Claude Code against a local stack: "rename the board to Sprint 12 and make the frame titles bold", "remind me in 10 minutes", "tell me when DEMO-2 leaves In progress"; the timer rings in the open tab. Recorded in the slice PR.
- `make check`, `make smoke`.

## Slices

1. `api-tidy`: Decisions 1–4, `rename_board`; guide pages `api.md` and `ai-agents.md`; key dialog line; CHANGELOG.
2. `api-reminders`: Decisions 5–9, `add_reminder`; guide; CHANGELOG.

## Notes for the plan

- Styles are data keys of the stored node: `frontend/src/canvas/types.ts` (`StickyData`, `ShapeData`, `TextData`, `FrameData`, `Faded`, `Turned`); left out until set, so older boards keep their look. The backend map is `_STYLES` and `_restyle` in `domain/batch.py`; the ownership check `_own` moves out of the style path.
- Timer data: `TimerData` and `watchStatus` in `frontend/src/timers/timer.ts`; attaching is `parentId` plus `BESIDE` in `attach.ts`. `HOLDERS` there is the list of kinds a timer attaches to.
- Rename: `service.rename_board` in `domain/boards.py`, which also ends public sessions so guests read the new name.

## Out of scope

- Reminders delivered without an open tab: push, e-mail, a message to the agent.
- Text of people's elements, and removing them.
- Pictures, stickers, votes, reactions, folders, stars, trash, duplicate and delete a board.
