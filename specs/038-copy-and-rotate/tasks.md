# Tasks: Copy by dragging, rotate

## Slice 1: alt-copy

- [x] T001 Alt at the start of a drag shows a see-through copy following the pointer; at the drop leaves the originals in place and inserts copies where they were dropped, one undo step (`dragCopy` in `frontend/src/canvas/clipboard.ts`, tested)
- [x] T002 Cmd / Ctrl + drag moves without snapping; Alt no longer does (`useGuides`, shortcut list)
- [x] T003 Guide (shortcuts, Around the cards) and CHANGELOG

## Slice 2: rotate

- [ ] T004 Optional `rotation` on stickies, shapes and text in the board document; older boards read as 0
- [ ] T005 Rotate handle, Shift snaps to 15°; synced, undone, copied, saved
- [ ] T006 Arrow ends on a turned element, or a note in the guide if they do not follow
- [ ] T007 Guide and CHANGELOG
