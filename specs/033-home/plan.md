# Implementation Plan: Home

**Spec**: [spec.md](spec.md) | **Contract**: [contracts/api.md](contracts/api.md) | **Research**: [research.md](research.md)

## Summary

Home is a new frontend page shown when the address names no board. It reads the board list that exists today, extended with what a card needs: creation time, the person's star and folder, and whether the board has a preview. Previews are SVG drawn by the backend from the board document on request and cached by board version. Stars and folders are two small workspace tables keyed by person. Deleting sets `deleted_at` on the board instead of removing the row; every read of a board skips such rows, and an hourly job removes what has been there 30 days.

## Today

- `App.tsx` reads `?board=` or the last board from `localStorage` and opens it; with no boards it shows a "New board" form. The address changes with `replaceState`, so Back leaves tiko.
- `TopBar` holds the board switcher: a menu of the person's boards and, for admins, the others.
- `GET /api/boards` answers `{boards, all}`: `BoardSummary` with `id`, `name`, `updated_at`, `my_role`, `owner`, `public`.
- `DELETE /api/boards/{id}` removes the row; cascades take members, stages and the index; `live.recheck_board` and `end_public` close sockets.
- `PATCH /api/boards/{id}` renames (editors), `POST /api/boards` creates within the board limit, which counts owned rows.
- The canvas is React Flow (`@xyflow/react`) over a Yjs document; the stored `doc` is JSON with `nodes` and `edges`.

## Decisions

### Navigation

- No router library. `App` keeps one piece of state, the board id or none, and syncs it with `?board=` through `pushState` and a `popstate` listener, so Back and Forward move between Home and boards. `localStorage` stops choosing the board; a stale `tiko.lastBoard` is ignored.
- Opening a board from Home, from the switcher or from "New board" pushes a history entry; a redirect, such as a board that is gone, replaces it.
- The top bar gets a Home button left of the board name. The board switcher stays for quick jumps, with "All boards" at its end.
- `Try the demo` keeps opening the welcome board, through the address, so Back from it lands on Home.

### The list

- `BoardSummary` gains `created_at`, `starred`, `folder_id` and `preview` (the board version the preview follows, or `null` for an empty board). One query per request as today, with left joins on the person's star and folder.
- Filters, sort and search run on the client over the loaded list: a person's list is at most a few hundred rows, and SC-001 is met without paging. The grid or list choice and the sort live in `localStorage` under one key.
- Search: `/` or Cmd/Ctrl+K on Home focuses the search field (on a board, Cmd+K keeps opening the board's own search). Arrows move the selection over the visible cards, Enter opens.
- Components from shadcn: `Card`, `DropdownMenu`, `ContextMenu`, `Input`, `ToggleGroup`, `Dialog`, `Sidebar` pieces as needed; colors from the theme tokens. `DESIGN.md` gets a Home section; `/hallmark` for the new screen, `/ui-review` per slice.

### New board and duplicate

- "New board" calls the existing `POST /api/boards` with "Untitled board" and opens it with the title field in edit mode (`?board=…&rename=1`, dropped from the address after reading).
- `POST /api/boards/{id}/duplicate`: `CanView`; copies `doc` (not `ydoc`, which is rebuilt from it), name "Copy of …" cut to the name limit, owner the person, no members, no public link, no everyone role, within the board limit. Stage index rebuilt from the doc as on any save.

### Previews

- `domain/preview.py`: a pure function from `BoardDoc` to an SVG string. Nodes are drawn by type: frames as outlined rectangles with their title, stickies as filled rectangles in their color with the first lines of their text, task cards as rectangles with their key, Gantts as a rectangle with bars from their rows, shapes by kind, edges as straight lines; everything else as a grey box. Text is escaped, cut, and set in the system font; nothing outside the doc is read, so no task title or name from a tracker can get in.
- The view box is the bounding box of the nodes with a margin, scaled to a 320×200 frame. Nodes past the first 2,000 by area are dropped, which keeps SC-005.
- `GET /api/boards/{id}/preview` (`CanView`) answers `image/svg+xml` with `ETag` = board version and `Cache-Control: private, max-age=0, must-revalidate`. A table `board_previews (workspace_id, board_id, version, svg)` caches the last drawing; a request for a newer version draws again. Saves never draw, so they are not held up; a preview is current the next time Home asks, which meets "within a minute".
- A board with no nodes has `preview: null` and the card shows a placeholder with the board's initial.
- The SVG is served with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` and `X-Content-Type-Options: nosniff`, and loaded through `<img>`, so a script in it could not run either way.

### Stars and folders

- `board_stars (workspace_id, user_id, board_id)`, primary key `(board_id, user_id)`; `folders (workspace_id, id, user_id, name, position)`; `folder_boards (workspace_id, user_id, board_id, folder_id)`, primary key `(board_id, user_id)` so a board sits in one folder of a person. All cascade from `boards`, `users` and `folders`, and carry row-level security like every workspace table.
- Losing access to a board hides the star or folder row at once: the list only shows boards the person can open. The hourly job then deletes rows whose person cannot open the board, so they do not pile up. A star or folder place is not kept across lost access; access given back later starts without it. A trashed board is not a lost access: its rows stay until it is gone for good, so a restore brings them back.
- Routes: `PUT`/`DELETE /api/boards/{id}/star`; `GET`/`POST /api/folders`, `PATCH`/`DELETE /api/folders/{id}`; `PUT /api/boards/{id}/folder` with `{folder_id}` or `null`. Folder names 1–60 characters, 100 folders a person.

### Trash

- `boards.deleted_at timestamptz` and `deleted_by text`. `DELETE /api/boards/{id}` sets them, ends sockets and public guests as today, and keeps every other row. A partial index on `deleted_at IS NOT NULL` serves the trash and the job.
- Every read that finds a board for a request filters `deleted_at IS NULL`: `listing`, `get`, `load`, `owner`, `by_public_token`, members and roles, the workspace lookup in `board_index`, stage reads for the workload. The route walk of spec 032 gets a trashed board in each workspace and must find nothing of it (SC-003).
- `GET /api/trash`: the person's own trashed boards; for a workspace admin every trashed board of the workspace, with its owner. `POST /api/boards/{id}/restore` (owner or workspace admin) clears the mark; `DELETE /api/boards/{id}?forever=1` (owner, only a trashed board) removes the row as today.
- The board limit keeps counting owned rows, trashed ones included.
- One job runs in process 0 once an hour as `tiko_jobs`. It deletes, in batches, boards whose `deleted_at` is 30 days old or more, so a board goes within an hour after its `purge_at`; it also removes the star and folder rows above; it logs the counts. The demo's eviction removes the visitor's workspace with its trash already.
- Removing a person from the workspace moves their boards to the remover, trashed ones too, since `board_members` rows stay.

### Contract and docs

- `contracts/api.md` names each change before its slice. The guide gets a "Home" page and updates to the boards, sharing and demo pages; `CHANGELOG.md` a line per slice.

## Structure

```text
backend/app/domain/preview.py          SVG from a board document
backend/app/domain/boards.py           duplicate, trash, restore; BoardSummary fields
backend/app/domain/folders.py          stars and folders
backend/app/api/boards.py              duplicate, preview, star, folder, restore, forever
backend/app/api/folders.py             folders, trash
backend/app/adapters/storage/pg_migrations/003_board_previews.sql, then one file per later slice
backend/app/adapters/storage/postgres.py
frontend/src/home/                     Home page, cards, list, filters, search, menu, folders
frontend/src/App.tsx                   navigation by history
frontend/src/board/TopBar.tsx          Home button, "All boards"
```

## Tests

- Domain: preview of each node type, escaping, size and node cap, empty board; duplicate within limits; trash state changes.
- Storage: trashed boards invisible to every read; stars and folders per person and per workspace; cascades; the 30-day job.
- API: the route walk extended with a trashed board, stars and folders (SC-003); preview access and headers.
- Frontend: Home renders, filters, sort, search by keyboard, menu actions, empty state, Back and Forward between Home and a board.
- Timing: SC-001 with 500 made-up boards, SC-005 with a 2,000-node doc.

## Risks

- Every board read needs the trash filter; one missed is a leak. The route walk and a storage test over every repository method that takes a board id cover it.
- Previews of huge boards: the node cap and the size check in tests keep them small.
- People used to landing on their last board: one click on the first card, which is that board.

## Slices

| Slice | Done when |
|---|---|
| `feat/home` | Home opens without a board in the address, the list with filters, sort, search, "New board", duplicate and the menu works, Back and Forward move between Home and boards |
| `feat/board-previews` | the grid shows previews without task titles, current after a change, served only to who can open the board |
| `feat/stars-folders` | stars and personal folders, invisible to others, a deleted folder keeps its boards |
| `feat/trash` | delete moves to the trash, restore brings back members and link, forever and the 30-day job remove every row, the route walk finds nothing of a trashed board |
