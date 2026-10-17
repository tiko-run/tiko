# Feature Specification: Live Jira Canvas (MVP)

**Feature Branch**: `001-live-jira-canvas`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "tiko MVP: self-hosted infinite canvas with live Jira Data Center task cards for a single lead user." Full input: core scenario, scope and Won't items from [docs/brief.md](../../docs/brief.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Put a Jira task on a saved board (Priority: P1)

The lead starts tiko on their machine, opens it in the browser, connects it to their Jira Data Center with a base URL and a personal access token, creates a board and adds a task by its key or by pasting its link. A compact card appears with the task's type icon, key, title and status. When they come back later, the board and the card are where they left them.

**Why this priority**: This is the smallest thing that proves the product: a real task from Jira lives on a canvas the user owns. Every other story builds on it.

**Independent Test**: Start the app with no Jira connection (demo data), create a board, add a card by key, reload the page: the card is still there with the same position and data. Repeat with a real Jira DC connection.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** the user opens the app, **Then** they can create a board and use it immediately with demo task data, without entering any credentials.
2. **Given** the settings screen, **When** the user enters a Jira DC base URL and a personal access token and saves, **Then** the app confirms the connection works (or shows why it failed) and the token is never shown again in the browser.
3. **Given** an open board, **When** the user picks the "Jira card" tool in the bottom toolbar (or "Add Jira card" from the right-click menu) and enters `DEV-12`, **Then** a compact card appears at the chosen spot (viewport center for the toolbar, the clicked point for the right-click menu) showing type icon, key, title and status.
4. **Given** an open board, **When** the user pastes a Jira issue link (e.g. `https://jira.example.com/browse/DEV-12`), **Then** the key is extracted and the same card appears.
5. **Given** a board with cards, **When** the user reloads the page or restarts the app, **Then** the board reopens with every element in the same place and state.

---

### User Story 2 - Card statuses stay fresh on their own (Priority: P1)

While a board is open, the cards on it refresh from Jira automatically. When someone moves a task in Jira, the card on the board shows the new status within a minute. A closed task is struck through. The user sees when data was last refreshed and can force a refresh of all cards.

**Why this priority**: This is the main hypothesis from the brief: the lead trusts the canvas only if statuses update without manual work. Stale cards are the confirmed pain with competing tools.

**Independent Test**: Open a board with cards, change a task's status at the source (real Jira or the demo data source), wait: the card updates within 60 seconds with no user action. Press "Refresh all": all cards update at once and the indicator resets.

**Acceptance Scenarios**:

1. **Given** an open board with cards, **When** a task's status changes in Jira, **Then** the card shows the new status within 60 seconds without any user action.
2. **Given** a task moves to a done/resolved status category, **When** the board refreshes, **Then** the card's title is shown struck through.
3. **Given** an open board, **When** the user looks at the toolbar, **Then** they see an "updated N s ago" indicator that counts up and resets after each refresh.
4. **Given** an open board, **When** the user presses "Refresh all", **Then** all cards on the board are refreshed at once.
5. **Given** two boards exist, **When** only one is open, **Then** only cards on the open board are fetched from Jira.
6. **Given** the settings screen, **When** the user changes the refresh interval, **Then** automatic refreshes follow the new interval.

---

### User Story 3 - Organize tasks spatially (Priority: P2)

The lead arranges the board the way they think: draws frames to group tasks, adds sticky notes and free text, connects items with arrows, moves things around, pans and zooms over a large area.

**Why this priority**: The spatial overview is the reason the user picks a canvas over lists and kanban. It is not the first proof of value (a single card is), but without it the product is just a list.

**Independent Test**: On an empty board, draw two frames, add a sticky note and a text label, drag three cards into a frame, connect a note to a card with an arrow, move the frame: the cards and arrow move with it. Reload: everything is the same.

**Acceptance Scenarios**:

1. **Given** an open board, **When** the user pans and zooms, **Then** the view moves smoothly across an unbounded area.
2. **Given** an open board, **When** the user draws a frame and gives it a title, **Then** the frame appears and can be resized and moved.
3. **Given** a frame and a card outside it, **When** the user drags the card into the frame, **Then** the card belongs to the frame and moves with it; dragging it out releases it.
4. **Given** an open board, **When** the user adds a sticky note or a text label and types, **Then** the text is shown and kept.
5. **Given** two elements, **When** the user draws an arrow from one to the other, **Then** the arrow stays attached to both ends when either element moves.
6. **Given** several elements, **When** the user box-selects or shift-clicks them, **Then** they can move or delete them together.

---

### User Story 4 - Read task details without leaving the board (Priority: P2)

The lead collapses cards they know well down to just the key to save space, and clicks any card to see a mini-card with assignee, priority, last updated time and a link to the task in Jira.

**Why this priority**: Keeps big boards readable and answers "who has this, how urgent" without switching to Jira.

**Independent Test**: Collapse a card: only the key and status color remain. Click it: a mini-card opens with assignee, priority, updated time and a working link to Jira. Reload: the collapsed state is kept.

**Acceptance Scenarios**:

1. **Given** an expanded card, **When** the user collapses it, **Then** only the key (with status color) is shown, and the state survives reload.
2. **Given** any card, **When** the user clicks it, **Then** a mini-card shows assignee, priority, updated time and a link that opens the task in Jira in a new tab.

---

### User Story 5 - Keep several boards (Priority: P3)

The lead keeps separate boards (e.g. "Q4 goals", "Team Platform") and switches between them.

**Why this priority**: Useful after the first board proves itself; a single board is enough to test the hypothesis.

**Independent Test**: Create two boards with different content, switch between them, rename one, delete the other: content stays separate and the list reflects changes.

**Acceptance Scenarios**:

1. **Given** the board list, **When** the user creates, renames or deletes a board, **Then** the list updates and the change persists.
2. **Given** two boards, **When** the user switches between them, **Then** each shows its own content and viewport.

---

### User Story 6 - Canvas-first chrome (Priority: P2)

The canvas takes the whole screen, like tldraw. Tools live in a floating toolbar at the bottom center, actions on a spot live in the right-click menu, and the board name, main menu and theme live in a compact bar at the top left. There is no always-open input on the canvas.

**Why this priority**: The always-visible add-card input and the board panel cover the canvas and make the tool feel like a form. Dark theme matters for leads who keep the board open all day.

**Independent Test**: Open a board: no input field is visible, only the top-left bar and the bottom toolbar; no "React Flow" label in the corner. Add a card from the toolbar and another from the right-click menu. Switch to dark theme from the main menu, reload: the theme is kept.

**Acceptance Scenarios**:

1. **Given** an open board, **When** the user looks at it, **Then** no card input is shown until they pick the "Jira card" tool, and no library attribution label is shown.
2. **Given** an open board, **When** the user clicks the "Jira card" icon in the bottom toolbar, **Then** a small popover with the key-or-link input opens above it; Enter adds the card, Escape closes the popover.
3. **Given** an open board, **When** the user right-clicks an empty spot, **Then** a context menu offers "Add Jira card" (and the other element tools as they exist); choosing it opens the same input and places the card at that spot.
4. **Given** selected elements, **When** the user right-clicks one of them, **Then** the context menu offers "Delete".
5. **Given** an open board, **When** the user looks at the top-left corner, **Then** they see one compact bar: main menu button and current board name with a dropdown to switch or create boards.
6. **Given** the main menu, **When** the user picks Theme → Light, Dark or System, **Then** the whole UI (canvas, cards, panels) switches at once and the choice survives reload.
7. **Given** an open board, **When** the user presses a tool key (V, H, F, N, T, C) or `?`, **Then** the tool is picked or the shortcut list opens; shortcuts do nothing while typing in a field or with a dialog open.
8. **Given** selected elements, **When** the user copies and pastes (Cmd/Ctrl+C, Cmd/Ctrl+V) or duplicates (Cmd/Ctrl+D), **Then** copies appear at the cursor or next to the originals, a frame is copied with its contents, and copies paste into another board too.
9. **Given** the card input, **When** the user enters several keys or links separated by commas, **Then** the found tasks are added as a near-square grid and the keys that failed stay in the field with their errors.
10. **Given** the frame tool, **When** the user drags on the canvas, **Then** a frame of that size appears and takes in the elements under it; a click places a default-size frame.
11. **Given** a menu or dialog opened with the mouse, **When** the user closes it (Escape or click outside), **Then** no focus ring is left on the button that opened it.

### User Story 7 - Write JQL with suggestions (Priority: P3)

The lead types a JQL query into the Jira card input and gets suggestions like in Jira's own search: field names, then the operators that field allows, then its values (statuses, people, sprints), then AND, OR or ORDER BY. Tab inserts the suggestion. Before pressing Enter they see how many tasks the query matches.

**Why this priority**: Adding cards by JQL is only fast if the query is right the first time; field names and status spellings differ per Jira instance.

**Independent Test**: Type `sta`, press Tab: `status ` is inserted and the list shows its operators. Pick `=`, type `In`: statuses starting with "In" from Jira are offered. The hint line shows the match count, or Jira's error for a broken query.

**Acceptance Scenarios**:

1. **Given** the Jira card input, **When** the user types the start of a field name, **Then** matching fields from the user's Jira (including custom fields) are offered and Tab inserts the first or highlighted one.
2. **Given** a field and operator, **When** the user types the start of a value, **Then** values from Jira are offered, quoted where Jira needs quotes.
3. **Given** a query, **When** the user pauses typing, **Then** the match count or Jira's error is shown before submitting.
4. **Given** keys or links typed into the same input, **When** nothing matches, **Then** no list appears and adding by key works as before.

---

### User Story 8 - Undo and redo board changes (Priority: P3)

The lead moves, deletes or edits something by mistake and presses Cmd/Ctrl+Z to get the board back as it was; Cmd/Ctrl+Shift+Z (or Ctrl+Y) brings the change back.

**Why this priority**: Without undo, a wrong delete of a frame with its layout costs minutes of manual rebuild, which makes leads careful instead of fast.

**Independent Test**: Drag a card, delete a sticky, press Cmd/Ctrl+Z twice: the sticky is back, then the card returns to its old spot. Cmd/Ctrl+Shift+Z twice repeats both changes. Reload: the board shows the last state.

**Acceptance Scenarios**:

1. **Given** a change to the board (add, move, resize, delete, edit, connect), **When** the user presses Cmd/Ctrl+Z, **Then** the board returns to the state before that change; one drag or one burst of typing is one step.
2. **Given** an undone change, **When** the user presses Cmd/Ctrl+Shift+Z or Ctrl+Y, **Then** the change is applied again; a new change after undo clears the redo steps.
3. **Given** the cursor in a text field (sticky, frame title, card input), **When** the user presses Cmd/Ctrl+Z, **Then** the field's own text undo works and the board is not touched.
4. **Given** undo or redo, **When** the board saves, **Then** the restored state is saved like any other change; panning and zooming are not undo steps.

---

### Edge Cases

- Unknown key or a task the token cannot see: the card is not created (or is shown as "not found / no access") with a clear message; nothing else on the board breaks.
- Invalid or expired token, or Jira unreachable: cards keep their last known data, the indicator shows the error and the time of the last successful refresh; refreshing resumes when Jira is back.
- Jira rate-limits or responds slowly: the next refresh waits (backs off) instead of piling up requests.
- A task is deleted or moved to another project in Jira: the card shows "not found" and keeps its last known data.
- The same task is added twice to one board: allowed (two cards), both refresh from the same fetch.
- A board with 300 cards: panning, zooming and refreshing stay usable.
- A pasted link from a different Jira host than the configured one: the user is told the host does not match.
- The app restarts with a different encryption key: the stored token cannot be read; the user is asked to enter it again.
- Browser tab is in the background: refreshing may pause and catches up immediately when the tab is visible again.

## Requirements *(mandatory)*

### Functional Requirements

**Connection and secrets**

- **FR-001**: Users MUST be able to enter a Jira Data Center base URL and a personal access token in settings and test the connection.
- **FR-002**: The system MUST store the token only on the server, encrypted at rest with a key supplied by the operator through the environment.
- **FR-003**: The system MUST NOT return the token to the browser in any response, and MUST mask it in all logs and error messages. The settings screen shows only whether a token is set.
- **FR-004**: The system MUST work without any Jira connection by using a built-in demo task source, so the full core scenario can be run without keys.

**Boards and canvas**

- **FR-005**: Users MUST be able to create, open, rename and delete boards; multiple boards are supported.
- **FR-006**: The board MUST support pan and zoom over an unbounded area.
- **FR-007**: Users MUST be able to add, move, resize and delete frames with a title; elements dropped inside a frame belong to it and move with it.
- **FR-008**: Users MUST be able to add, edit, move and delete sticky notes and text labels.
- **FR-009**: Users MUST be able to connect any two elements with an arrow that stays attached when either end moves.
- **FR-010**: Users MUST be able to select several elements (box select and modifier-click) and move or delete them together.
- **FR-011**: The system MUST save every board change on the server automatically and reopen the board with the same elements, positions, sizes, collapsed states and viewport.

**Jira cards**

- **FR-012**: Users MUST be able to add a card by issue key or by pasting an issue URL from the configured Jira host.
- **FR-013**: A card MUST show issue type icon, key, title and status; done/resolved tasks are shown struck through.
- **FR-014**: Users MUST be able to collapse a card to its key and expand it again.
- **FR-015**: Clicking a card MUST open a mini-card with assignee, priority, last updated time and a link to the task in Jira.
- **FR-016**: Invalid keys, missing tasks and tasks without access MUST produce a clear message and never break the board.

**Freshness**

- **FR-017**: While a board is open, the system MUST refresh all its cards automatically with one batched request per refresh, at a default interval of 30 seconds.
- **FR-018**: Users MUST be able to change the refresh interval in settings within 30 to 300 seconds.
- **FR-019**: The system MUST only fetch tasks for the board that is currently open.
- **FR-020**: Users MUST be able to trigger "Refresh all" for the open board.
- **FR-021**: The board MUST show how long ago cards were last refreshed and whether the last refresh failed.
- **FR-022**: When Jira is unreachable or rejects requests, cards MUST keep their last known data and the system MUST back off instead of retrying at full rate.

**Provider boundary and operations**

- **FR-023**: Task data MUST come through a provider boundary with two operations, look up one task and refresh a set of tasks; only Jira Data Center and the demo source are provided.
- **FR-024**: The whole product MUST start with one command on a clean machine and be configurable only through environment variables documented in the README.
- **FR-025**: All user data MUST live in one data directory so that upgrading the app keeps boards and settings.

**Canvas chrome**

- **FR-026**: The canvas MUST take the whole screen; the card input MUST NOT be permanently visible. Tools MUST live in a floating toolbar at the bottom center; the "Jira card" tool opens the key-or-link input in a popover.
- **FR-027**: Right-clicking the canvas MUST open a context menu: on an empty spot it offers adding elements at that point (at least "Add Jira card"); on a selection it offers "Delete". Right-clicking toolbars or zoom controls MUST NOT open it.
- **FR-028**: A compact bar at the top left MUST hold the main menu and the current board name with a board switcher; the main menu holds Settings, Keyboard shortcuts and Theme.
- **FR-029**: Users MUST be able to switch between light, dark and system themes; the choice is stored in the browser and applied before first paint. Light is the default.
- **FR-030**: The canvas MUST NOT show the canvas library attribution label.
- **FR-031**: Every keyboard shortcut MUST come from one registry that feeds both the bindings and the shortcut list (`?`); copy, paste, duplicate and select all MUST work on canvas elements, including frames with their contents.
- **FR-032**: The card input MUST accept several keys or links separated by commas (up to 50) and lay the new cards out in a grid; Jira is called a few keys at a time.
- **FR-033**: The card input MUST offer JQL suggestions from the connected Jira (fields, operators, values, keywords), inserted with Tab, and show the match count or Jira's error before submit. Suggestion labels from Jira MUST be shown as plain text, never as HTML.
- **FR-034**: Cmd/Ctrl+Z MUST undo and Cmd/Ctrl+Shift+Z or Ctrl+Y MUST redo board changes (nodes and edges, not the viewport or selection), at least 100 steps per open board; history is kept in memory only.
- **FR-035**: A node dragged alone MUST snap to the edges and centers of the elements on screen and to the gap between its neighbors in a row or column, showing alignment lines and equal-gap markers while it snaps; a node resized alone MUST snap to the width or height of the elements on screen and mark every element of that size; holding Alt MUST move or resize it freely.

**Out of scope (Won't)**

Real-time collaboration and board sharing; Jira Cloud, Confluence, Todoist; changing status or editing tasks from the board; Jira webhooks; freehand drawing and shapes other than sticky note and frame; sign-in, roles, multiple users, payments, admin panel; languages other than English; LLM features; mobile layout. Should, only on request later: paste a JQL query to lay out matching tasks in a batch.

### Key Entities

- **Board**: a named canvas owned by the single user; holds elements, connections and the last viewport.
- **Element**: an item on a board with position and size; kind is frame, sticky note, text label or Jira card; may belong to a frame.
- **Jira card**: an element that references a task key and holds a snapshot of task data (type, title, status, status category, assignee, priority, updated time, link) plus a collapsed flag.
- **Connection**: an arrow between two elements on the same board.
- **Settings**: Jira base URL, encrypted token, refresh interval; one set per instance.
- **Task snapshot**: the last known data for a task key and when it was fetched; shared by all cards with that key.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user goes from a clean machine to a board with a live Jira card in 10 minutes or less by following the README.
- **SC-002**: A status change in Jira appears on an open board within 60 seconds in 95% of cases, with no user action.
- **SC-003**: Automatic refresh of an open board costs one request to Jira per interval regardless of the number of cards; no requests are made for boards that are not open.
- **SC-004**: A board with 300 cards stays smooth to pan and zoom and loads in under 3 seconds.
- **SC-005**: Reopening a board shows every element exactly as left (position, size, frame membership, collapsed state) in 100% of test runs.
- **SC-006**: The token never appears in any browser response or log line (verified by automated test).
- **SC-007**: At least 4 early users open their board on at least 4 days a week for two consecutive weeks, and rarely press "Refresh all".

## Assumptions

- One user per instance; the app runs on the user's machine or a trusted internal host, so there is no sign-in.
- The user can create a personal access token in their Jira Data Center (available since Jira 8.14); no admin action is needed.
- The Jira DC host is reachable from where the app runs (often a corporate network).
- "Done" is defined by Jira's status category, not by status name.
- Default refresh interval is 30 seconds so that a change is visible within a minute even with one missed tick.
- The issue type icon may be a generic per-type icon when Jira's own icon is not reachable from the browser.
- English-only UI; desktop browsers only.
- Demo data is made up and ships with the app; it allows changing a demo task's status so the freshness scenario can be shown without Jira.
