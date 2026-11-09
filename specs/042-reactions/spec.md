# Feature Specification: Reactions on stickies and cards

**Status**: Approved by the owner at G2 on 2026-11-09.

**Input**: Teams run retrospectives on tiko boards and asked for likes on stickies, and for votes, open and anonymous. This spec covers the likes: open emoji reactions with a count. Timed voting sessions, anonymous or open, are a later spec; they need the server to keep votes out of the shared board.

## Why

- In a retro everyone writes stickies, and then the team has to see which ones people agree with. Today they draw dots or type "+1" into the text, which clutters the sticky and nobody can count.
- A reaction is the smallest way to say "me too" without a word in the discussion.
- Which fog does this clear: which stickies and tasks the team cares about, and who cares about them, is seen at a glance.

## Decisions

1. **Stickies and task cards take reactions.** Retro notes are stickies, and a team often wants to mark tasks too. Shapes, texts, pictures, frames and modules take none.
2. **A fixed set of six emoji.** 👍 ❤️ 🎉 😂 🤔 👎, the same set on every board, with no picker. Six is enough to agree, celebrate, laugh, doubt and disagree, and a fixed set keeps the row of reactions short and the same for everyone. They are drawn as images, not with the system font, so every computer shows the same picture.
3. **One reaction per emoji per person.** A click on a reaction under an element adds yours; a second click takes it back. A person can put several different emoji on one element.
4. **Reactions sit under the element.** A row of chips along the bottom edge, each with its emoji and count, your own chips highlighted. Elements without reactions show nothing. A smiley button to add one appears when the pointer is over the element or the element is selected, and in the selection bar. In the selection bar a reaction goes on every selected sticky and card at once; when all of them already have yours, the click takes it off all of them.
5. **Reactions are open.** Hovering a chip shows who reacted: "You" first, then names, up to five, then "and N more". A click on "and N more" opens the whole list in a small scrolling panel next to the chip, closed with Escape or a click outside. A person who left the workspace shows as "Former member"; names come from the workspace, as the share picker shows them to everyone signed in already. A public link guest sees the counts and no names, as guests see no people today.
6. **Owners and editors react; viewers and guests only see.** Viewers and guests have no write path into the board today, and a retro is run by the people who work on the board.
7. **Reactions are not a board edit.** Undo does not take a reaction back and does not bring one back; the chip itself does that. A copy of an element starts with no reactions. Moving an element, changing its text or its colour keeps them.
8. **No notifications.** Nobody is told that someone reacted: the count on the board is the whole feature (principle 5, Calm).
9. **Reactions live with the element on the board** and travel with live sync, one data field per person (`reaction:<person id>` with that person's emoji), so two people never write the same field. They are open by nature, so keeping them in the shared board is fine; anonymous votes, which must stay hidden, are why the voting spec needs a server-side store instead.

## Requirements

- **FR-001**: A sticky and a task card MUST be able to carry reactions: for each of the six emoji, the ids of the people who put it. The board model MUST keep them on these two types, ignore them on others as it ignores any unknown field, and refuse unknown emoji and more than 1000 people on one element. Older boards read unchanged.
- **FR-002**: Two people reacting to the same element at the same moment MUST both keep their reaction, with any emoji.
- **FR-003**: Owners and editors MUST be able to add and take back their own reaction from the element's smiley button, from its chip and from the selection bar for several elements at once, by the rules of Decisions 3 and 4. Viewers and guests MUST NOT see the button.
- **FR-004**: The chips MUST show each emoji with its count and highlight the viewer's own; hovering a chip MUST show who reacted by Decision 5, a click on "and N more" MUST show the whole list, and a guest MUST see counts only.
- **FR-005**: Undo and redo MUST NOT add or remove reactions; a copy, a paste or a duplicate MUST start without reactions.
- **FR-006**: Reactions MUST NOT trigger notifications, toasts or sounds.
- **FR-007**: The chips MUST stay readable at the zoom levels where a sticky's text is shown and hide with the text when the board is zoomed far out.

## Slices

1. `reactions`: FR-001 – FR-007. The model, the chips, the smiley button and the selection bar, who reacted, the guide and the changelog.

## Out of scope

- Voting sessions with a timer, votes per person, anonymous and open results. Next spec, members only, no guests.
- Any emoji beyond the six, or a set chosen per board.
- Reactions from viewers and public link guests.
- Reactions on shapes, texts, pictures, frames and modules.
- Sorting or filtering the board by reactions.
- Comments.
