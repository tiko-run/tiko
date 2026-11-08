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
- **Images:** paste a screenshot or a copied picture with `⌘V` (`Ctrl+V`), drop files from your computer onto the board, or press `I` or right-click the board and choose Add image to pick them. PNG, JPEG, WebP and GIF up to 25 MB each. A picture shows the moment you add it and uploads behind it; if an upload fails, the picture says why and offers Retry. If one never finishes, for example because the tab was closed, the picture says so after two minutes and anyone who can edit the board can pick the file again. The board loads a smaller copy that is as sharp as the picture is on your screen, and the original only when you zoom in close, so a board full of 4K screenshots stays as quick to pan and zoom as one of notes. A GIF plays when it is at least 160 pixels wide on your screen and shows its first frame when smaller, or when your system asks for reduced motion. Location and camera data are removed from photos. See [Pictures](../data-and-upgrades/#pictures) for where they are kept.
- **Text** (`T`) and **arrows** between any elements. An arrow can also point at an empty spot.
- **Pointers:** each creation tool shows its icon next to the crosshair, so you see which one is picked.
- **Minimap:** the whole board in the bottom right corner, with the part you see framed. Click a spot to go there or drag the frame. The map button under the zoom buttons hides it, and your browser remembers that. Phones and narrow windows don't show it.
- **Mouse wheel:** a mouse wheel zooms around the pointer and a two-finger swipe on a trackpad pans, as in most whiteboards. A pinch and Ctrl + wheel zoom, Shift + wheel pans sideways, and dragging with the wheel held pans. If your mouse pans instead of zooming, set Settings → Preferences → Mouse wheel to Always zoom.
- **Back:** after search or the reminder list moves the board, press `B` or the arrow under the zoom buttons to return.
- **Far out:** at 20% zoom and below, elements turn into blocks in their colors, with grey bars where the text was, and keep their arrows. A big board stays smooth to pan and zoom. Elements still select and move there; to edit text or draw a new arrow, zoom in. A double-click on an element zooms in on it.
- **Resize** from a corner, or from one side to change only the width or the height.
- **Rotate** a sticky note, a shape, a text or an image: select it and drag from just outside any corner, where the pointer turns into a circular arrow. The angle shows next to the pointer, positive counterclockwise and negative clockwise, as in geometry, and lights up when the element sits straight, diagonal or upside down: it pulls in to those from a few degrees away, so a crooked element is easy to set right again. Hold `Shift` to turn in 15° steps. A turned element still resizes from its own sides and corners, and its arrows follow its turned sides.
- **Smart guides** snap what you drag or resize to the edges, centers and gaps of its neighbors. Hold `⌘` or `Ctrl` while you drag to move without them.
- **Copy by dragging:** hold `Alt` and start dragging; you can let go of `Alt` after that. The originals stay where they were, and their copies follow the pointer and land where you drop them, arrows between them included. One Undo takes the copies back.

Drag a box from an empty spot to select several elements: it takes every element it touches, and a frame only when it covers the whole frame, so you can pick notes inside a frame without the frame. Select one element or many, and a bar appears next to it: above the selection, or below it when there is no room. It shows what every selected element has in common: pick a fill and all of them take it, with one Undo to bring them back. Rest the pointer on a color to see it on the board before you pick. The bar also fades elements with an opacity slider, gives shapes a thicker or dashed outline, and sets text size and bold, each only where every selected element can take it. A selection of several kinds starts with "N objects": open it and choose a kind to keep only those selected. With two or more elements selected, Align lines up their edges or centers, and with three or more it spaces them evenly, as one Undo step. The bar also collapses cards, adds a reminder, duplicates and deletes.

The board is saved on the server and reopens exactly as you left it. Keep several boards and switch between them from the menu or the palette.
