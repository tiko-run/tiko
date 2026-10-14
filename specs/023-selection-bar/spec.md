# Feature Specification: Selection bar

**Feature Branch**: `feat/selection-bar`

**Created**: 2026-10-13

**Status**: Approved by the owner at G2 on 2026-10-13.

**Input**: Owner's idea: one shared control for the properties of whatever is selected, instead of a separate toolbar on each element type. The owner tried four throwaway prototypes (a bar above the selection, a chip that opens a panel, a pie menu, handles on the object) and picked the bar, together with named colors.

## Why

A sticky note and a shape each carry their own color toolbar, and it paints one element at a time. A frame and a text element have no properties at all. Ten notes are recolored with ten clicks ([#80](https://github.com/tiko-run/tiko/issues/80)), a frame cannot be told from the next one ([#81](https://github.com/tiko-run/tiko/issues/81)), and every new property would need its own control on every element type.

Color on a board already means something to the people who drew it: pink is a blocker, green is decided. The board does not know that, so nobody else does either.

## Decisions

1. **One bar for any selection.** It sits centered 12px above the box around the selected elements, at the same size at any zoom. With no room above it goes below; it never leaves the window. It hides while the selection is dragged or resized and on a view-only board. The color toolbars of the sticky note and the shape go away; a module keeps its own toolbar.
2. **Only what the selection shares.** The bar shows the properties every selected element has. Different values show as a stack of up to three swatches or as "Mixed". A property is applied to every selected element in one undo step.
3. **A mixed selection can be narrowed.** With more than one element type the bar starts with "Filter N objects": a list of the types with their counts; picking one keeps only that type selected. With one type it shows the type and the count ("3 sticky notes").
4. **Popovers open away from the selection**, one at a time, and close on Esc or a click outside.
5. **A value is previewed before it is picked.** Hovering a swatch or a value shows it on the canvas for this person only; nothing is saved or sent to others until the click.
6. **Properties by element** (slices in brackets):

   | Property | Sticky note | Shape | Frame | Text | Task card |
   |---|---|---|---|---|---|
   | Fill: six colors [1] | yes | yes, plus none and plain | yes, plus none | - | - |
   | Collapse [1] | - | - | - | - | yes |
   | Opacity, 10 to 100% in steps of 5 [2] | yes | yes | yes | yes | - |
   | Outline: 1, 1.5 or 3px, dashed [2] | - | yes | - | - | - |
   | Bold [2] | yes | yes | - | yes | - |
   | Text size: small, medium, large [2] | - | yes | - | yes | - |

   A sticky note keeps fitting its text to the note, so it has no text size. A task card stays fully opaque: it shows live data.
7. **Actions at the end of the bar**: add a timer (one element that can hold one), duplicate, delete. Timer and delete do what the right-click menu does today; duplicate is the Duplicate shortcut as a button.
8. **A color can carry a name on a board.** Each of the six colors takes a name of up to 24 characters, kept in the board doc and the same for everyone on the board. A named color shows its name next to the swatch in the bar. No names, no change: a board nobody named stays as it is today.
9. **A legend builds itself.** While at least one named color is in use, a legend sits at the bottom left above the About button: a swatch, the name and the count of elements for each named color in use. A click on a row selects every element of that color; double-click renames it. It collapses to one button and remembers that per person.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recolor a selection in one click (Priority: P1) 🎯

A person sorts the notes of a retro: selects seven of them and two shapes, and paints them all pink in one click. Then gives each frame of the board its own color.

**Independent Test**: on the compose stack select three sticky notes and a shape, pick a color in the bar: all four change, one Undo brings all four back. Select a frame, give it a fill, reload: the board reopens unchanged. `make smoke` saves and reopens a board with a filled frame.

**Acceptance Scenarios**:

1. **Given** one selected sticky note, **Then** the bar shows "Sticky note", the fill and the actions, and no toolbar of its own is on the note.
2. **Given** three sticky notes and two shapes selected, **When** a color is picked, **Then** all five take it and one Undo restores all five.
3. **Given** a selection of notes in two colors, **Then** the fill button shows both swatches and no swatch in the popover is marked as picked.
4. **Given** sticky notes and shapes selected, **Then** the fill popover has the six colors only; "none" and "plain" show when every selected element can take them.
5. **Given** a selection of two types or more, **When** a type is picked in "Filter N objects", **Then** only elements of that type stay selected and the bar follows.
6. **Given** a selection with task cards only, **Then** the bar has Collapse and the actions; with cards and notes together it has the actions only.
7. **Given** an open fill popover, **When** the pointer rests on a swatch, **Then** the selection shows that color; moving away restores it, and other people on the board see no change before the click.
8. **Given** a selected frame, **When** a color is picked, **Then** the frame is tinted with it (60% of the color on the light theme, 20% on the dark one) and its title and the elements inside stay readable in both themes.
9. **Given** a selection at the top edge of the window, **Then** the bar is below the selection; while the selection is dragged the bar is hidden.
10. **Given** a view-only or public board, **Then** there is no bar.
11. **Given** a saved doc with an unknown frame color, **Then** the API answers 422; a doc saved before this feature opens unchanged.

### User Story 2 - Style beyond color (Priority: P2)

A person fades the frames of the finished phase to 40%, marks an optional step of a flowchart with a dashed outline, and makes the heading text large and bold.

**Independent Test**: set opacity on a frame, a dashed 3px outline on a shape, large bold on a text element; reload and open the same board in a second browser: both show the same.

**Acceptance Scenarios**:

1. **Given** a selection where every element takes opacity, **When** the slider moves, **Then** the elements follow it live and releasing it makes one undo step.
2. **Given** elements with different opacity, **Then** the button reads "Mixed" and the slider starts at the highest value.
3. **Given** a selected shape, **Then** the outline popover offers 1, 1.5 and 3px and dashed; the outline keeps the shape's corners and joins.
4. **Given** a text element or a shape, **Then** small, medium and large set shape text to 12, 14 and 20px and a text element to 12, 16 and 24px (medium is each type's size before this feature), and Bold toggles 600 weight; a sticky note has Bold only.
5. **Given** a selection with a task card in it, **Then** the bar offers no opacity.
6. **Given** a saved doc with an opacity, an outline width or a text size outside the listed values, **Then** the API answers 422.

### User Story 3 - Colors with names (Priority: P3)

A team agrees that pink is "Blocker" and green is "Decided". A newcomer opens the board, reads the legend and clicks "Blocker" to see every blocker at once.

**Independent Test**: name pink "Blocker" from the fill popover, reload: the popover and the legend show the name. Open the board in a second browser: the same name; rename it there and the first browser follows. Click the legend row: every pink element is selected.

**Acceptance Scenarios**:

1. **Given** the fill popover, **When** a person names a color, **Then** the popover lists that color as a row with its swatch and name, and colors without a name stay plain swatches.
2. **Given** a named color in use, **Then** the legend shows its swatch, name and element count; a named color nobody uses is not in the legend.
3. **Given** the legend, **When** a row is clicked, **Then** every element of that color is selected and the bar shows for them; double-click edits the name in place, Enter saves, Esc cancels, an empty name removes it.
4. **Given** two people on a board, **When** one renames a color, **Then** the other sees the new name without a reload.
5. **Given** a view-only or public board, **Then** the legend shows and selects nothing and renames nothing.
6. **Given** a name longer than 24 characters or a name for an unknown color in a saved doc, **Then** the API answers 422.

## Requirements *(mandatory)*

- **FR-001**: The board MUST show one bar for any selection of elements that an editor can change (arrows alone get none; they are deleted with the key), with only the properties every selected element has.
- **FR-002**: A property picked in the bar MUST apply to every selected element as one undo step and reach other people on the board like any other edit.
- **FR-003**: A preview on hover MUST stay local: nothing is saved or sent before the pick.
- **FR-004**: A frame MUST take one of the six colors or none; the API MUST accept the field, default it to none and refuse an unknown value.
- **FR-005**: Elements MUST take opacity, outline, bold and text size as listed in decision 6; the API MUST validate each against its listed values and default a missing one to today's look.
- **FR-006**: A board doc MUST keep an optional name for each of the six colors, and the API MUST refuse an unknown color or a name over 24 characters.
- **FR-007**: The legend MUST list the named colors in use with their counts and select by color.
- **FR-008**: A board saved before this feature MUST open and look the same.

The board doc gains optional fields only. Node fields are listed in the [data model of spec 001](../001-live-jira-canvas/data-model.md); the color names also go into the live contract of [specs/009-realtime](../009-realtime/contracts/).

## Out of scope

- A style brush, copy and paste of a style, a style that sticks to the next new element.
- A fill that follows the status of a task.
- A filter by color name in search.
- Lock, align and distribute, layer order, grouping.
- Properties of arrows and of modules.
- Keyboard shortcuts for the properties and property commands in the palette.
- A custom color outside the six, an outline color, text alignment, fonts.
- A pie menu and handles on the object from the prototypes.
