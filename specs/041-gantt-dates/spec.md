# Feature Specification: Gantt bars follow tracker dates

**Status**: Draft, waits for G2.

**Input**: People asked for Gantt rows to take their dates from the tracker. Today a row planned from a task has its own start and end, typed or dragged in tiko, and the task's dates in the tracker are not read at all. Trackers keep dates differently, a task often has a due date and no start, and tiko only reads from trackers.

## Why

- A plan built in tiko drifts away from the dates the team keeps in the tracker, and nobody sees it until the deadline.
- Retyping every due date into the Gantt is double work that people skip.
- Which fog does this clear: the plan shows the dates the tracker holds, and where the plan and the tracker disagree, the board says so.

## Decisions

1. **A task carries two optional dates.** `start` and `due`, each a calendar day or nothing, and the tracker's own id of the field each came from (`duedate`, `customfield_10015`, `milestone`, `DTSTART`). The Gantt and the rest of the board see only these two dates and never a tracker's fields; the id is kept so a later write-back writes into the same field it read from. A start after the due is dropped for every tracker alike.
2. **Each tracker adapter maps its own fields.** The mapping belongs to the source, not to a workspace or a board: two Jira sites, or two Jira projects with different fields, never share one setting by accident.
   - Jira (Data Center and Cloud): `due` is the system field `duedate`, the same on every site. `start` has no system field, so the adapter finds the site's custom date fields named `Start date` or `Target start` (case ignored) and asks for all of them. For each task the first field in that order that has a value wins, so projects that fill different fields work without any setting.
   - GitHub: an issue has no dates of its own. `due` is the due date of the issue's milestone; `start` stays empty.
   - Demo: sample tasks get both dates, some only a due date and some none, so every case can be seen without a tracker.
   - Trackers added later (CalDAV `DTSTART` / `DUE`, Plane, Linear) fill the same two dates in their adapter.
3. **A Jira admin can pick the start field.** Settings → Jira gets a Start date field choice: Auto (the rule above, the default) or one of the site's date fields. Due always stays `duedate`. A choice per Jira project is not built: the first-filled rule covers mixed projects, and a per-project choice waits for someone who needs it.
4. **A row either follows the tracker or keeps its own dates.**
   - A row added from a task follows the tracker.
   - Rows that already exist keep their own dates, so nobody's plan moves when the release lands. Each shows the difference (Decision 7) and can be switched to follow.
   - A plain row without a task always keeps its own dates.
   - The row's menu switches between Follow tracker dates and Keep own dates.
5. **A missing date is filled in, never left open.** An endless bar breaks the scale and claims a date nobody set.
   - Both dates: the bar runs from start to due.
   - Due only: the bar ends on the due date and starts a week before it.
   - Start only: the bar starts on the start date and ends a week after it.
   - Neither: the bar keeps the row's own dates and the label says the tracker has no dates.
   - A start after the due is taken as due only.
   - The filled-in end is drawn faded with a dashed edge, and the tooltip says it is a guess, so a guess never passes for the tracker's date.
6. **Dragging a following bar takes it off the tracker.** The dragged dates become the row's own dates, and the row stops following. A toast says so with Undo, which puts the row back on the tracker's dates. Nothing is written to the tracker: tiko still only reads.
7. **The board shows where the plan and the tracker disagree.** A row with its own dates whose task has different dates in the tracker gets a dashed frame where the tracker has the task, drawn over the row and never in the bar's way. The bar's tooltip names the tracker's dates; a click on the frame shows them with Follow tracker dates. A dot was tried first and dropped: the link handle at the bar's end covered it. The frame is the place where a later write-back offers to send the row's dates to the tracker.
8. **A following bar moves when the tracker changes.** When a refresh brings new dates, the bar moves for everyone on the board. The board saves the dates it shows, so a public link guest and an export see the same bar as the team.
9. **A parent row keeps spanning its children, and a row with stages keeps its stages.** Tracker dates move neither: a parent follows its children, and Planning stages are a plan of people that a date changed in the tracker must not reshuffle unseen. A row stops following when it is cut into stages. Both show the frame of Decision 7. How stages could follow the tracker is left for a later spec.

## Requirements

- **FR-001**: A task MUST carry an optional `start` and `due` day and the id of the field each came from; the API answer gains these fields and nothing else changes. Older clients ignore them.
- **FR-002**: The Jira adapters MUST read `due` from `duedate` and `start` from the first filled field of the site's `Start date` and `Target start` date fields, unless the admin chose one field in Settings → Jira.
- **FR-003**: The GitHub adapter MUST read `due` from the issue's milestone due date.
- **FR-004**: The demo adapter MUST give its sample tasks both dates, a due date only, or none.
- **FR-005**: A Gantt row MUST store whether it follows the tracker; a row added from a task MUST follow it, and a row saved before this feature MUST keep its own dates. Older boards read unchanged.
- **FR-006**: A following row MUST draw its bar from the task's dates by the rules of Decision 5, with the filled-in end faded and dashed and named a guess in the tooltip.
- **FR-007**: Dragging or resizing a following bar MUST switch the row to its own dates with a toast and Undo; nothing MUST be sent to the tracker.
- **FR-008**: A row with its own dates whose task's dates differ MUST show the frame of Decision 7 with the tracker's dates and a way to follow them, with Planning on and off.
- **FR-009**: When a refresh changes a task's dates, every following bar of that task MUST move for everyone on the board, and the board MUST save the new dates.
- **FR-010**: A parent bar MUST keep spanning its children, and a row with stages MUST keep its stages, whatever the task's dates are; a row cut into stages MUST stop following.

## Slices

1. `task-dates`: FR-001 – FR-004. The two dates on a task, the Jira field rule and the Settings choice, GitHub milestones, demo dates, the dates in a card's details.
2. `gantt-follow`: FR-005 – FR-010. Following rows, filled-in ends, taking a bar off the tracker by dragging, the difference mark, moving on refresh, the guide and the changelog.

## Out of scope

- Writing dates back to the tracker. It is the next spec and needs write permission on people's tokens; this spec keeps the field names it needs.
- A field choice per Jira project.
- GitHub Projects date fields: they need the GraphQL API and a project scope on the token.
- More than one Jira site per instance: the mapping is per source, so a second site gets its own when that lands.
- Sprint dates as a stand-in for task dates.
- Stages that follow the tracker's dates.
- Time of day: a tracker's date-time is read as the day the tracker wrote, whatever the offset after it. CalDAV takes the day in the instance's time zone, as spec 040 says.
