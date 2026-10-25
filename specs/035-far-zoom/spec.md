# Feature Specification: Far zoom

**Feature Branch**: `feat/far-zoom`

**Created**: 2026-10-24

**Status**: Approved by the owner at G2 on 2026-10-24.

**Input**: When a board is zoomed far out, draw each element as its outline and color instead of its full content, so a large board stays smooth and still reads as a map. Make fast zooming on a trackpad smooth on large boards.

## Why

Zoomed out, a person reads a board by its shape: where the clusters are, which colors, what is tied to what. Text is a few pixels tall there and nobody reads it, yet every element still draws its whole content and four arrow grips. On a board of 2000 elements in full view that is about 8000 grips and many thousands of text nodes. They make the board stutter when someone else moves things, and when you pan or zoom. A fast pinch on a trackpad over a 2000-element board drops to about 19 frames per second, with single frames of almost 300 ms: the zoom lags behind the fingers.

Other whiteboards draw less when you zoom out. Below about 20%, Miro shows sticky notes and cards as colored blocks with grey lines where the text was. It keeps arrows, frames and colors. From 21% it shows the text again.

## Decisions

1. **One threshold: 20%.** At zoom 0.2 and below the board is in far view, above it in full view. Zoom here means the same as in Miro, 100% is real size, but what decides is how tall text is on screen: sticky note text is 14px, so at 20% it is under 3 pixels and cannot be read. The slice confirms the value from screenshots at 15%, 20%, 25% and 30%. Our minimum zoom is 10%, so far view covers 10% to 20%. The switch is instant, with no fade. The same rule applies on view-only and public boards.
2. **What far view draws, by element:**
   - sticky note: its fill and corner radius, with two or three grey bars where the text is (none when it has no text);
   - shape: its outline, fill and dash, with one grey bar for its text;
   - text: grey bars, as many as its lines, at most three;
   - task card: its box, with a bar in the color of its status and one grey bar for the title;
   - frame: its outline and fill, with a grey bar for its title;
   - module (Gantt and others): its box and title, with a neutral fill in place of its content;
   - timer: as in full view (it is small);
   - arrows: every arrow, drawn as in full view; arrow labels, if any, are left out.
   Bars and fills come from theme tokens and look right in both themes. Selection outlines, other people's selection rings, search hits and the flash after a jump stay visible.
3. **No arrow grips in far view.** Arrows cannot be started from an element there, but every arrow already on the board stays drawn and tied to the right side of its elements, including elements first shown in far view. Drawing a new arrow needs full view.
4. **Moving still works.** Selecting, dragging, deleting, copying, undo and other people's live moves work in far view as in full view. Editing text does not: a double-click on an element zooms in at that point, as it does on the empty board.
5. **Fast zoom stays smooth at any zoom.** A pinch or a Ctrl + wheel follows the fingers on a large board. Costs seen in a profile today: elements that enter the screen during a zoom are mounted one by one and each sticky note fits its font with a forced layout; the zoom is written into a CSS variable on the board root on every frame, which likely restyles every element although only resize grips use it (to confirm in the slice); every zoom step wakes every element's store subscription. Far view removes the first and the last below 20%; the CSS variable is fixed for every zoom.
6. **Nothing else changes.** The board document, the API contract and the live protocol stay as they are. Far view is only how the browser draws the board.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A big board stays smooth zoomed out (Priority: P1) 🎯

A person zooms out on a planning board of 2000 elements to see all of it while a teammate rearranges a corner. The board keeps moving smoothly, and the clusters, colors and arrows are all there.

**Independent Test**: on the compose stack open a 2000-element board in two browsers, zoom the first to 10% and drag a sticky note in the second for 6 seconds. The first browser keeps at least 30 frames per second (SC-001), and it shows every arrow it shows in full view.

**Acceptance Scenarios**:

1. **Given** a board at 20% zoom, **Then** sticky notes, shapes, text and task cards are drawn as blocks with bars; **When** zoomed to 21%, **Then** their text shows again.
2. **Given** an arrow between two elements that were never on screen in full view, **When** the board is opened at 10%, **Then** the arrow is drawn between the right sides of both elements.
3. **Given** far view, **When** the pointer is over the side of an element, **Then** no arrow grip appears and dragging moves the element.
4. **Given** far view, **When** an element is dragged, **Then** it moves, its arrows follow, and others see the move live.
5. **Given** far view, **When** a sticky note is double-clicked, **Then** no editor opens and the board zooms in at that point.
6. **Given** a frame in far view, **Then** its title is a grey bar.
7. **Given** a selected element and an element someone else selected, **Then** both outlines show in far view.
8. **Given** the dark theme, **Then** the bars and fills of far view are readable against the board.

### User Story 2 - Panning and zooming stay smooth (Priority: P2)

A person pinches out on a trackpad to see the whole board and back in on one cluster. The zoom follows the fingers and does not stall when it switches from blocks to text.

**Independent Test**: on the 2000-element board, pinch from 50% to 10% and back for 6 seconds: frame times meet SC-002.

**Acceptance Scenarios**:

1. **Given** a 2000-element board in far view, **When** it is panned for 10 seconds, **Then** the median frame time meets SC-003.
2. **Given** a board in full view, **When** it is zoomed out across 20%, **Then** the elements switch at once; **When** zoomed back in, **Then** they turn back to full in batches over a few frames, so no frame stalls.
3. **Given** a board at 100%, **When** it is zoomed with Ctrl + wheel, **Then** no element's style is recomputed because of the zoom alone, except resize grips of selected elements.

## Requirements *(mandatory)*

- **FR-001**: At zoom 0.2 and below the board MUST draw elements in far view as listed in Decision 2; above 0.2 it MUST draw them as today.
- **FR-002**: In far view elements MUST NOT render arrow grips, and every arrow MUST stay drawn at the same ends as in full view, including arrows of elements first shown in far view. A task card has no size until it is drawn in full: one first shown in far view takes a placeholder block, its arrows end on that block, and they move to the card's edges once it is shown in full.
- **FR-003**: Select, drag, delete, copy, undo and live moves MUST work in far view; text editing MUST NOT open there, and a double-click on an element MUST zoom in at that point.
- **FR-006**: A zoom step MUST NOT restyle elements that do not depend on zoom.
- **FR-004**: Far view MUST use theme tokens only and MUST be readable in both themes.
- **FR-005**: Nothing in this spec MAY change the board document schema, the API contract or the live protocol.

## Success Criteria

- **SC-001**: On a 2000-element board in full view at 10%, with another browser dragging an element, the watcher keeps at least 30 frames per second in headless Chromium on the reference machine. For comparison: about 8.5 before PR #292, about 20 after it.
- **SC-002**: A fast pinch on the same board, from 50% to 10% and back for 6 seconds, keeps the median frame time at most 20 ms and no frame longer than 100 ms. Today in Chromium: about 19 frames per second, worst frame about 300 ms.
- **SC-003**: Panning the same board in far view for 10 seconds keeps the median frame time at most 20 ms.
- **SC-004**: At 10% the board draws as many arrows as are drawn on the same board when every element has been shown in full view first.

SC-001 to SC-003 hold in headless Chromium and in headless Firefox: a fast pinch lags in both today (Firefox: about 20 frames per second, worst frame about 450 ms), and people use both engines. Method and numbers go into the slice's PR.

### Result of the slice

Measured on the same machine, before and after. Met in Chromium: SC-001 (41 frames per second), the SC-002 median, SC-003 (median 17 ms) and SC-004 (all 200 arrows). Not met yet: SC-001 in Firefox (20 frames per second), the SC-002 longest frame (about 120 ms in Chromium and 180 ms in Firefox) and SC-003 in Firefox (median 32 ms). The rest waits for a follow-up on how often the board redraws while someone else drags.

### Result of the follow-up

Another person's drag used to redraw the board two or three times per frame. Now it redraws once, on the next frame. SC-001 is met in Firefox, 31 to 32 frames per second (it was 19 to 20), and in Chromium it is 51 (it was 32 to 41). The longest SC-002 frame and SC-003 in Firefox are still not met: they come from zoom and pan, which this change does not touch. The minimap is the next lever there. It does work for every element on each update, and hiding it gives Firefox about 45 frames per second during a drag.

## Out of scope

- Stages of detail below 20% (Miro's dots at 4%).
- Drawing far view on a single `<canvas>` instead of DOM elements.
- A setting to change the threshold or turn far view off.
- Faster panning in full view.
- Server memory of live boards (#124).
