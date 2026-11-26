# Feature Specification: Smooth Gantt row drag and multi-row selection

**Status**: Approved at G2 on 2026-11-21, all seven open questions answered as recommended.

**Input**: Reordering a Gantt plan is guesswork. While a row is dragged in the task column, only its label slides under the pointer: the other rows do not move out of the way, there is no mark of where it will land or at which level, and the result shows only on release. A plan is rearranged a few rows at a time, so moving five rows means five such drags. People asked for two things: rows that make room while one is dragged, and a way to select several rows (a lasso, Shift and Cmd-click) and drag them as one batch.

## Why

- Which fog does this clear: "where does this go in my plan?" Rearranging a plan by hand is how a lead thinks it through; when every drag is a guess, they stop arranging and the plan stays in the order the rows were added.
- What this spec does not give: moving the dates of several rows at once, indenting or outdenting a selection with buttons or keys, copy and paste of rows, moving rows between two Gantts. Those are separate ideas.

Principles check:

| Principle | How the feature passes it |
|---|---|
| Truth | Row order and nesting are tiko's own plan; nothing is written to the tracker, and task rows keep showing what the tracker says. |
| Clarity | "Drag rows; the others make room and show where they land." |
| A fresh angle | Not the goal here: this is about controls. The controls stay familiar, as the principle asks: drag, Shift and Cmd-click, a lasso, Esc and Undo work the way hands expect from a file list. |
| Room to arrange | The whole feature: rearranging a plan by hand becomes fast enough to do while thinking. |
| Calm | Motion only while the person drags, short (150ms) and off under reduced motion. Nothing moves by itself. |
| Trust | Undo takes a whole drop back in one step; Esc cancels a drag halfway; a selection never deletes the Gantt by accident. |

## Today

What the code does now (`GanttLabel.tsx`, `GanttModule.tsx`, `tree.ts`):

1. **Start.** A press on a row label, not on a link, button or field, captures the pointer. A move of more than 4 screen pixels starts a drag. Viewers cannot drag: the module body ignores their pointer.
2. **During the drag.** Only the pressed label moves: it follows the pointer on both axes with a shadow on `--card`. The other labels, the field columns (Planning) and the bars in the timeline stay where they are. The children of a dragged parent stay in place even though they will move with it. Nothing marks the place or the level it will drop at. There is no auto-scroll: in the expanded view the list does not scroll at an edge, and on the board the module shows every row with no inner scroll, so a far place needs zooming out first.
3. **Drop inside the module.** The vertical distance is rounded to whole rows (`round(dy / rowHeight)`), the horizontal one to levels (`round(dx / 16)`). The dragged row's subtree, hidden children of a collapsed row included, is taken out of the visible list; the row lands before the visible row at "its old index plus the rows moved", counted in that shortened list. So a parent with three open children dragged one row down jumps past the next row outside its branch, although on screen its label only passed over its own child. The asked depth is clamped by `moveSubtree` between the depth of the row below and one level under the row above. A drop that would nest deeper than 5 levels does nothing, silently.
4. **Collapsed target.** A row dropped as the child of a collapsed row lands inside it and disappears from view.
5. **Filters.** With filters on (Planning), places are counted among the shown rows; hidden rows keep their place.
6. **Drop outside.** On the board, a drop outside the module puts the row back on the board as a card (task) or a sticky note (plain row). A parent takes its whole branch along, as a drag inside the plan does: its rows land under it in plan order (amended for issue 401; children used to stay one level up). In the expanded view a drop outside does nothing.
7. **Esc** does not cancel a drag. In the expanded view it closes the view in the middle of the drag; on the board it switches to the Select tool and the drag goes on.
8. **One row at a time.** Rows cannot be selected. A click on a label does nothing; a double-click renames a plain row. A click inside the module selects the module on the board, so Backspace there deletes the whole Gantt (Undo brings it back).
9. **Undo and live.** A drop is one change of the module's content: one Undo step, sent to others as the whole content (spec 009, last writer wins). Nothing is sent while dragging.

## Decisions

### Drag (slice 1)

1. **The dragged rows lift out and the plan closes up.** When a drag starts, the dragged row and every row under it (its whole subtree, as today) lift out of the list in all three parts of the row: label, field columns and timeline. The rows that stay close the hole in 150ms ease-out. A ghost follows the pointer in the label column: the dragged labels stacked as they look, up to 5, then "+ N more"; on `--card` with the drag shadow it has today.
2. **A gap opens where they will land.** As the pointer moves, the rows under the ghost slide apart to open a gap as tall as the lifted rows, across the whole width of the Gantt. Where the gap is, is where the rows land. The place is picked by the ghost's top edge, to the nearest gap between the rows that stay. Rows change places only when the pointer crosses half a row, so the plan does not flicker.
3. **The gap shows the level.** In the task column the gap holds a placeholder (`--accent` fill, 1px dashed `--primary` at 40%) starts at the indent of the level the rows will take. Moving the pointer right or left by 16px changes the level by one, as today, and the placeholder slides to the new indent in 100ms. When the rows would become children, the row that will be their parent gets a 2px `--primary` bar at its left edge. The level is clamped as today (no shallower than the row below the gap, no deeper than one level under the row above, 5 levels in all) and the placeholder always shows the clamped level, so what it shows is what lands.
   - When no level fits (a deep branch into a deep gap), the placeholder turns `--destructive` dashed with "Too deep: 5 levels at most", and a drop there puts the rows back.
   - Rejected: a thin line between rows instead of a gap. A line does not show how much room a branch takes, and rows that move aside were asked for.
4. **Dropped as a child of a collapsed row, the row opens**, so the rows stay in view. Hovering over a collapsed row during a drag does not open it.
5. **The drop settles.** On release the ghost glides into the gap (150ms) and the plan is drawn in its new order with no jump: the gap already had the room of every lifted row.
6. **Auto-scroll.** In the expanded view the list scrolls while the pointer is within 40px of the top or bottom edge of the scrolling area (under the sticky header), faster closer to the edge. On the board the module has no inner scroll, so the board pans in the same way when the pointer is within 40px of the window edge, as when an element is dragged on the board.
7. **Esc cancels.** Esc during a drag puts the rows back where they were (150ms) and writes nothing. In the expanded view the first Esc ends the drag, the view stays open. The same happens when the browser cancels the pointer or the window loses focus.
8. **Out of the module.** On the board, when the pointer leaves the module, the gap closes and the ghost reads "Drop on the board" under its labels; a drop there works as today (Today, 6). In the expanded view a pointer outside the plan closes the gap too and a drop there puts the rows back, as today.
9. **Links and the rest during a drag.** Dependency lines fade out while rows move (100ms) and come back after the drop: they would point at old places. Milestones, the today line and the Time off lane stay. Bars of the rows that stay move with their rows.
10. **Filters.** The gap opens only between shown rows; hidden rows keep their place, as today. The place and level are worked out by the same function that makes the drop, over the whole plan, so a row hidden by a filter never changes what the placeholder shows.
11. **Reduced motion.** Under `prefers-reduced-motion` nothing glides: rows jump to their places, the gap and the placeholder still show.

### Select and move many (slice 2)

12. **Select by click.** A click on a row label (a press with no drag) selects that row alone. Cmd-click (Ctrl-click on Windows and Linux) adds or removes one row. Shift-click selects every shown row between the last clicked row and this one. A click on the chevron, a checkbox, a hover button or the title field does what it does today and leaves the selection alone. A double-click still renames a plain row.
13. **Select by lasso.** A press on blank space in the task column starts a lasso: right of a row's title, or in the empty band under the last row. Dragging draws the board's selection box, clipped to the task column, and selects every row it touches, as the board's box does since spec 036. Shift or Cmd while lassoing adds to the selection. The list auto-scrolls and the board pans at the edges as in Decision 6. A press on the grip, type icon, key or title drags the row, as today; the cursor shows which one a press will do (grab over the row's content, the arrow over blank space).
    - The lasso never starts the board's own selection box and never pans the board: the module body already carries `nodrag nopan`, the lasso stops the press from reaching the board, and the task column carries `nokey`, so with Shift held the board does not take the press for its own Shift box. A Shift or Cmd click in the task column does not toggle the Gantt out of the board's selection either.
    - Blank space between the hover buttons of a row counts as blank too: at the default column width the buttons cover most of the room right of a title.
14. **The look.** A selected row is tinted with `--primary` at 10% across its whole width: label, field columns and timeline.
15. **Drag a selection.** A drag that starts on a selected row moves every selected row; a drag that starts on a row outside the selection selects that row alone and moves it, as in a file manager.
    - **A parent carries its branch.** A selected row brings its whole subtree, selected or not. A selected child of a selected parent simply rides with the parent.
    - **A child alone leaves its parent.** A child selected without its parent moves on its own, with its own subtree; the parent and the siblings stay.
    - **Order.** The moved branches land one after another in the order they had in the plan, even when the selection had gaps.
    - **Level.** Every moved branch takes the level the placeholder shows; each keeps the shape of its own subtree. A selection of rows from different levels becomes siblings. Rejected: keeping each row's level relative to the others; without their parents in between, those levels have nothing to hang on.
    - **Too deep.** The level is clamped so the deepest moved branch still fits in 5 levels; when nothing fits, Decision 3 applies.
16. **Several rows out to the board.** A selection dropped outside the module on the board becomes cards and sticky notes in a column from the drop point, 16px apart, in plan order. A parent takes its branch along, as in Decision 6; before the drop the ghost reads "N rows to the board", counting every row that leaves, branches included.
17. **Delete removes the selected rows, not the Gantt.** While rows are selected, Delete and Backspace remove them, each as the row's remove button does today (children stay one level up). With no rows selected they act on the board's selection as today.
18. **The selection ends** with Esc (in the expanded view the first Esc clears it, the next closes the view), a click on blank space without a drag, or when the module stops being selected on the board. A row that leaves the view (a filter, a collapse, someone else deleting it) leaves the selection. The selection belongs to this tab only: it is not stored, not sent to others and not in Undo. The expanded view starts with its own, empty one.

### Everyone

19. **Undo and live.** A drop, a several-row eject and a Delete are each one change of the module and one Undo step; ejected cards and notes come back with the same step. Nothing is sent while dragging. Others see the new order when the drop lands, as today. If someone else edits the same Gantt during a drag, the gap follows their change; a dragged row they delete drops out of the drag, and if none is left the drag ends. Two people dropping into the same Gantt at the same moment: the later write wins (spec 009).
20. **What rides with a row.** A row keeps everything it holds when it moves: dates, follow, done, Planning stages with their people, its own field values, its links. Values a row inherited in a field column now come from its new parent. A moved leaf keeps its stages; a row that becomes a parent keeps its stages hidden as today (spec 027).
21. **Viewers** cannot drag or select, as today.
22. **Speed.** A Gantt of 200 rows (the limit) with stages, Planning on, drags and lassos at 60 fps on the reference laptop of spec 019, the budget of spec 027 Decision 12; with the CPU slowed four times a drag costs no more frames than moving the pointer over the plan does. The main chunk grows by at most 3 KB gzipped. No new dependency.
    - Measured at slice 1 on a plan of 200 rows with 12 stages each: 20 stages on every row do not fit the Gantt's 256 KB content limit, 12 is the most that imports. The result is in the slice's PR text.
23. **API and MCP.** Nothing to open: row order and nesting are written through the Gantt's content, and writing the Gantt through API v1 is not offered yet (spec 047, out of scope there). When it is, moving rows comes with it. A selection is the person's own view of the moment and is closed by design.

## Scenarios

### Slice 1: smooth drag

Anna drags "Payment API" from the bottom of a 30-row plan towards the top. As soon as it lifts, the row's place closes. The rows under the ghost slide apart, and a dashed placeholder sits where it will land. She moves right a little: the placeholder steps in one level and "Checkout" above it gets a blue bar, so it will be its child. She releases; the row settles into the gap with no jump. One Undo puts it back.

**Independent test**: expanded Gantt of 40 rows, three levels. Drag a parent with two open children down past four rows: the three labels ride in the ghost, the gap is three rows tall, the bars move with their rows. Step right and left: the placeholder's indent follows and stops at the allowed levels. Drop: the branch is where the placeholder was. Undo: back in one step. Drag to the bottom edge: the list scrolls. Press Esc mid-drag: rows go back, the view stays open, nothing is written.

1. **Given** a drag, **When** the ghost passes half a row, **Then** that row slides out of the way in 150ms.
2. **Given** the placeholder at a level, **When** the row is dropped, **Then** it lands at that place and level, with filters on or off.
3. **Given** a gap under a collapsed row, **When** the row is dropped as its child, **Then** the collapsed row opens and shows it.
4. **Given** a branch that would be 6 levels deep, **Then** the placeholder is red with "Too deep", and a drop puts the rows back.
5. **Given** a drag, **When** Esc is pressed, **Then** the rows go back and nothing is written; in the expanded view the view stays open.
6. **Given** the board, **When** the pointer leaves the module, **Then** the gap closes, the ghost reads "Drop on the board", and a drop makes a card or a sticky note as today.
7. **Given** reduced motion, **Then** rows jump and the gap and placeholder still show.

### Slice 2: select and move many

Anna clicks "Design review", Shift-clicks "QA pass" four rows down and Cmd-clicks "Release notes" further down. Five rows are tinted. She drags one of them to the top: one ghost with five labels, one gap, and the five rows land together in their old order. She lassoes three rows from the blank space right of their titles and presses Backspace: the three rows go, the Gantt stays.

**Independent test**: select by Shift-click, Cmd-click and lasso, with a parent and one of its children both selected and a child selected without its parent. Drag the selection: the parent brings its branch, the lone child leaves its parent, everything lands in plan order at the placeholder's level. Undo: one step. Drop the selection on the board: cards and notes in a column, one Undo brings them back into the plan. Backspace with rows selected removes the rows, not the module.

1. **Given** rows, **When** a row is clicked, Cmd-clicked or Shift-clicked, **Then** the selection is that row, adds or removes it, or spans to it.
2. **Given** a press on blank space in the task column, **When** the pointer drags, **Then** a lasso selects the rows it touches, and the board neither pans nor starts its own box.
3. **Given** a selection with gaps and mixed levels, **When** it is dragged, **Then** the rows land together in plan order as siblings at the shown level, each parent with its branch.
4. **Given** a drag that starts on an unselected row, **Then** that row alone is selected and moved.
5. **Given** a selection, **When** Delete or Backspace is pressed, **Then** the rows are removed in one Undo step and the Gantt stays.
6. **Given** a selection, **When** it is dropped on the board, **Then** each selected row becomes a card or a note, and one Undo returns them all.
7. **Given** a selection, **When** Esc is pressed or the module is deselected, **Then** the selection clears.

## Requirements

- **FR-001**: While a row is dragged, the rows that stay MUST move aside to open a gap where it will land, in the label, field and timeline parts of the row.
- **FR-002**: The gap MUST show the level the rows will take; a drop MUST land exactly where the gap shows; a place that does not fit MUST be shown and MUST NOT change the plan.
- **FR-003**: A drop as the child of a collapsed row MUST open that row.
- **FR-004**: The list MUST auto-scroll in the expanded view, and the board MUST pan, when the pointer nears an edge during a drag or a lasso.
- **FR-005**: Esc, a cancelled pointer and a lost window focus MUST end a drag with nothing written; in the expanded view Esc MUST NOT close the view while it ends a drag or clears a selection.
- **FR-006**: Editors MUST select rows by click, Cmd or Ctrl-click, Shift-click and a lasso from blank space in the task column; the lasso MUST NOT start the board's selection box or pan the board.
- **FR-007**: Dragging a selection MUST move every selected row with its subtree, in plan order, at the shown level, as one Undo step.
- **FR-008**: A selection dropped on the board MUST become cards and notes in one Undo step.
- **FR-009**: Delete and Backspace with rows selected MUST remove those rows and MUST NOT delete the module.
- **FR-010**: The selection MUST stay local to the tab and MUST NOT be stored or sent.
- **FR-011**: Motion MUST be off under reduced motion; 200 rows with 20 stages MUST drag at 60 fps on the reference laptop.

## Testing

- **Unit tests** (`tree.ts`, new `drag.ts`): place and level from the ghost position over a plan with collapsed rows, filters and depth limits; moving several branches with gaps, mixed levels, a parent with a selected child, a lone child; opening a collapsed target; content unchanged when nothing fits.
- **Component tests**: a drag opens the gap and moves rows in all three parts; the placeholder indent follows the pointer; drop lands where shown; Esc writes nothing and keeps the expanded view open; Undo is one step; click, Cmd-click, Shift-click and lasso select; a lasso press does not reach the board; Delete removes rows and not the module; a several-row eject and its Undo; viewers cannot select.
- **By hand**: both slices on the local stack, on the board and expanded, light and dark, reduced motion; a 200-row plan with 20 stages each, Planning on, in the performance panel at 1x and 4x slowdown, the numbers in the PR. Two browsers on one board: a drop in one shows in the other, and a delete in the other during a drag in the first ends cleanly.
- `make check`. No API answer changes, so no `make smoke` change.

## Slices

1. `gantt-row-drag`: Decisions 1–11, 19–23 for one row and its branch; guide `gantt.mdx`; CHANGELOG.
2. `gantt-row-select`: Decisions 12–18, multi-row drag, eject and Delete; guide `gantt.mdx`; CHANGELOG.

Media for What's new are shot at release, not in a slice.

## Out of scope

- Moving the dates of several selected rows together, or dragging their bars as one.
- Indent, outdent, remove or follow for a selection by buttons, keys or a menu; moving rows with the keyboard.
- Cmd+A for rows, copy, cut, paste and duplicate of rows (these keep acting on the module as today).
- Dragging rows between two Gantts, and a gap that opens when a card from the board is dragged over the Gantt.
- Opening a collapsed row by hovering over it during a drag.
- Showing others a drag while it happens, or gliding rows for them when someone else reorders.
- Tuning for touch screens: touch keeps working as pointer events do today.
- Writing the Gantt, row order included, through API v1 or MCP.

## Answers at G2

Every recommendation was taken at G2 on 2026-11-21:

1. **Lasso** starts on blank space in the task column (right of the title, below the last row); Shift and Cmd-click cover rows with long titles (Decision 13).
2. **Several levels** become siblings at the level the placeholder shows, each with its own subtree (Decision 15).
3. **Several rows on the board**: allowed, a column of cards and notes, one Undo (Decision 16).
4. **Delete with rows selected** removes the rows, never the Gantt (Decision 17).
5. **Board pan** near the window edge during a drag or a lasso: yes (Decision 6).
6. **Keyboard moves**: not now, out of scope.
7. **Selected look**: `--primary` at 10% across the whole row (Decision 14).
