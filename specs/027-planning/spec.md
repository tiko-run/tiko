# Feature Specification: Planning mode

**Feature Branch**: `feat/planning-stages`, `feat/planning-people`, `feat/planning-time-off`, `feat/gantt-fields`, `feat/gantt-views`, `feat/gantt-working-days`, `feat/planning-workload`

**Created**: 2026-10-16

**Status**: Approved by the owner at G2 on 2026-10-16.

**Input**: Teams often plan in a spreadsheet: each task row is cut into stages (analysis, build, acceptance, a pause) with the people of each stage, time off sits on the same timeline, Priority and Size are columns, and the plan is filtered by quarter and by team. The owner wants people, priority and focus to become part of tiko as an opt-in Planning mode: shared mechanics that the Gantt uses first and other modules use later. Most tiko users only draw diagrams, so none of this may show up for them.

## Why

The Gantt shows when a task runs, not who works on it or in which phase. Leads keep that in spreadsheets because no tool shows stages and people on one line, and because people take part in several plans at once. Planning mode adds stages with people to Gantt rows, one list of people per instance with their time off, columns that inherit down the task tree, filters that can be saved, and a person's workload across every board.

## Decisions

1. **One instance switch, off by default.** Settings → Planning holds the switch; only admins can change it. With Planning off the Gantt works as it does today: one bar per row, no stage colors, no columns, filters, people or time off. Turning it off keeps every stage, person and value, and turning it on again shows them as they were. People, stage types, fields and views belong to the instance, not to the Gantt, so a later module reads the same data.

2. **General, not one team's process.** Nothing names a level of the task tree (epic, hypothesis, project): rows nest as they do today. Stage types are a library the instance edits, with neutral defaults. Quarter, budget or anything else a team tracks is a custom field. Standard fields are only Priority, Size and Team, which most teams have.

3. **Stages live inside a Gantt row.** A row gets `stages`: ordered, non-overlapping, each with a type, start, end and people ([contract](contracts/gantt.md)). The row's own `start` and `end` always equal the span of its stages, so dependency lines, parent summaries and the Planning-off view keep working unchanged. A row without stages draws its bar as today; with Planning on that bar reads as a stage without a type ("No stage", muted), and picking a type for it makes it the first stage with the same dates. Deleting the last stage leaves a plain bar with the same dates. At most 20 stages per row.

   - Drag across an empty part of a row to add a stage; a click adds one week (5 days with working days only, 7 otherwise). The new stage starts and ends inside the free gap and stops at its neighbours.
   - A new stage takes the type after the previous stage's type in the library, skipping "On hold"; the first one takes the first type.
   - A stage drags as a whole or by its 6px ends, never over a neighbour. A click opens its popover: type chips, "+ New type", dates with the number of working days, people, "Delete stage".
   - A parent row draws a summary bar over its children. A row that gains children keeps its own stages hidden and shows them again once it has none, so indenting a row under it loses nothing.
   - A task card dropped into the Gantt still becomes a row with one bar, exactly as today.

4. **Stage types are a library for the instance.** A type has a name and one of 8 hues; its fill and text follow the sticky note lightness from DESIGN.md. Planning starts with Discovery, Design, Build, Review and On hold. Types are added from the stage popover or Settings → Planning → Stages, renamed and recolored in Settings. Removing a type archives it: stages that use it keep their color and name, new stages cannot pick it.

5. **People are a directory, not accounts.** Settings → People stays the list of accounts. Planning has its own list in Settings → Planning → People and behind a "People" button in the Gantt controls: a name, teams (free text, several), time off, and where the person came from ("Added by hand", "Tracker assignee"). Most of these people never sign in to tiko. A person is added three ways:

   - by hand in the list;
   - on the fly in a stage popover: typing an unknown name offers "+ Add “Name” to people";
   - from the tracker: the stage popover also suggests the assignees of the tasks in this Gantt who are not in the list yet, marked "From tracker"; picking one adds them. Assignees are never imported in bulk, so the list holds only people someone chose to plan.

   A person's tracker assignee and their stages are independent: the tracker says who owns the task now, a stage says who is planned for that phase. Removing a person archives them: old stages still show the name, muted, and the person is not offered again. Every person with an account can edit the list; viewers of a public link and demo visitors cannot.

6. **People on the bar.** Each Gantt chooses where names show: inside the stage after its type ("Build · Anna, Ivan") or in a line under the stage, like the spreadsheet. The row grows from 32 to 48px in the second case.

7. **Time off belongs to the person.** It is a list of date ranges with no reason field: the dates are enough for planning, and a reason ("sick leave") would be health data. It is added in the person's card or by dragging across the "Time off" lane at the top of a Gantt and picking who is away. The lane shows only when at least one person with a stage in this Gantt is away inside the visible range; overlapping ranges stack. A stage whose person is away on any of its days gets a 2px `--destructive` outline, a "!" before its type, and "Anna is away Mon Oct 5 – Fri Oct 9" in its tooltip and popover.

8. **Fields are columns that inherit down the tree.** A field has a name and is standard or custom. Columns come from a "+" at the end of the column headers (pick fields, or type a new one) and are chosen per Gantt, up to 6. A value is short text in the row, up to 100 characters, typed straight into the cell. An empty cell shows the nearest ancestor's value in muted text and filters use that inherited value; typing a value overrides it for this row and its children. Values live in the Gantt row, not on the tracker task, the same way plan dates live on the board only.

9. **Views are saved filters.** Chips above the Gantt filter by any field or by Person. Values of one field match any of them, different fields must all match, and the parents of matching rows stay visible. A comma-separated value ("Q4, Q1") matches each part. Team also matches rows where a person of that team has a stage, so "where does team Web take part" works across teams. The active filters belong to the Gantt, like its scale. "Save as view" stores the set under a name for the instance, and every Gantt lists the saved views as pills.

10. **Working days.** A Gantt can show working days only: Saturday and Sunday columns disappear, stages snap to working days, and durations count working days. Days off are an instance list of dates in Settings → Planning (no country calendars); they are shaded like weekends and not counted. With Weeks the header reads months over weeks, the way plans are discussed; Months keeps quarters on top.

11. **Workload across boards.** A person's card in the People list shows twelve weeks from the current one: a strip with the number of stages each week, red where two stages overlap on a working day, time off hatched. Under it, every stage of the person from every Gantt: type, row title, board name and dates, a click opens that board. A stage on a board the viewer cannot open shows only "Busy" and its dates. The server keeps an index of stages per person, rewritten for a board each time it is saved, so the card never scans every board. Hours, capacity and money are not part of this spec.

12. **Budget.** The main chunk grows by at most 8 KB gzipped over all seven slices, checked against `vite build` before each merge. A Gantt with 200 rows and 20 stages each keeps dragging at 60 fps on the reference laptop from spec 019.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cut a task into stages (Priority: P1) 🎯

Anna, an admin, turns on Planning in Settings. In her Gantt she drags across the empty part of the "Checkout UI" row: a Discovery stage appears. She drags further right: Design follows. She clicks the existing bar of "Payment API", picks Build, and it becomes a stage with the same dates.

**Independent Test**: fresh instance, Planning off: the Gantt looks and saves exactly as before (snapshot of the content). Turn it on, add three stages by dragging, one by a click, move one into its neighbour (it stops), reload: stages stay. Turn Planning off: one bar per row with the span of its stages; on again: the stages are back.

**Acceptance Scenarios**:

1. **Given** Planning is off, **Then** the Gantt has no stage colors, no "No stage" label and no new controls.
2. **Given** a row with Discovery and Build, **When** Anna drags Build to the left, **Then** it stops at Discovery's end.
3. **Given** a row with stages, **Then** its `start` and `end` equal the first stage's start and the last stage's end, and its dependency lines attach there.
4. **Given** a card dropped into the Gantt, **Then** it becomes a row with one bar, as today.
5. **Given** a stage of an archived type, **Then** it keeps its name and color, and the type is not offered in the popover.
6. **Given** a member without admin rights, **Then** the switch in Settings → Planning is read-only.

### User Story 2 - Put people on stages (Priority: P1)

Anna clicks the Build stage, types "Iv" and picks Ivan; she types "Petra", who is not in the list, and adds her on the fly. The popover also offers Oleg, the assignee of one of the tasks, marked "From tracker". She switches the Gantt to show names under the bars.

**Independent Test**: add a person by hand, one on the fly, one from the tracker suggestions; reload: all three are in Settings → Planning → People with their source; the stage shows "Build · Ivan, Petra"; switching to names under the bars grows the rows to 48px. A public link viewer sees the names but cannot open the popover.

**Acceptance Scenarios**:

1. **Given** a Gantt with tracker tasks, **Then** the suggestions list their assignees who are not in the directory, and nobody is added until picked.
2. **Given** an archived person, **Then** old stages show their name muted and the suggestions leave them out.
3. **Given** two Gantts on different boards, **Then** both pick people from the same list.

### User Story 3 - See who is away (Priority: P1)

Anna drags across the Time off lane over Oct 5–9 and picks herself. Her Discovery stage that week turns red with "Anna is away Mon Oct 5 – Fri Oct 9". In another Gantt where she has a Review stage the same week, it is red too.

**Independent Test**: a Gantt whose people have no time off has no lane. Add time off from the lane and from the person's card; both show on every Gantt where the person has a stage, stacked when they overlap; a stage overlapping it is outlined; remove it and the outline goes.

### User Story 4 - Columns that inherit (Priority: P2)

Anna adds Priority, Size and a custom "Quarter" column. She types "Q4" on the parent "Checkout redesign"; both children show "Q4" in gray. She types "Q1" on one child, which then shows "Q1" in normal text.

**Independent Test**: add a custom field from "+", fill a parent, see the inherited value on children, override one, clear it to inherit again; reload; the field appears in a second Gantt's "+" list.

### User Story 5 - Filter and save a view (Priority: P2)

Anna filters Quarter: Q4 and Team: Web. Rows of other teams disappear except "Partner onboarding", where Mia from Web has a stage. She saves it as "Web in Q4"; a teammate opens another Gantt and picks the same view.

**Independent Test**: filters by a custom field, by Team through a person's team, by Person; parents of matches stay; a value "Q4, Q1" matches Q1; a saved view is listed on another board; the filters survive a reload.

### User Story 6 - Plan in working days (Priority: P3)

Anna turns on "Working days only": weekends vanish, the header reads October over 5–9, 12–16. She adds Nov 4 as a day off in Settings; it is shaded and a stage across it counts one day less.

**Independent Test**: toggle, check the columns, snapping and the working-day count in the tooltip; add a day off; the Weeks header shows months over weeks in both modes.

### User Story 7 - A person's workload (Priority: P3)

Ivan is in Build on one board and in Design on another the same week. Anna opens Ivan's card: the week is red, and both stages are listed with their boards. One of them is on a board Anna cannot open: it shows "Busy" with the dates only.

**Independent Test**: two boards with overlapping stages for one person: the strip counts 2 and turns red; a click on a row opens its board; for a viewer without access to one board the row has no title or board name; saving a board updates the card without a restart.

### Edge Cases

- A row's dates are changed through the API without stages: the row stays a plain bar.
- A Gantt from a board copied before Planning existed: no stages, no columns, opens as today.
- Working days only, and a stage that covered only a weekend: drawn 4px wide, still clickable.
- A filter matches nothing: "No tasks match these filters" in the body; the chips stay.
- Planning switched off while someone has a stage popover open: the popover closes.
- 200 rows with 20 stages: within the content limits; the API rejects a 21st stage with 422.

## Requirements *(mandatory)*

- **FR-001**: Planning is an instance setting, off by default, changed by admins only; the Gantt with Planning off renders and saves as before.
- **FR-002**: Gantt rows take `stages`, `values`; Gantt content takes `columns`, `filters`, `people`, `workingDays` ([contract](contracts/gantt.md)); content saved before this spec stays valid.
- **FR-003**: Stage types, people, fields, saved views and days off are instance data behind `/api/planning` ([contract](contracts/api.md)); removing a type or a person archives it.
- **FR-004**: Time off is stored on the person as date ranges with no reason.
- **FR-005**: Tracker assignees reach the directory only when someone picks them.
- **FR-006**: The workload of a person lists stages from every board, hiding title and board name where the viewer has no access.
- **FR-007**: All UI text in English; dates as "Mon Oct 5", 24-hour.

## Out of scope

- Money, hours and capacity per person. They need sizes turned into time and come with their own spec.
- Other modules (a board of columns) reading this data.
- People from chat groups or a webhook; linking a planning person to a tiko account.
- Country calendars; holidays come from the manual list.
- Writing stages, people or field values back to the tracker.
- Dependency lines between single stages; lines connect rows, from the end of a row's last stage to the start of the next row's first. Added when users ask.
- Field types beyond text (numbers, single choice with colors).
- Planning on the demo instance with lists visitors can change: visitors share one instance, and a shared people list would leak between them. The demo shows a fixed sample instead ([spec 031](../031-demo-planning/spec.md)).
