# Feature Specification: Copy by dragging, rotate

**Status**: Approved at G2 on 2026-11-07.

**Input**: Two asks from early users who came from Miro and Figma: hold Alt and drag to leave a copy behind, and rotate elements.

## Why

- In Miro and Figma, Alt + drag pulls a copy out of a block and leaves the original in place. In tiko Alt + drag moves the block without snapping, so people who reach for the habit move the original instead.
- Nothing on the board can be turned. A sticky at an angle, a tilted arrow label or a rotated text is a common way to mark something in Miro.

## Decisions

1. **Alt + drag copies.** Dragging a selection with Alt held moves copies of it and leaves the originals where they were, as one undo step. The copies are what Cmd+D makes: same content, new ids, arrows between copied elements copied too, a frame copied with what is inside it. Alt counts when the drag starts, as in Miro: it may be let go during the drag. While it runs, the originals stay in place and a see-through copy follows the pointer.
2. **Moving without snapping moves to Ctrl / Cmd + drag.** The shortcut list and the guide follow. Alt no longer turns snapping off.
3. **Rotate stickies, shapes and text.** A selected one gets a rotate handle above its top edge; dragging it turns the element around its center, Shift snaps to 15°. Rotation is part of the element, so it syncs live, undoes, copies and is saved. Cards, frames, modules and reminders do not rotate: their content is read and clicked, not decoration.
4. **Arrows follow the turned shape.** An arrow tied to a rotated element meets its turned edge. If the canvas library cannot place arrow ends on a turned element cleanly, the first slice ships rotation without arrow ends following, and that is said in the guide.

## Requirements

- **FR-001**: Alt + drag MUST leave the originals in place and move copies, in one undo step; Alt at the start of the drag MUST decide, and a see-through copy MUST follow the pointer while the originals stay.
- **FR-002**: Ctrl / Cmd + drag MUST move without snapping; Alt MUST NOT.
- **FR-003**: Stickies, shapes and text MUST rotate by a handle, with 15° steps under Shift; the angle MUST sync, undo, copy and persist.
- **FR-004**: The board document gains an optional `rotation` (degrees) on those three element types; older boards read as 0. The live protocol does not change.

## Slices

1. `alt-copy`: FR-001, FR-002. Frontend only.
2. `rotate`: FR-003, FR-004. Document field on the backend, handle and rendering on the frontend.

## Out of scope

- Rotating cards, frames, modules, reminders; rotating a whole selection around its common center.
- Flipping, skewing.
