# Feature Specification: Voting on stickies and cards

**Status**: Approved by the owner at G2 on 2026-11-09.

**Input**: Teams that run retrospectives on tiko boards asked for votes, anonymous and open, next to the reactions of spec 042. A reaction says "me too" at any time; a vote is a timed round with a fixed number of votes per person that ends with a ranked list of what the team wants to talk about first.

## Why

- After a retro's notes are up, the team has to pick the few it will discuss. Today the facilitator counts hands or dots by eye.
- Open reactions sway people: the first likes pull the next ones. A vote where nobody sees the others' votes until the end gives an honest ranking.
- Which fog does this clear: what the team as a whole thinks matters most, ranked, at the end of the round.

## Decisions

1. **A round is started from a selection.** Select stickies and cards, or a frame to take the stickies and cards inside it, and press Vote in the selection bar. Only stickies and task cards take part, as with reactions. Elements added after the start do not take part.
2. **Settings before the start**: a name (default "Vote N"), votes per person (1–99, default 5), whether one element can take several votes of one person (default yes, as in dot voting), a timer (1–60 minutes, default 5, or none), and **anonymous or open** (default anonymous).
3. **Who starts and who votes.** The board's owner and editors start a round. Everyone signed in who can open the board votes: owner, editors and viewers. Guests of a public link do not vote and do not see the round.
4. **One round at a time per board.** While it runs, Vote in the selection bar is replaced by the running round.
5. **Joining.** Everyone with the board open gets a small panel: who started the round, its name and time left, with Join and Not now. The starter joins at once. Someone who opens the board during the round gets the same panel. Not now leaves a small button in the corner to join later.
6. **Voting.** A joined person sees a plus on every element in the round and dims the rest of the board. A click on the plus gives a vote; the plus turns into the person's own count, with minus and plus on hover. Votes can be moved until the end. Done folds the panel and keeps the votes; spending every vote counts as done.
7. **The round's panel** sits at the top of the board for everyone on it: the name, a countdown (red in the last 10 seconds), how many of the people who joined are done ("7 of 10 done"), and for a voter the votes left. The starter and the owner open the count to see who is still voting, and have +1 min and End for everyone there.
8. **Nobody sees others' votes during the round, in both modes.** Each person sees only their own; the count of people done is the only shared number.
9. **Elements in the round are locked.** Until the end nobody can change their text or look, or delete them, and a frame holding one cannot be deleted; they can still be moved, so the team can group them, and still take reactions. They show a grey frame marked "In vote". The server holds the lock: a change or a deletion sent from any tab is put back. A deleted element can still turn up in an old round's results as "No longer on the board"; the results show each element's text as it was when the round ended.
10. **The end.** The timer runs out, or the starter or the owner presses End for everyone (with a confirmation that says how many have voted). They can also add a minute.
11. **Results.** At the end the panel opens for everyone in the round's audience: elements with at least one vote, most votes first, each with its count and a bar against the leader; a click flies to the element. An open round also shows who gave how many votes to each element; an anonymous one shows counts only. With no votes the panel says nobody voted.
12. **Past rounds stay.** Votes in the top bar, next to Share, opens the list that keeps every finished round with its results; the starter and the owner can rename or delete one.
13. **Votes live on the server, not in the shared board.** The live board is readable by everyone on it, so a vote put there would not be secret. The server keeps who gave which votes, because it has to enforce each person's limit; for an anonymous round it never hands out who voted for what, during the round or after. The guide says so plainly: an instance admin with access to the database could still read it.
14. **Calm.** No sound, no notification outside the board, no toast after the end: the join panel and the results panel are the whole interruption, and only on the board where the round runs.

## Requirements

- **FR-001**: Owners and editors MUST be able to start a round from a selection of stickies, cards and frames with the settings of Decision 2; viewers and guests MUST NOT.
- **FR-002**: A board MUST have at most one running round; starting a second MUST be refused.
- **FR-003**: Everyone signed in with the board open MUST learn of a start, an extension and an end at once, without a reload; guests MUST NOT.
- **FR-004**: The server MUST refuse a vote past the person's limit, on an element outside the round, a second vote on one element when the round allows one, and any vote after the end.
- **FR-005**: During a round no answer of the server MUST reveal another person's votes or any total; everyone MUST get how many joined and how many are done, and the starter and the owner who is still voting.
- **FR-006**: An anonymous round's results MUST hold counts only, and no API MUST tie a person to a vote of it; an open round's results MUST name the voters with their counts.
- **FR-007**: A round MUST end when its timer runs out, also with nobody on the board, and when the starter or the owner ends it.
- **FR-008**: Results MUST list the voted elements by count with a bar against the leader, the element's text at the end, a way to fly to it, and "No longer on the board" for a deleted one.
- **FR-009**: The board MUST keep finished rounds; the starter and the owner MUST be able to rename and delete one.
- **FR-010**: Elements in a running round MUST stay movable and take reactions, and the server MUST put back any other change to them, their deletion and the deletion of a frame holding them.

## Slices

1. `voting`: FR-001 – FR-010. The store and the API, the live messages, the settings, the join panel, voting on the board, ending, results, past rounds, the guide and the changelog.

## Out of scope

- Votes from guests of a public link.
- Voting on shapes, texts, pictures and modules.
- Several rounds at once on one board.
- Locking the position of elements during a round.
- Results in the board export, in a duplicated board and in undo.
- Sorting the board by votes or moving the winners on the board.
