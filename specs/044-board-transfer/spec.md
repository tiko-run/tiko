# Feature Specification: Move a board between tiko instances

**Status**: Approved at G2 on 2026-11-09.

**Input**: A person ran tiko at home for two weeks and set a board up the way they think. Now they want the same board on the tiko their company runs. Copy and paste does not work across instances: the copy buffer lives in the tab's memory, and pictures are stored on the server they came from.

## Why

- A board is weeks of arranging. Rebuilding it by hand on another instance is the kind of chore that makes people stay in one tool for the wrong reason.
- tiko is self-hosted: the same person often has more than one instance (laptop, team server, company network), and they do not see each other.
- An open-source tool should not lock a board into one database. A board you can carry in a file is yours.
- Which fog does this clear: the map you built of your work goes with you, so you do not start from a blank board at a new place.

## Decisions

1. **One board, one file.** Board menu (top bar and Home) → **Export board** downloads `<board name>.tiko`. On Home, **Import** next to New board, or a `.tiko` file dropped on Home, makes a new board in the open folder. Import never touches an existing board. The importer becomes its owner.
2. **The file is an open format.** A `.tiko` file is a zip: `manifest.json` (format version, tiko version, export time, board name), `board.json` (the board document), `tasks.json` (the last known title, status and fields of every card's task), `planning.json` (the stage types, people and fields the board's Gantts use) and `files/` (the original bytes of every picture). The guide documents it, so a script can read or write one.
3. **Everything that belongs to the board moves.** Stickies, shapes, text, frames, arrows, images, stickers, Gantts and other modules, timers, rotation, styles, the board's name and its view. Element ids are kept: they are unique within a board only, as with Duplicate, so one file imported twice gives two boards that do not clash.
4. **Pictures move with their bytes.** Each picture goes through the same path as an upload on the target: format check, size limits, EXIF stripping, copies for the canvas. A picture already stored in the target workspace is not stored twice.
5. **Task cards stay cards.** A card that names no tracker belongs to the exporting instance's own; the file names it. A card keeps its tracker and key. On the target:
   - the tracker is connected → the card goes live on the next refresh, as any card does;
   - the tracker is not connected → the card shows the task as it was at export, with a quiet "Not connected" mark and, on click, which tracker to connect and a button to Settings. Once it is connected, the card goes live by itself.

   The import cannot tell whether the target's Jira is the same Jira; the guide says so. The person connects the tracker they mean.
6. **Gantt planning moves as it is, matched by name.** Stage types, people (with their teams and time off) and fields the board uses are matched to the target workspace's planning by name; the missing ones are added. For a person who is already there, time off from the file is added where it does not overlap what the target has; nothing on the target is removed or changed. A person without the right to change planning gets the matched ones, and the rest show as "Unknown stage type" or "Unknown person" in the Gantt, named in the report.
7. **What belongs to people of the old instance stays there.** Reactions, voting rounds, sharing, members, the public link, the star and the folder. The file does not carry them, and the guide says so.
8. **After import, a report.** The new board opens with a short panel: what moved (counts by kind) and what needs a hand, each with what to do:
   - "12 tasks from Jira show what they were at export" → Settings → Task source; this item reads the cards' state live and drops out once the tracker is connected;
   - "2 people in the Gantt are new to planning: check them" → Planning;
   - "1 picture was refused: HEIC is not supported" → names it.

   Nothing to do means one line: "Board imported". The panel closes and does not come back.
9. **All or nothing.** The import checks the whole file first: the format, the document by the same schema a save uses, each picture, the workspace quota. If anything blocks the board as a whole, nothing is written and the message says what to do: "This file is from tiko 2026.12 and needs a newer tiko: update this one", "Not a tiko board file", "The pictures need 140 MB and the workspace has 60 MB left". A single bad picture does not block the board: it becomes an empty image of its size with the reason, and the report names it.
10. **The file is untrusted input.** The zip is read with limits on the number of entries, the total unpacked size and paths; anything outside the layout of Decision 2 is ignored. Text is never run or rendered as HTML.
11. **Who can.** Everyone who can open a board in the app can export it: they already see all of it. Guests of a public link cannot. Anyone who can make a board can import one. A demo visitor can export and import within the demo quota.

## Requirements

- **FR-001**: Export MUST produce a `.tiko` file of the layout in Decision 2 for anyone signed in who can open the board; guests of a public link MUST NOT get it.
- **FR-002**: Import MUST create a new board owned by the importer, in the open folder, from the file picker or a file dropped on Home.
- **FR-003**: Every element type of the board document MUST survive an export and import round trip on the same or another instance, except the people-bound data of Decision 7.
- **FR-004**: Pictures MUST be stored on the target through the upload checks and deduplicated by hash within the workspace.
- **FR-005**: A card whose tracker is not connected MUST show its exported title and status and say which tracker to connect; it MUST go live without re-import once the tracker is connected.
- **FR-006**: Gantt stage types, people with their teams and time off, and fields MUST be matched by name and added when missing and allowed; existing planning on the target MUST NOT be changed except for added time off that does not overlap.
- **FR-007**: After import a report MUST list what moved and every item that needs action, with the action.
- **FR-008**: An import that fails MUST write nothing and MUST say why and what to do; a newer file format than the instance reads MUST ask to update tiko.
- **FR-009**: The zip MUST be read with entry, size and path limits.
- **FR-010**: The guide MUST describe the file format and what does and does not move.

## Slices

1. `board-transfer`: all of the above. Backend: export and import endpoints, format reader and writer, planning matching. Frontend: Export in the board menu, Import on Home with drop, the report panel, the "Not connected" card state. Guide page and CHANGELOG line.

## Out of scope

- Export of a whole workspace or several boards at once.
- Paste across instances.
- Import from Miro, FigJam or other tools.
- Merging a file into an existing board.
