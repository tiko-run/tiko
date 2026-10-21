# Feature Specification: Home

**Feature Branch**: `feat/home-spec`; slices in [Slices](#slices)

**Created**: 2026-10-21

**Status**: Approved at G2 on 2026-10-21.

**Input**: A place to land before a board, as whiteboard products have: every board you can open, with previews, stars, your own folders and a trash. Templates are not part of it.

## Why

tiko opens the last board you had open, and the other boards hide in a list under the board's name. That works with three boards. With thirty, people lose boards, cannot tell two similar names apart, and delete a board for good with one wrong click.

- There is no way to see at a glance what boards exist and which were touched lately.
- A board shared with you shows up among your own with nothing to tell them apart.
- A deleted board is gone, with its stages, notes and links.

Every whiteboard product people come from lands on such a page: recent boards first, a star, a "New" button, a menu per board, search by name and a trash ([research](research.md) of Miro, FigJam, Excalidraw+, tldraw, Whimsical and Mural). People expect it.

## Terms

- **Home**: the page a signed-in person lands on when the address names no board.
- **Preview**: a small picture of a board's content, drawn by the server from the board itself.
- **Star**: a person's own mark that pins a board to the top of their Home. Nobody else sees it.
- **Folder**: a person's own group of boards on their Home. It changes nothing about who can open a board, and nobody else sees it.
- **Trash**: where a deleted board waits 30 days before it is gone for good.

## Decisions

1. **Home is where tiko opens.** The address without a board opens Home, also right after signing in. A board link opens the board at once. Every board has a way back to Home, and the browser's Back button goes there too.
2. **One list of every board you can open**, the latest change first. The admin's list of other people's boards stays, as its own section for admins.
3. **Grid with previews or a compact list**, a switch that the browser remembers.
4. **Filters**: all boards, mine, shared with me; and starred boards, a folder or the trash on the side. Sorting by last change or by name.
5. **Search by name** on the page, from the keyboard, with arrows and Enter to open.
6. **"New board" opens a new board at once**, named "Untitled board", with its name ready to change.
7. **Each board has a menu**: open, rename, duplicate, share, star, move to a folder, delete. Who may do what stays as it is today for rename, share and delete; anyone who can open a board may duplicate it.
8. **Previews are drawn by the server** from the board: shapes, frames, sticky notes with their text, task cards with their key, Gantts as bars. Task titles are left out: they come from each person's own tracker access. A preview follows the board's changes within a minute and is shown to whoever can open the board.
9. **Stars and folders are personal.** Folders are flat: a board sits in at most one of your folders. Deleting a folder leaves its boards on Home.
10. **Deleting moves a board to its owner's trash for 30 days.** It disappears for everyone else and its public link stops working. The owner restores it or deletes it for good; after 30 days it goes by itself. A workspace admin sees and restores every board in the workspace's trash. A board in the trash still counts against a board limit until it is gone for good.
11. **On the demo**, "Try the demo" opens the visitor's welcome board through a board address, so it is a board link under decision 1, not an exception to it. Any later address without a board opens Home with their boards. Their trash goes with them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find a board and get to work (Priority: P1) 🎯

A person signs in and lands on Home. The boards they touched last are first, each with its name, owner, the time of the last change and whether it is shared. They type part of a name, press Enter and are on the board. Back takes them to Home again.

**Independent Test**: with twenty made-up boards, some shared with the person, Home lists them by last change; "Mine" and "Shared with me" split them; typing a name and pressing Enter opens the right board; Back returns to Home.

**Acceptance Scenarios**:

1. **Given** a signed-in person opens tiko without a board in the address, **Then** Home opens, with their boards by last change.
2. **Given** a link to a board, **When** the person opens it, **Then** the board opens without Home in between.
3. **Given** Home, **When** the person presses "New board", **Then** a board named "Untitled board" opens with its name ready to type.
4. **Given** the person has no board, **Then** Home says so in one sentence and offers "New board".
5. **Given** an admin, **Then** Home also lists the workspace's boards nobody shared with them, apart from their own.

### User Story 2 - See what is on a board before opening it (Priority: P1)

The grid shows a preview of each board: its stickies, frames, cards and Gantts in their places. A person tells "Roadmap Q4" from "Roadmap Q4 old" without opening either.

**Independent Test**: a board with a sticky note, a frame, two task cards and a Gantt shows those in its preview, with no task title in it; a change on the board shows in the preview within a minute.

**Acceptance Scenarios**:

1. **Given** a board with content, **Then** its preview shows its shapes in their places and no task title.
2. **Given** an empty board, **Then** its card shows a plain placeholder.
3. **Given** a person who cannot open a board, **Then** they cannot get its preview either.
4. **Given** the list view, **Then** no preview is loaded.

### User Story 3 - Keep the boards in order (Priority: P2)

A person stars the two boards they use daily and puts the rest into folders "Team" and "Archive". Their teammates' Home looks as before.

**Independent Test**: stars and folders of one person do not show for another; a board in a folder shows under that folder for its keeper only; deleting a folder keeps its boards.

**Acceptance Scenarios**:

1. **Given** a starred board, **Then** it is on top of the person's Home and under "Starred".
2. **Given** a board moved into a folder, **Then** it shows in that folder; the main list and search still find it.
3. **Given** a folder is deleted, **Then** its boards are back on Home, none deleted.
4. **Given** a board in someone's folder loses its sharing with them, **Then** it leaves their folder too.

### User Story 4 - Undo a deletion (Priority: P2)

An owner deletes the wrong board. They open the trash, restore it, and everyone it was shared with has it again, with its public link.

**Independent Test**: a deleted board answers 404 to its members and its public link; restored within 30 days, it opens for them as before; after 30 days no row of it is left.

**Acceptance Scenarios**:

1. **Given** an owner deletes a board, **Then** it moves to their trash and is gone for everyone else, its public link included.
2. **Given** a board in the trash, **When** its owner restores it, **Then** its members, roles and public link work again.
3. **Given** a board 30 days in the trash, **Then** it is deleted for good within the next hour.
4. **Given** a workspace admin, **Then** they see the trash of every owner in the workspace and can restore from it.
5. **Given** a person at their board limit, **When** they delete a board for good from the trash, **Then** they can make a new one.

### Edge Cases

- A board open in another tab when it is deleted: the tab is told, as when a board is deleted today.
- A board deleted while someone has it starred or in a folder: it leaves their Home and comes back with the restore.
- An owner removed from the workspace: their boards move to the admin as today; boards in their trash move too.
- Duplicating a board at the board limit is refused like creating one.
- A board with thousands of nodes: its preview stays small and is drawn without holding up saves.
- Two people renaming the same board from Home at once: the last one wins, as today.
- A narrow screen: the grid becomes one column; the menu and search work by touch.

## Requirements *(mandatory)*

- **FR-001**: The address without a board opens Home for a signed-in person; a board address opens the board. Navigation between them keeps the browser's history.
- **FR-002**: Home lists every board the person can open, with name, owner, last change, the person's role, whether it is shared and whether it has a public link; admins also get the workspace's other boards as their own section.
- **FR-003**: Filters all, mine, shared with me; side entries starred, each folder, trash. Sort by last change (default) or name. Grid or list, remembered in the browser.
- **FR-004**: Search by name on the loaded list, opened from the keyboard; arrows move, Enter opens.
- **FR-005**: "New board" makes "Untitled board" and opens it with its name in edit mode.
- **FR-006**: The board menu: open, rename, duplicate, share, star, move to folder, delete. Duplicate copies the content to a new board owned by the person, without members or public link, named "Copy of …", and respects the board limit.
- **FR-007**: The server draws each board's preview from its content without task titles, keeps it current within a minute of a change, and serves it only to who can open the board.
- **FR-008**: Stars and folders belong to a person in a workspace; a folder holds a board at most once; deleting a folder keeps its boards. Limits: 100 folders a person.
- **FR-009**: Deleting a board moves it to the trash for 30 days: it answers as missing to everyone, its public link and live sockets stop. The owner and a workspace admin restore it with its members, roles and link; the owner deletes it for good; 30 days after the deletion it may be removed, and an hourly job removes it within an hour of that. Trashed boards count against board limits.
- **FR-010**: The demo keeps its welcome board on "Try the demo"; a visitor's trash goes with the visitor.
- **FR-011**: API contract changes go to `specs/033-home/contracts/` before the code. `CHANGELOG.md` and the guide (a Home page, boards, sharing, demo) follow.

## Success Criteria *(mandatory)*

- **SC-001**: Home with 500 boards a person can open shows its first screen within 1 second on a laptop, previews filling in after.
- **SC-002**: A person finds and opens a board by name in under 5 seconds, by keyboard only.
- **SC-003**: No route, preview or socket gives a trashed board, a star or a folder to anyone but those named in FR-008 and FR-009; a test walks the routes as owner, member, admin and stranger.
- **SC-004**: A restored board is the same as before its deletion: content, members, roles, public link.
- **SC-005**: A preview takes under 200 ms of server time for a board of 2,000 nodes and stays under 50 KB.

## Slices

1. `feat/home`: Home as the landing page, the list, filters, sort, search, "New board", the menu (open, rename, duplicate, share, delete as today), the empty state, the way back from a board. US1.
2. `feat/board-previews`: previews drawn by the server, the grid. US2.
3. `feat/stars-folders`: stars and personal folders, move to folder. US3.
4. `feat/trash`: deleting to the trash, restore, delete for good, the 30-day job, limits, the admin's view. US4.

## Out of scope

- Templates and a template gallery.
- Shared folders or spaces with their own access; nested folders.
- Search inside board content from Home (the board's own search stays).
- Who is on which board now; activity feeds.
- Custom covers for boards.
- An archive apart from the trash.
