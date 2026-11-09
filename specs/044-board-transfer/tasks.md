# Tasks: Move a board between tiko instances

## Slice `board-transfer`

- [x] T001 Domain: `.tiko` format writer and reader with entry, size and path limits (`backend/app/domain/transfer.py`)
- [x] T002 Domain: import into a new board, pictures through the upload checks, rollback on failure
- [x] T003 Planning: match stage types, people and fields by name, add the missing ones and non-overlapping time off (`Planning.adopt`)
- [x] T004 Refresh: `not_connected` state for a tracker this instance does not read; unread tasks keep their last snapshot
- [x] T005 API: `GET /api/boards/{id}/export`, `POST /api/boards/import`; `newer_file` error
- [x] T006 Frontend: Export in the board menu and on Home, Import button and file drop on Home
- [x] T007 Frontend: import report panel with live tracker items; card and Gantt label for `not_connected`
- [x] T008 Tests: backend round trip, planning matching, refusals, rollback; frontend report and card
- [x] T009 Guide page `moving-boards`, Home menu table, CHANGELOG
