---
title: Adding tasks
description: Put tasks on a board by key, link, query or paste, and arrange things around them.
---

Each card shows the task's type, key, title and status from your tracker. Statuses refresh every 30 seconds with one batched request per board, and closed tasks are struck through. A colored dot in the corner of the screen shows whether every tracker syncs and, on click, why one fails.

## Ways to add a card

Pick the card tool (`C`) and type a key, a link, a range of keys or a query, like JQL in Jira. Several new cards land close together in columns of five, read top to bottom. What each tracker takes, with examples, is in [What you can add](../what-you-can-add/).

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
- **Minimap:** the whole board in the bottom right corner, with the part you see framed. Click a spot to go there or drag the frame. The map button under the zoom buttons hides it, and your browser remembers that. Phones and narrow windows don't show it.
- **Back:** after search or the timer list moves the board, press `B` or the arrow under the zoom buttons to return.
- **Far out:** at 20% zoom and below, elements turn into blocks in their colors, with grey bars where the text was, and keep their arrows. A big board stays smooth to pan and zoom. Elements still select and move there; to edit text or draw a new arrow, zoom in. A double-click on an element zooms in on it.
- **Resize** from a corner, or from one side to change only the width or the height.
- **Smart guides** snap what you drag or resize to the edges, centers and gaps of its neighbors.

Select one element or many, and a bar appears next to it: above the selection, or below it when there is no room. It shows what every selected element has in common: pick a fill and all of them take it, with one Undo to bring them back. Rest the pointer on a color to see it on the board before you pick. The bar also fades elements with an opacity slider, gives shapes a thicker or dashed outline, and sets text size and bold, each only where every selected element can take it. A selection of several kinds starts with "N objects": open it and choose a kind to keep only those selected. With two or more elements selected, Align lines up their edges or centers, and with three or more it spaces them evenly, as one Undo step. The bar also collapses cards, adds a timer, duplicates and deletes.

The board is saved on the server and reopens exactly as you left it. Keep several boards and switch between them from the menu or the palette.
