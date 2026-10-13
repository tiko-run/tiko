# Feature Specification: Shapes

**Feature Branch**: `feat/shapes`

**Created**: 2026-10-13

**Status**: Owner told the agent on 2026-10-13 to build without waiting for G2; shown at G3.

**Input**: Owner's idea: the board has too few elements of its own. Add a standard pack of shapes, like the basic ones in Miro: circles, squares, rhombuses. Larger packs and uploaded vector shapes come later.

## Why

A board held cards, frames, sticky notes and text. A flowchart around the tasks (a decision, a store, a step) had to be faked with sticky notes. The brief listed arbitrary shapes under Won't; the owner moved a fixed pack of shapes out of it.

## Decisions

1. **Eight shapes for diagrams**: rectangle, rounded rectangle, ellipse, rhombus, triangle, parallelogram, hexagon, cylinder.
2. **One element type.** A shape is a `shape` node with `shape`, `text` and `color` in its data. A new shape is a new outline, not a new node type.
3. **Quiet by default.** A new shape is see-through with a 1.5px `--foreground` outline. It can take the card surface or one of the six sticky colors; a shape in a sticky color keeps dark text and outline in both themes.
4. **Drawn or placed.** Pick a shape in the toolbar gallery (`S`): its outline follows the pointer at 160 by 100. Drag to set the size, with the outline growing under the pointer, or click to place it as shown. The tool returns to Select and the text is ready to type.
5. **Text sits inside the outline**: centered, 14px, up to 500 characters, in the largest area the outline leaves. Text that does not fit is cut.
6. **A shape behaves like a sticky note** everywhere else: arrows from its four sides, frames, timers, copy and paste, search, live editing, view-only boards.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A flowchart next to the tasks (Priority: P1) 🎯

A person lays out a release: a rhombus "Certs valid?", a rectangle for each step, a cylinder for the database, arrows between them and to the task cards.

**Independent Test**: on the compose stack press `S`, pick each of the eight shapes, drag one out and click one in. Type a text, pick a fill, connect two shapes with an arrow, reload the page: the board reopens unchanged. `make smoke` saves and reopens a board with a shape.

**Acceptance Scenarios**:

1. **Given** the toolbar, **When** Shapes is clicked or `S` is pressed, **Then** a gallery shows the eight shapes with their names and none of them looks picked.
2. **Given** a picked shape, **When** the person drags on the canvas, **Then** the shape takes the dragged size, at least 40 by 40; a click places it 160 by 100 around the point.
3. **Given** a new shape, **Then** its text is being edited; double-click edits it later.
4. **Given** a selected shape, **Then** a toolbar offers no fill, a plain fill and six colors, and the shape resizes from its corners and sides.
5. **Given** a shape, **Then** arrows start and end on its four sides, a frame takes it in, a timer attaches to it, search finds its text, and the command palette has "Add <shape>" for each.
6. **Given** a view-only board, **Then** a shape shows with no editor, no color toolbar and no resize handles.
7. **Given** a saved doc with an unknown `shape`, **Then** the API answers 422.

## Requirements *(mandatory)*

- **FR-001**: The board MUST have a `shape` element with one of eight outlines, a text and a fill.
- **FR-002**: The API MUST accept `shape` nodes in a board doc and refuse an unknown outline.
- **FR-003**: The outline MUST follow the element's size when it is resized.
- **FR-004**: The toolbar MUST offer the shapes in one gallery, with a shortcut and palette commands.
- **FR-005**: A shape MUST take part in arrows, frames, timers, search, copy and live editing like a sticky note.

## Out of scope

- More shapes (star, block arrows, cloud, callouts, braces), packs by topic, uploaded SVG shapes.
- Outline color, width and dash; text size and alignment.
- Text that shrinks to fit, like a sticky note.
- Arrows that end on the outline instead of the sides of the box; clicks that pass through the empty corners.
- Rotation.
- A shape item in the right-click menu.
