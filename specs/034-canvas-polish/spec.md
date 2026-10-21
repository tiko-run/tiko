# Feature Specification: Canvas polish

**Feature Branch**: `feat/canvas-polish`

**Created**: 2026-10-22

**Status**: Approved by the owner at G2 on 2026-10-22.

**Input**: Four small canvas fixes that people meet every day, built without touching the board document or the live format.

## Why

Everyday moves on the board take more effort than they should:

- A shape, a sticky note or a frame grows only from its corners. Making a frame taller changes its width too. The side handle is a 1px line, and the arrow dot sits on its middle.
- Twenty cards added from a query land in a near-square block of five rows by four. People read a board in columns, and a long list of tasks is easier to scan top to bottom.
- Lining up six sticky notes means dragging each one against the guides.
- On a large board it is easy to lose your place. The only way back is zoom to fit.

## Decisions

1. **Resize from any side.** Every element that resizes today (sticky note, shape, text, frame, module) also resizes from each of its four sides. A side changes only its own dimension. The grip is 8 screen pixels wide at any zoom, with an `ew-resize` or `ns-resize` cursor. Where an arrow dot sits on a side, the dot wins under the pointer, and the side is grabbed on either side of it. Minimum sizes stay as they are. A task card still does not resize.
2. **New cards stack in columns of five.** Two or more cards added at once fill a column top to bottom, five per column, columns left to right: 16 cards make three columns of five and a fourth with one. Cards sit close: 12px between cards in a column, 16px between columns, measured from each card's real size, since a card is 1 to 4 lines tall and up to 320px wide. They are placed on a first guess and closed up as soon as they are measured, within the same undo step. The block is centered on the same point as today. One card still cascades from the viewport center or lands where it was dropped.
3. **Align and distribute from the selection bar.** With two or more elements selected the bar gets an Align button. Its popover has six alignments (left, center, right, top, middle, bottom) and, from three elements up, two distributions (equal horizontal gaps, equal vertical gaps). Alignment uses the box around the selection, as in Figma. Distribution keeps the two outermost elements in place. An element whose frame is also selected moves with the frame and is not aligned on its own. Arrows follow the elements they are tied to. One pick is one undo step, and it reaches others like a drag.
4. **A minimap at the bottom right**, above the zoom controls. It shows the board's elements as blocks (sticky notes and shapes in their fill, frames as outlines, cards and modules in a neutral token) and the visible area as a frame. A click moves the view there; dragging the frame pans. A button in the zoom controls hides and shows it, remembered per browser (`tiko.minimap`). It is shown by default, hidden on screens narrower than 640px, and works on view-only and public boards, since it only moves the view.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Resize from a side, cards in columns (Priority: P1) 🎯

A person makes a frame taller without making it wider, then adds twelve tasks from a query and reads them as three columns.

**Independent Test**: on the compose stack drag the bottom side of a frame down: only its height changes. Add 12 cards with one query: three columns of 5, 5 and 2. Undo puts both back.

**Acceptance Scenarios**:

1. **Given** a selected shape, **When** its right side is dragged, **Then** only the width changes, and the left side stays in place.
2. **Given** a selected sticky note at 25% zoom, **Then** the side grip is still 8 screen pixels wide.
3. **Given** a selected shape, **When** the pointer is on the arrow dot in the middle of a side, **Then** dragging starts an arrow, not a resize.
4. **Given** a selected task card, **Then** it shows no resize grips.
5. **Given** 16 cards added at once, **Then** they form columns of 5, 5, 5 and 1, top to bottom, left to right, centered where the grid was centered before.
6. **Given** a view-only board, **Then** no element shows grips.
7. **Given** cards of one and of four lines in one column, **Then** each gap between them is 12px and none overlap; columns stand 16px apart from the widest card of the column before.
8. **Given** a column of new cards, **When** Undo is pressed once, **Then** all of them are gone.

### User Story 2 - Align and distribute (Priority: P2)

A person selects six sticky notes from a brainstorm, lines up their tops and spaces them evenly in one row.

**Independent Test**: select three notes of different heights, pick "Align top", then "Distribute horizontally": the tops line up and the gaps are equal. One Undo restores the last step. A second browser sees the same.

**Acceptance Scenarios**:

1. **Given** one selected element, **Then** the bar has no Align button.
2. **Given** two selected elements, **Then** the popover has six alignments and no distribution; with three or more it has both.
3. **Given** elements inside a frame and outside it, **When** "Align left" is picked, **Then** they line up on the board, not inside their frame.
4. **Given** a frame and one of its children selected, **When** an alignment is picked, **Then** the child keeps its place inside the frame.
5. **Given** an arrow between two aligned notes, **Then** it follows them.
6. **Given** an alignment picked, **When** Undo is pressed, **Then** every moved element returns in one step.

### User Story 3 - Find your place on a big board (Priority: P3)

A person deep in one corner of a large planning board looks at the minimap, clicks the other cluster and is there.

**Independent Test**: open a board with elements far apart, click an empty part of the minimap: the view moves there. Hide the minimap and reload: it stays hidden.

**Acceptance Scenarios**:

1. **Given** a board, **Then** the minimap shows each element as a block and the visible area as a frame, in both themes.
2. **Given** the minimap, **When** a point is clicked, **Then** the view centers there; dragging the frame pans.
3. **Given** the minimap hidden by the button, **When** the page is reloaded, **Then** it stays hidden.
4. **Given** a window 600px wide, **Then** the minimap is not shown.
5. **Given** a public board, **Then** the minimap works and changes nothing on the board.

## Requirements *(mandatory)*

- **FR-001**: Elements that resize MUST resize from each side, changing only that side's dimension, with a grip of 8 screen pixels at any zoom; arrow dots MUST keep priority.
- **FR-002**: Two or more new cards MUST be placed in columns of up to five, filled top to bottom, 12px apart in a column and 16px between columns by their measured size, centered on the same point as before, in one undo step.
- **FR-003**: The selection bar MUST offer six alignments for two or more elements and two distributions for three or more, in board coordinates, as one undo step that syncs like a drag.
- **FR-004**: The board MUST offer a minimap that moves the view on click and drag, can be hidden per browser and is hidden below 640px.
- **FR-005**: Nothing in this spec MAY change the board document, the API or the live contract.

## Success Criteria

- **SC-001**: Panning a 1000-element board with the minimap shown stays within the frame times measured for spec 021 on the same machine.
- **SC-002**: Aligning 100 selected elements takes one undo step and shows within one frame for the other person.

## Out of scope

- Keyboard shortcuts and palette commands for align and distribute.
- Tidy up into a grid, aligning to a key object, smart spacing handles.
- Rotation.
- Resizing several elements at once.
- A "collect pin" that pulls tasks into a grid (idea 2), and changing the cascade of a single card.
- A minimap you can resize or move.
