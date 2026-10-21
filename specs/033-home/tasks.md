---
description: "Task list for Home"
---

# Tasks: Home

**Input**: [spec.md](spec.md), [plan.md](plan.md), [contracts/api.md](contracts/api.md)

**Tests**: on Postgres; all people and boards in fixtures are made-up.

## Phase 1: Slice `feat/home` (US1)

- [x] T001 `DESIGN.md`: a Home section (grid, list, card, menu, empty state, narrow screen); `/hallmark` on the screen before code
- [x] T002 `BoardSummary.created_at`; `POST /api/boards/{id}/duplicate` with limits and a fresh stage index. Contract first. Tests
- [x] T003 `App.tsx`: navigation by `pushState` and `popstate`, Home without `?board=`, `tiko.lastBoard` no longer read; the top bar's Home button and "All boards". Tests for Back and Forward
- [x] T004 `frontend/src/home/`: the page, the list view, filters all, mine, shared with me, sort, the admin's section, the empty state; the view choice in `localStorage`. Tests
- [x] T005 Search by name from the keyboard, arrows and Enter; "New board" opening with the name in edit mode; the board menu: open, rename, duplicate, share, delete as today. Tests
- [x] T006 The demo: "Try the demo" opens the welcome board, Back lands on Home. SC-001 timing with 500 boards
- [x] T007 `CHANGELOG.md`, the guide's new Home page and the boards page; `make check`, `make smoke`, `/ui-review`

## Phase 2: Slice `feat/board-previews` (US2)

- [x] T008 `domain/preview.py`: SVG from a board document, per node type, escaping, the node cap. Tests, SC-005 timing
- [x] T009 `003_board_previews.sql`: `board_previews`; `GET /api/boards/{id}/preview` with ETag, headers and access; `preview` in `BoardSummary`. Contract first. Tests
- [x] T010 The grid view with previews, lazy loading, the placeholder. Tests
- [x] T011 `CHANGELOG.md`, the guide; `make check`, `/ui-review`

## Phase 3: Slice `feat/stars-folders` (US3)

- [x] T012 Tables `board_stars`, `folders`, `folder_boards` with row-level security and cascades; repositories. Tests across people and workspaces
- [x] T013 Routes for stars, folders and moving a board; `starred` and `folder_id` in `BoardSummary`; the cleanup of rows whose person lost access. Contract first. Tests
- [x] T014 Home: the star on cards, "Starred", the folder list, new, rename, delete, move by menu and by drag. Tests
- [x] T015 `CHANGELOG.md`, the guide; `make check`, `/ui-review`

## Phase 4: Slice `feat/trash` (US4)

- [x] T016 `boards.deleted_at`, `deleted_by`; every board read skips trashed boards; a storage test over each repository method that takes a board id
- [x] T017 `DELETE` to the trash, `?forever=1`, `POST /restore`, `GET /api/trash` with the admin's view; the limit counts trashed boards. Contract first. Tests
- [x] T018 The 30-day job in process 0; removal from the workspace moves trashed boards too; the demo's eviction takes the trash. Tests
- [x] T019 The route walk of spec 032 extended with a trashed board, stars and folders as owner, member, admin and stranger (SC-003)
- [x] T020 Home: the trash view, restore, delete for good with a confirmation, the time left. Tests
- [x] T021 `CHANGELOG.md`, the guide's Home, boards and demo pages; `make check`, `make smoke`, `/ui-review`
