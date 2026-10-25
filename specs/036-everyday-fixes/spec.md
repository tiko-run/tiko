# Feature Specification: Everyday fixes

**Feature Branch**: one `feat/<slice>` per story, see [tasks.md](tasks.md)

**Created**: 2026-10-25

**Status**: Approved by the owner at G2 on 2026-10-25.

**Input**: Six small fixes from the ideas list, each one slice: selecting by touch, zooming with the mouse wheel, a forced password change for the first admin, Gantt fold-all and stages that push their neighbours, overlay scroll bars everywhere (#214), recent card inputs (#83).

## Why

- Selecting a few elements means wrapping each one whole in the selection box. An element half outside it stays unselected, and people redraw the box.
- On a mouse the wheel pans the board. People coming from Miro expect it to zoom, and Ctrl + wheel is not something they find.
- The first admin signs in with a password that sat in a log line, in `data/password` or in a hosting variable. On Railway or Render the instance is public from the first second, and nothing asks the owner to replace that password.
- In Planning, moving the first stage of a row to the right stops at the second one. To shift a plan by a week the person drags every stage, last one first. A plan with dozens of nested rows can be folded only row by row.
- Scroll bars keep a strip of space next to the content even when nothing scrolls: an empty band in Settings, the search list, popovers and the Gantt filter strip.
- A query typed into the card tool yesterday has to be typed again today.

## Decisions

1. **Select by touch.** The selection box selects every element it touches, not only the ones fully inside it. A frame is the exception: it is selected only when the box covers it whole, so a box that crosses into a frame picks its notes and leaves the frame alone. A box starts on empty board, as today; a drag that starts on a frame still moves the frame. An element the box does not touch is never selected, even one not yet measured.
2. **Mouse wheel: zoom with a mouse, scroll with a trackpad.** By default the board tells a mouse wheel from a trackpad by the wheel events themselves, as Miro does: a mouse wheel zooms around the pointer, a two-finger swipe pans, a pinch zooms. Settings → Preferences gets "Mouse wheel" with three options: that default, "Always zoom" and "Always scroll", kept per browser (`tiko.wheel`). The forced options are for mice the detection takes for a trackpad, such as free-spinning or touch wheels. In every mode Ctrl + wheel and a pinch zoom, Shift + wheel pans sideways, and dragging with the wheel held pans. Text fields, open modules and lists inside elements keep their own scrolling.
3. **The first admin replaces the password.** The admin that tiko creates on the first start, from `TIKO_PASSWORD` or the generated file, is marked as needing a new password. After signing in, that person sees one screen: a new password twice, with the same rules as today's password change, and no way past it except signing out. The mark clears once the password is changed, and the generated `data/password` file is deleted then. Admins of existing instances are not marked. The sign-in screen gets a small "First time here?" link to the guide section that says where the first password is (`TIKO_PASSWORD`, `data/password`, the API log); the screen itself shows nothing about the instance.
4. **Gantt: stages push, rows fold all at once.**
   - Dragging a stage by its body or stretching its end to the right pushes the later stages of the same row by the same number of days, keeping their gaps. Dragging to the left moves only that stage, down to the end of the previous one, as today. Alt while dragging moves the stage alone, also to the right, stopping at the next stage as today. Links between rows do not push other rows.
   - The header of the task column gets two buttons, "Expand all" and "Collapse all". They change every row with children at once, in one undo step, and the change reaches others like a single fold does today.
5. **Overlay scroll bars everywhere (#214).** Every scrolling area in the app uses the thin bars over the content that the expanded Gantt already has: they show while it scrolls or while a thumb is held, fade a second after, and take no space. One wrapper around the existing `OverlayScrollbars` replaces the browser bars in each area; wheel, trackpad, keyboard and thumb dragging scroll as before.
6. **Recent card inputs (#83).** The card tool keeps the last five distinct inputs that added at least one card, per browser (`tiko.card.recent`). An empty input shows them; arrow keys and Enter pick one, Escape closes the list. Nothing is sent to the server.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select by touch (Priority: P1) 🎯

A person drags a box across the top halves of four sticky notes and gets all four.

**Independent Test**: on the compose stack draw a box that crosses half of each of three notes: all three are selected. Draw a box from outside a frame over two of its notes: the notes are selected, the frame is not.

**Acceptance Scenarios**:

1. **Given** a note half inside the box, **Then** it is selected.
2. **Given** a box that crosses part of a frame, **Then** the frame is not selected and the notes it touches are.
3. **Given** a box that covers a whole frame, **Then** the frame is selected; **When** the box shrinks off part of it before release, **Then** the frame is no longer selected.
4. **Given** an arrow tied to a picked element, **Then** it is selected as today; an arrow tied only to a frame left out is not.

### User Story 2 - Zoom with the wheel (Priority: P1)

A person with a mouse zooms the board with the wheel and pans it with a trackpad swipe, like in Miro, without touching a setting.

**Independent Test**: in a new browser roll a mouse wheel over a note: the board zooms around it. Swipe two fingers on a trackpad: the board pans. Set "Always scroll": the mouse wheel pans; reload: the setting holds.

**Acceptance Scenarios**:

1. **Given** a new browser, **When** a mouse wheel rolls, **Then** the board zooms around the pointer within the zoom limits.
2. **Given** a new browser, **When** two fingers swipe on a trackpad, **Then** the board pans, as before this slice.
3. **Given** any mode, **When** Shift + wheel rolls, **Then** the board scrolls sideways.
4. **Given** any mode and an open module, **When** the wheel rolls inside it, **Then** the module scrolls and the board stays.
5. **Given** any mode, **When** Ctrl + wheel or a pinch is used, **Then** the board zooms.
6. **Given** "Always zoom", **When** a trackpad swipe or a mouse wheel rolls, **Then** the board zooms; **given** "Always scroll", **Then** both pan.

### User Story 3 - The first admin replaces the password (Priority: P1)

The owner deploys tiko to a public host, signs in with the password from the log and is asked for a new one before seeing any board.

**Independent Test**: start the stack on an empty `data/`, sign in with the generated password: the new password screen shows. Set one: the boards open, `data/password` is gone, and signing in again uses the new password. On an instance with existing people nothing changes.

**Acceptance Scenarios**:

1. **Given** a fresh instance, **When** the admin signs in, **Then** only the new password screen is shown, and every API call other than the password change, sign-out and `/api/auth/me` answers 403 with a code the web app knows.
2. **Given** the new password screen, **When** the same password as the current one is entered, **Then** it is refused.
3. **Given** the password changed, **Then** the mark is gone, other sessions of that person are signed out as with any password change, and `data/password` is deleted.
4. **Given** an instance upgraded from an earlier release, **Then** no admin is asked.
5. **Given** the sign-in screen, **Then** a "First time here?" link opens the guide section about the first password.

### User Story 4 - Shift a plan, fold it all (Priority: P2)

A planner moves the first stage of a row a week to the right and the two stages after it follow. Then they collapse the whole plan to its top rows.

**Independent Test**: in Planning drag the first of three stages five days right: all three move five days, gaps kept. Alt + drag it back: only it moves. Click "Collapse all": only top rows remain; one Undo brings back the previous folding.

**Acceptance Scenarios**:

1. **Given** stages 1, 2, 3 in a row, **When** stage 1 is dragged right, **Then** 2 and 3 move by the same days.
2. **Given** stage 1 stretched by its end to the right, **Then** 2 and 3 move by the same days.
3. **Given** stage 2 dragged left, **Then** only stage 2 moves and stops at the end of stage 1.
4. **Given** Alt held while dragging stage 1 right, **Then** it stops at stage 2, as today.
5. **Given** a plan with nested rows, **When** "Collapse all" is clicked, **Then** every row with children is folded; "Expand all" unfolds them; each is one undo step and a second browser sees the same.
6. **Given** a view-only board, **Then** the buttons fold for nobody and are not shown, as today's toggle.

### User Story 5 - Scroll bars that stay out of the way (Priority: P3)

A person opens Settings with a mouse and sees no empty strip at the edge; the bar shows while they scroll and fades.

**Independent Test**: in both themes scroll Settings, the search list, a popover with a long list and the Gantt filter strip: a thin bar shows while scrolling and fades after a second; no layout shift when it shows.

**Acceptance Scenarios**:

1. **Given** any scrolling area at rest, **Then** no bar and no strip of space are shown.
2. **Given** scrolling by wheel, trackpad, keyboard or a dragged thumb, **Then** it scrolls as before and the bar shows.
3. **Given** a bar shown, **Then** the content does not move.

### User Story 6 - Recent card inputs (Priority: P3)

A person opens the card tool and picks yesterday's query from the list instead of typing it.

**Independent Test**: add cards with three different inputs, reload, open the card tool with an empty input: the three show, newest first; arrow down + Enter adds the cards of the second one.

**Acceptance Scenarios**:

1. **Given** an input that added no card, **Then** it is not kept.
2. **Given** six distinct inputs, **Then** only the last five are kept; a repeated input moves to the top.
3. **Given** the list, **When** a character is typed, **Then** the list closes and the usual hints show.
4. **Given** the network panel, **Then** the list sends nothing.

## Requirements *(mandatory)*

- **FR-001**: The selection box MUST select every element it touches, except frames, which it MUST select only when it covers them whole.
- **FR-002**: By default a mouse wheel MUST zoom and a trackpad swipe MUST pan; Preferences MUST offer "Always zoom" and "Always scroll", per browser; Ctrl + wheel and pinch MUST zoom in every mode.
- **FR-003**: The admin created on the first start MUST change the password before any other API call succeeds; the mark MUST NOT apply to admins that exist before the upgrade, and the generated password file MUST be deleted once changed.
- **FR-004**: Dragging a stage right MUST push the later stages of its row by the same days unless Alt is held; "Expand all" and "Collapse all" MUST fold every row with children in one undo step.
- **FR-005**: Every scrolling area MUST use overlay bars that take no space and fade at rest.
- **FR-006**: The card tool MUST keep the last five distinct inputs that added a card, in the browser only.
- **FR-007**: Only story 3 MAY change the API contract or the database: one field in the person returned by `/api/auth/me` and `/api/me`, one error code, one column on people. The board document and the live protocol MUST NOT change.

## Success Criteria

- **SC-001**: A box crossing 200 elements on a 1000-element board selects them within one frame in Chromium, measured in the slice's PR.
- **SC-002**: On a fresh instance, no board, setting or task can be read with the first password until it is changed, checked by an API test over every router.
- **SC-003**: Shifting the first of 20 stages pushes all of them in one undo step, and a second tab shows the result within 200 ms.

## Out of scope

- A per-element "select by touch" setting, or lasso selection.
- Password rules beyond today's (a common-password list, reserved usernames), forced change for invited people, password expiry.
- Pushing other rows along links, pushing to the left, critical path.
- A synced recent list, favourite queries.
