# Feature Specification: Task card node type

**Feature Branch**: `017-task-card`

**Created**: 2026-10-11

**Status**: Owner told the agent on 2026-10-11 to build after a short spec, without waiting for G2; shown at G3.

**Input**: Decision 4 of spec 015: "Jira card" became "Task card" in the texts, and the stored node type `jira_card` is renamed in its own slice, with a backup first.

## Why

A card holds a task of any tracker: Jira, GitHub or the demo. The interface already says "Task card", while the code, the API and every stored board still say `jira_card`. New code keeps tripping over a name that is wrong for two of the three trackers.

## Decisions

1. **The type is `task_card`** in the API, the stored JSON of a board and its CRDT state. Classes and files follow: `TaskCardNode`, `TaskCardData`.
2. **Stored boards are rewritten once, on the first start of the new version.** Only the type of card nodes changes: no version bump, no new `updated_at`, the live history of a board stays.
3. **The database is copied aside before the rewrite**, to `backups/before-v12-<time>.db` next to it, by the server itself: an instance run from images has no `make backup`. The copy is not rotated or deleted by tiko. A database made by this start has nothing to copy.
4. **A live state that cannot be read is dropped, not fatal**: the board's room builds a new one from the JSON, which is the saved board.
5. **The old name is still accepted on the way in.** A board sent to the API with `jira_card` is stored as `task_card`. A card added over a live connection by a tab left open over the upgrade is renamed by the server's repair, and the web app shows it as a task card meanwhile.
6. **Nothing changes on the screen.** The welcome board's note names the "Task card tool", as the toolbar does.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An upgrade keeps every board (Priority: P1) 🎯

An admin upgrades tiko. Every board opens as before, with the same cards in the same places. Next to the database lies a copy made before anything was rewritten.

**Independent Test**: on a copy of a real database of the previous version start the new server. Count nodes by type before and after: every `jira_card` is a `task_card`, the other counts, the versions and `updated_at` are the same; every board loads and passes `check_doc`; no live state holds `jira_card`; `backups/` has one `before-v12-*.db` with the old boards.

**Acceptance Scenarios**:

1. **Given** a database of schema 11 with boards, **When** the new version starts, **Then** `backups/before-v12-<time>.db` exists and holds the boards as they were.
2. **Given** such a database, **Then** every card node is `task_card` in the JSON and in the CRDT state, and a sticky whose text says `jira_card` is untouched.
3. **Given** a board whose live state is not readable, **Then** the start succeeds, the board has no live state and its JSON is renamed.
4. **Given** a second start, **Then** nothing is rewritten and no second copy is made.
5. **Given** a new, empty database, **Then** no copy is made.
6. **Given** a board put through the API with a `jira_card` node, **Then** it is stored and returned as `task_card`.
7. **Given** a card written to a live board under `jira_card`, **Then** the server's repair keeps it and renames it.

## Requirements *(mandatory)*

- **FR-001**: The node type of a card MUST be `task_card` in the API, the web app, stored boards and their CRDT state.
- **FR-002**: The upgrade MUST copy the database aside before it rewrites stored boards, unless the database was made by this start.
- **FR-003**: The upgrade MUST change nothing but the type of card nodes.
- **FR-004**: The server MUST accept `jira_card` in a board sent to the API and in a live update, and store `task_card`.

## Out of scope

- A tab left open over the upgrade: it runs the old web app, which does not know `task_card`, and has to be reloaded. Pages are served with no-cache, so a reload is enough.
- Restoring from the copy by a command: it is a file to put back by hand (guide, "Data, backups and upgrades").
- The texts of DESIGN.md that still describe the card through Jira ("Open in Jira").
