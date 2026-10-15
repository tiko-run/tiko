# Feature Specification: Product tour and getting started

**Feature Branch**: `feat/tour`, `feat/getting-started`

**Created**: 2026-10-15

**Status**: Approved by the owner at G2 on 2026-10-15: state on the server per person, no special case for people who signed up earlier, the tour starts by itself only on an editable board.

**Input**: Owner's idea: a first-time user should see the main features in a short tour with small looping animations, and get a "Getting started" list of things to try. The tour can be run again from About, not from Settings. Nothing of it may slow down the board.

## Why

The welcome board teaches by example, but the features people miss are the ones without an obvious button: three ways to add tasks (key, JQL, pasted link), search filters, reminders and their list, the Gantt module, the focus timer with music. A short guided pass shows where each one lives, and a checklist turns "I saw it" into "I did it".

## Decisions

1. **Tour engine: driver.js**, MIT, no dependencies, about 5 KB gzipped. Shepherd.js and Intro.js are AGPL with a paid license and would block dual licensing; React Joyride is heavier; Onborda and NextStep need Next.js. driver.js and everything the tour shows are loaded with `import()` when the tour starts, so the board's main chunk does not grow by them.

2. **Seven steps, each under 25 words of text.** A step highlights a piece of the board's chrome (toolbar, capsule, top bar), never an element on the canvas: the canvas pans and zooms, so anything on it is shown by a loop instead.

   | # | Anchor | Shows |
   |---|---|---|
   | 1 | none, centered | What tiko is: live cards from your tracker on a canvas |
   | 2 | Toolbar "Task card" (C) | Add tasks three ways: a key, JQL, or a pasted link |
   | 3 | none, centered | ⌘K search with filters `status:`, `@assignee`, `type:`, `priority:`, `#frame`; ⌘P for commands |
   | 4 | Toolbar "Timer" (R) | A reminder on a card; the list of all timers in the top right and in the main menu |
   | 5 | Toolbar "Modules" (M) | A Gantt chart and dragging cards into it |
   | 6 | Focus capsule | Pomodoro timer and music |
   | 7 | About button | Frames, notes and arrows in one line, `?` for shortcuts, where to run the tour again |

   Anchors are `data-tour="…"` attributes, so a changed label or tooltip does not break a step. A step whose anchor is missing (a read-only board, the capsule hidden) is shown centered instead of being skipped.

3. **Loops instead of GIFs.** Each step carries a small animation built in DOM and CSS, in the style of the feature loops on tiko.run (`site/src/components/Features.astro`), ported to markup strings and CSS in the tour chunk. No video or image files: they take the theme's tokens, stay sharp at any zoom, weigh a few KB, and stop under `prefers-reduced-motion` on a still frame that still tells the story. Names, keys and tasks in them are made up (`DEMO-12`, "Anna").

4. **Motion.** The highlight moves between anchors with driver.js's own transition (about 300 ms); the popover fades and scales in as other popovers do (100 ms). With `prefers-reduced-motion` the transition and the loops are off.

5. **When the tour runs.** It starts once, by itself, the first time a person opens a board they can edit. Esc, the close button or Done ends it and marks it seen. While it runs, a click on the highlighted button or the dimmed board, board shortcuts and paste do nothing, so trying a button cannot break the tour.

6. **Run it again from About.** The About popover gets two rows above the links: "Take the tour" and "Getting started". Settings does not change.

7. **Getting started.** A small pill in the bottom left, next to About, reads "Getting started 3/8" and opens a list. Each item ticks itself when the person does the thing, and has a "Show me" button that runs only the matching tour step.

   | Item | Ticks when |
   |---|---|
   | Add a task card | cards are added by key, link or JQL (`addCards`) |
   | Paste a task link onto the board | a paste lands as task references |
   | Search with a filter | a search with a `status:`, `@`, `type:` or `priority:` chip picks a result |
   | Set a reminder | a timer is placed (`addTimer`) |
   | Open the list of timers | the timer panel opens |
   | Put a task into a Gantt chart | a Gantt gets a row from a card |
   | Start a focus session | the focus timer starts |
   | Connect your tracker | the person saves their own tracker token; not shown to demo visitors |

   When all items are done the pill shows a short check animation once and goes away. "Hide" in the list hides it at any time; About brings it back.

8. **State lives on the server, per person.** One JSON value per person in its own table, `{tour_seen, done: {item: done_at}, hidden}`, read with `GET /api/me/onboarding` and changed with `PATCH` ([contract](contracts/api.md)). A person sees the same progress in every browser.

9. **Budget.** The main chunk grows by at most 3 KB gzipped (the pill, the ticks and the About rows). The tour chunk with driver.js and the loops stays under 25 KB gzipped. Both are checked against `vite build` output before merge.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the main features once (Priority: P1) 🎯

Anna installs tiko and opens her welcome board. A centered card says what tiko is; Next moves the highlight to the Task card button, where a loop types `DEMO-12`, then `project = DEMO`, then pastes a link, and cards drop onto the board. Six more steps later she knows where search, reminders, the Gantt chart and the focus timer are. A week later she opens About, clicks "Take the tour" and runs it again.

**Independent Test**: as a new person on a fresh instance, open the first board: the tour starts; finish it, reload: it does not start again; About → "Take the tour" starts it. The main chunk size grows by 3 KB gzipped at most; driver.js is in a separate chunk loaded only after the tour starts (network log).

**Acceptance Scenarios**:

1. **Given** a new person opens their first editable board, **Then** the tour starts once.
2. **Given** they press Esc on step 3, **Then** the tour ends and does not start again in any browser.
3. **Given** a read-only or public board, **Then** the tour does not start by itself.
4. **Given** `prefers-reduced-motion`, **Then** the loops show a still frame and the highlight jumps without a transition.
5. **Given** the focus capsule is hidden, **Then** step 6 is shown centered.

### User Story 2 - Learn by doing (Priority: P1)

After the tour Anna sees "Getting started 0/8". She pastes a Jira link, sets a reminder and opens the timer list; the pill reads 3/8 without her ticking anything. She does not know how to put a task into the Gantt chart, clicks "Show me", and the tour shows only that step.

**Independent Test**: each item ticks from its own action in a component test with a fake API; progress survives a reload and shows the same in a second browser; "Hide" removes the pill and About brings it back; a demo visitor sees no "Connect your tracker" item.

**Acceptance Scenarios**:

1. **Given** the list is open, **When** the person adds a timer, **Then** "Set a reminder" ticks without a reload.
2. **Given** all items are done, **Then** the pill plays one check animation and disappears.
3. **Given** "Show me" on an item, **Then** only that tour step runs.
4. **Given** a demo visitor, **Then** the list has seven items.

## Requirements *(mandatory)*

- **FR-001**: The tour MUST load driver.js and its loops only when it starts.
- **FR-002**: The tour MUST start by itself at most once per person, and never on read-only or public boards.
- **FR-003**: The tour and the checklist MUST be reachable from About; Settings MUST NOT change.
- **FR-004**: Checklist items MUST tick from the person's actions; there is no manual tick.
- **FR-005**: Onboarding state MUST be stored per person on the server.
- **FR-006**: Loops MUST use made-up data and theme tokens, and MUST stand still under `prefers-reduced-motion`.
- **FR-007**: All tour and checklist text MUST be in English, short, without exclamation marks (DESIGN.md Copy).
- **FR-008**: The main chunk MUST NOT grow by more than 3 KB gzipped.

## Out of scope

- Tours for the Settings dialog, sharing or admin features.
- Video, GIF or screenshot media.
- Tracking tour completion in usage stats.
- Per-board or per-team checklists, custom checklist items.
- Highlighting elements on the canvas itself.
