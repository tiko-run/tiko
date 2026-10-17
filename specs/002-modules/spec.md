# Feature Specification: Modules and the Gantt module

**Feature Branch**: `002-modules`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "Templates like in Miro, but interactive modules, not shapes. A module host that scales to new kinds; the first module is a Gantt chart: change dates and ranges, put our tasks in it, stretch and enlarge it, add quarters and milestones, draw dependency lines." Plan dates live on the board only (no writes to Jira).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a module from the picker (Priority: P1)

The lead opens the module picker from the bottom toolbar or the right-click menu and sees the available modules as a small gallery with name, icon and one-line description. They pick Gantt, and a Gantt block appears on the board, ready to use. It moves, resizes, copies, deletes and undoes like any other element, and survives reload.

**Why this priority**: The host is what makes later modules cheap. Without it, Gantt is a one-off widget.

**Independent Test**: On an empty board, open the picker, add a Gantt, move and resize it, copy-paste it, undo, reload: the board is the same. Adding a second module kind later needs no change to the board model, the picker or the canvas.

**Acceptance Scenarios**:

1. **Given** an open board, **When** the user opens the module picker from the toolbar, **Then** they see every registered module with icon, name and description.
2. **Given** the picker, **When** the user picks Gantt, **Then** a Gantt module appears at the viewport center (or at the clicked point when opened from the right-click menu) with sensible defaults.
3. **Given** a module on the board, **When** the user moves, resizes, copies, pastes, deletes or undoes, **Then** it behaves like a frame or a sticky note.
4. **Given** a board with modules, **When** the user reloads, **Then** every module comes back with the same position, size and content.
5. **Given** a board saved by a newer tiko with a module kind this version does not know, **When** it is opened, **Then** the module is shown as a placeholder with its kind name and is saved back unchanged.

---

### User Story 2 - Shape the Gantt timeline (Priority: P1)

The lead sets the time range of the Gantt, switches the scale between days, weeks, months and quarters, names the module, and sees a header with months and quarters and a line for today. They extend the range by a quarter on either side and stretch the block wider to give each day more room.

**Why this priority**: The timeline is the frame for everything else in the module.

**Independent Test**: Add a Gantt, switch scales, add a quarter at the start and at the end, resize the block: the header shows correct quarters and months, today's line sits on today's date at every scale, reload keeps it all.

**Acceptance Scenarios**:

1. **Given** a new Gantt, **When** it appears, **Then** it shows the current quarter at week scale with a quarter and month header and a today line.
2. **Given** a Gantt, **When** the user switches the scale to day, week or month, **Then** the grid and header redraw for that scale and the range stays the same.
3. **Given** a Gantt, **When** the user presses "+ quarter" at the start or at the end, **Then** the range grows by one calendar quarter on that side.
4. **Given** a Gantt, **When** the user sets start and end dates in the module settings, **Then** the range changes; an end before the start is rejected.
5. **Given** a Gantt, **When** the user resizes the block horizontally, **Then** the same range spreads over the new width.

---

### User Story 3 - Plan live tasks on the Gantt (Priority: P1)

The lead drags a Jira card from the board into the Gantt, or adds a task by key or a plain text row inside it. Each becomes a bar with the task's key, title and live status color. They drag a bar to move it in time and drag its ends to change start and end, snapping to whole days. Bars of closed tasks are struck through, like cards.

**Why this priority**: This is the value over a static Miro template: the plan is made of live tasks.

**Independent Test**: Drop two cards into a Gantt, add one plain row, move and stretch the bars, change one task's status at the source: the bar color updates within a minute. Reload: bars keep their dates.

**Acceptance Scenarios**:

1. **Given** a Gantt and a card on the board, **When** the user drops the card onto the Gantt, **Then** the card becomes a row with a bar starting at the drop date, one week long by default, and leaves the board.
2. **Given** a Gantt, **When** the user adds a task by key or URL in the module, **Then** a row with a live bar appears; an unknown key shows the same errors as adding a card.
3. **Given** a Gantt, **When** the user adds a plain text row, **Then** a row with an editable title and a neutral bar appears.
4. **Given** a bar, **When** the user drags it or one of its ends, **Then** the dates change in whole days and the end never goes before the start.
5. **Given** a task row, **When** the task's status changes at the source, **Then** the bar shows the new status within the board's refresh interval, and a done task is struck through.
6. **Given** a row, **When** the user drags it out of the Gantt onto the board, **Then** a task row becomes a card again at that point and a plain row becomes a sticky note; the row can also be deleted.
7. **Given** rows, **When** the user drags a row up or down, **Then** the row order changes.

---

### User Story 3b - Group rows in a tree (Priority: P1)

The lead nests rows under rows: a task under a plain row, a plain row under a plain row, a plain row under a task, several levels deep. A row with children keeps its own dates, its bar always covers its children, and it can be collapsed.

**Why this priority**: A plan is a hierarchy (stage, sub-stage, tasks). A flat list of bars does not read as a plan.

**Independent Test**: Make a stage row, put two tasks and a plain row under it, put a task under that plain row, collapse and expand the stage, move a child bar: the summary bar follows. Delete the stage: its children stay, one level up. Reload: the tree is the same.

**Acceptance Scenarios**:

1. **Given** rows, **When** the user drags a row label onto a new place and to the right, or presses indent, **Then** the row with its whole subtree becomes a child of the row above; outdent and dragging left move it up a level.
2. **Given** a row, **When** the user presses "+" on it, **Then** a new plain row appears as its last child, ready to be named.
3. **Given** a row with children, **When** the user looks at it, **Then** its bar covers its own dates and all its descendants and grows when a child moves past it; dragging it moves the whole branch by whole days, and stretching its ends changes its own dates but never cuts off a child.
4. **Given** a row with children, **When** the user collapses it, **Then** its descendants are hidden and the state survives reload.
5. **Given** a row with children, **When** the user deletes it or drags it out of the module, **Then** its children move one level up and stay in the plan.
6. **Given** a card dropped between rows, **When** it lands, **Then** it becomes a sibling of the row above it.

---

### User Story 4 - Milestones and dependency lines (Priority: P2)

The lead adds milestones (a date with a title, shown as a diamond and a vertical line) and connects bars with dependency lines ("A must finish before B starts").

**Why this priority**: Turns a list of bars into a plan with checkpoints and order. Useful, but the module already helps without it.

**Independent Test**: Add two milestones, rename and move one, connect two bars, move the first bar: the line follows. Delete a row: its lines go away. Reload: all kept.

**Acceptance Scenarios**:

1. **Given** a Gantt, **When** the user adds a milestone, **Then** a diamond with an editable title and a vertical line appears on the chosen date, and it can be dragged along the timeline in whole days.
2. **Given** two bars, **When** the user drags from the end of one bar to another bar, **Then** a dependency line connects the end of the first to the start of the second and follows both when they move.
3. **Given** a dependency where the second bar starts before the first ends, **When** the user looks at it, **Then** the line is drawn in the warning color.
4. **Given** a row or a line, **When** the user deletes it, **Then** lines attached to a deleted row go with it.

---

### User Story 5 - Expand a module over the board (Priority: P2)

The lead opens a Gantt over the dimmed board to work on a long plan at a readable size, then goes back to the board where it was.

**Why this priority**: A plan of a quarter or more is hard to read inside a block on the canvas. Any module that needs the whole screen gets the same view.

**Independent Test**: Expand a Gantt of three months on the Days scale: day numbers read, the timeline scrolls sideways under the task column, the view opens on today. Drag a bar two days, press Backspace, undo, press Esc: the bar is back, the module is still on the board.

**Acceptance Scenarios**:

1. **Given** a module that can expand, **When** the user clicks Expand in its header or the selection bar, **Then** it opens over the dimmed board with its title, its controls and a Collapse button.
2. **Given** an expanded Gantt, **When** its range does not fit, **Then** each day keeps a readable width for the scale and the timeline scrolls sideways, with the filters, the date header and the task column kept in view.
3. **Given** an expanded module, **When** the user edits it, **Then** the block on the board changes the same way, undo and redo work, and Backspace never deletes the block behind.
4. **Given** an expanded module, **When** the user presses Esc outside a field or clicks Collapse, **Then** the board is back as it was.
5. **Given** a viewer of a shared board, **When** they expand a module, **Then** they scroll it but cannot change it.

### Edge Cases

- A module bigger than the screen: the canvas pans and zooms over it like over a frame; scroll inside the module is not used, the module grows instead.
- Range up to 3 years; a longer range is rejected with a hint to split the plan.
- Up to 200 rows and 100 milestones per Gantt; a 2000-element board limit still applies to the board as a whole.
- The same task in two Gantts or in a Gantt and as a card: allowed, all show the same live data.
- A task row whose task is gone at the source shows the same "not found" state as a card.
- Bars outside the range are clipped at the range edge with an arrow hint.
- Time zones: dates are calendar days without time; today is the browser's local date.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The board supports a generic module element. Each module has a kind and its own content, validated per kind on save.
- **FR-002**: Adding a new module kind takes one frontend module folder and one backend content schema registered in one place; the board model, picker, canvas, clipboard and history need no change.
- **FR-003**: The picker lists every registered module and is reachable from the bottom toolbar and the right-click menu.
- **FR-004**: Modules move, resize, copy, paste, delete, undo and redo like other elements, and are not nested in frames or in each other in this feature.
- **FR-005**: An unknown module kind is kept and shown as a placeholder, never dropped.
- **FR-006**: Gantt has a title, a range (start and end calendar dates), a scale (day, week, month, quarter), a resizable task column, a quarter and month header, a today line and "+ quarter" controls on both sides.
- **FR-007**: Gantt rows are either a task (live, by key) or plain text, each with start and end dates; bars snap to whole days.
- **FR-008**: Task keys inside Gantt modules are refreshed together with card keys of the open board, in the same batched request.
- **FR-009**: Cards move into a Gantt by drop and out of it by dragging a row onto the board.
- **FR-009b**: Gantt rows form a tree up to 5 levels deep; a row with children shows a bar covering its own dates and its descendants and can be collapsed.
- **FR-010**: Gantt has milestones (date, title) and finish-to-start dependency lines between rows.
- **FR-011**: Plan dates live only on the board and are never written to the tracker.
- **FR-011b**: A module kind may open expanded over the dimmed board at 1:1 scale; the view edits the same block, and the module decides how to fill and scroll the space.
- **FR-012**: The module follows `DESIGN.md` tokens in light and dark themes.

### Key Entities

- **Module**: a board element with kind, position, size and kind-specific content.
- **Module kind**: a registered type with name, icon, description, default size and content, content schema and view.
- **Gantt content**: range, scale, rows, milestones, dependencies.
- **Row**: id, task key or text title, start, end, optional parent row, collapsed flag.
- **Milestone**: id, date, title.
- **Dependency**: id, from row, to row.

## Success Criteria *(mandatory)*

- **SC-001**: From an empty board, the lead builds a Gantt with 5 live tasks, a milestone and a dependency in under 3 minutes without docs.
- **SC-002**: A status change at the source shows on the Gantt bar within the refresh interval, like on a card.
- **SC-003**: A board with a Gantt of 100 rows pans and zooms without visible stutter on a 2020 laptop.
- **SC-004**: A second module kind can be added by a contributor touching only its own folder, the backend schema registry and a test.

## Assumptions

- Dates are plan dates on the board. Reading Jira due and start dates is a separate later feature.
- Week starts on Monday; quarters are calendar quarters.
- Gantt is the only module in this feature; the picker shows one item until more exist.

## Out of scope

- Writing dates, statuses or links back to Jira (Won't in brief: two-way sync).
- Reading Jira due and start dates, sprints, versions (later feature).
- Critical path, auto-scheduling, resource load, baselines.
- Modules nested in frames or other modules.
- Other module kinds (kanban, roadmap, matrix): only the host is made ready for them.
