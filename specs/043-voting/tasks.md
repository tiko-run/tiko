# Tasks: Voting on stickies and cards

## Slice 1: voting

- [x] T001 Tables of rounds, people and votes with the workspace's row rules; one running round per board
- [x] T002 Domain: start, join, vote with the limits, done, +1 min, end by hand and by the timer when someone looks, rename, delete; what each person may see while it runs and after
- [x] T003 API under `/boards/{id}/votes`; signed-in people who can open the board, never guests
- [x] T004 Live message 101 tells everyone on the board to read the votes again; the board's room takes the new lock, across processes too
- [x] T005 The room puts back changes and deletions of elements in a running vote, and of the frames holding them; moves and reactions pass
- [x] T006 Start from the selection bar with the settings; the round's panel with join, countdown, votes left, who is done, +1 min and end
- [x] T007 Pluses on the elements, the rest dimmed; elements in the vote framed and not editable or deletable on the canvas
- [x] T008 Results for everyone at the end, past votes from the board menu, rename and delete
- [x] T009 Guide, CHANGELOG; media wait for the release
