---
title: Adding tasks
description: Put tasks on a board by key, link, query or paste, and arrange things around them.
---

Each card shows the task's type, key, title and status from your tracker. Statuses refresh every 30 seconds with one batched request per board, and closed tasks are struck through. A colored dot in the corner of the screen shows whether every tracker syncs and, on click, why one fails.

## Ways to add a card

Pick the card tool (`C`) and type a key, a link, a range of keys or a query, like JQL in Jira. New cards land in a neat grid. What each tracker takes, with examples, is in [What you can add](../what-you-can-add/).

## Paste

Press `⌘V` (`Ctrl+V`) on the board. Links copied from your tracker tabs or from GitHub, keys and ranges of keys become cards; any other text becomes a sticky note, placed at the cursor.

## Card details

Click a card for assignee, priority, last update and a link to the task. Links open in a new tab; Settings → Preferences can open them in this one. Collapse cards to one line when the board gets busy.

## Around the cards

- **Frames** (`F`) group cards. Drag cards in and out; moving a frame moves everything inside. A frame takes a fill color.
- **Sticky notes** (`N`) hold up to 2000 characters, and the text shrinks to fit the note.
- **Shapes** (`S`): rectangle, rounded rectangle, ellipse, rhombus, triangle, parallelogram, hexagon and cylinder, for a flowchart next to the tasks. Pick one, then drag to set its size or click to place it. A shape holds a short text and takes a fill color.
- **Text** (`T`) and **arrows** between any elements. An arrow can also point at an empty spot.
- **Pointers:** each creation tool shows its icon next to the crosshair, so you see which one is picked.
- **Back:** after search or the timer list moves the board, press `B` or the arrow under the zoom buttons to return.
- **Smart guides** snap what you drag or resize to the edges, centers and gaps of its neighbors.

Select one element or many, and a bar appears next to it: above the selection, or below it when there is no room. It shows what every selected element has in common: pick a fill and all of them take it, with one Undo to bring them back. Rest the pointer on a color to see it on the board before you pick. The bar also fades elements with an opacity slider, gives shapes a thicker or dashed outline, and sets text size and bold, each only where every selected element can take it. A selection of several kinds starts with "N objects": open it and choose a kind to keep only those selected. The bar also collapses cards, adds a timer, duplicates and deletes.

The board is saved on the server and reopens exactly as you left it. Keep several boards and switch between them from the menu or the palette.
