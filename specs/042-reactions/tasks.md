# Tasks: Reactions on stickies and cards

## Slice 1: reactions

- [x] T001 `reactions` on `StickyData` and `TaskCardData`: the six emoji, people ids, limits; other node types refuse them; tests with old boards
- [x] T002 Storage in the live board that keeps two reactions made at once (one key per person and emoji, not one value for the whole map); kept out of undo; dropped on copy, paste and duplicate
- [x] T003 Chips under stickies and task cards, own highlighted, hidden at far zoom with the text; the six emoji as images
- [x] T004 Smiley button on hover and selection for owners and editors; the selection bar adds or takes off a reaction on every selected sticky and card
- [x] T005 Who reacted on hover: You, up to five names, "and N more" that opens the whole list in a scrolling panel, Former member; counts only for guests
- [x] T006 Guide, CHANGELOG; media wait for the release
