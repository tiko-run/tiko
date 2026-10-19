# Feature Specification: Planning on the demo

**Feature Branch**: `feat/demo-planning`

**Created**: 2026-10-19

**Status**: Approved by the owner at G2 on 2026-10-19.

**Input**: The owner wants the demo to show the whole Gantt, Planning mode included, from the first click. [Spec 027](../027-planning/spec.md) left Planning out of the demo because its lists are shared by the whole instance.

## Why

Planning mode is the part of tiko that sells it to a team lead, and on demo.tiko.run nobody can see it: the API answers `enabled: false` there. A visitor gets a Gantt with plain bars and never learns that rows split into stages with people, columns, filters and time off.

The shared lists are the reason Planning stays off. Stage types, people, fields, views and days off belong to the instance, and every visitor of the demo lives on the same instance. If visitors could edit them, one person's names would show up on everyone's Gantt. A fixed sample library solves that: everyone reads the same made-up people and types, and nobody writes to them.

A visitor also does not learn where their boards live. Nothing says the demo is a public server, so someone may paste real work into it.

## Terms

- **Sample library**: the stage types, people with teams and time off, and fields that the demo instance holds. tiko writes them itself; they are made-up.

## Decisions

1. **Planning is always on for a demo instance** (`TIKO_DEMO`). No admin switch. `GET /api/planning` answers with the sample library and `"sample": true`.
2. **The sample library is read-only.** Every write under `/api/planning` stays `403` on the demo, as it is today. The Gantt hides what writes to the lists: "+ New type", adding a person or time off, saving a view, editing days off, and Settings → Planning. Everything a person does on their own board works: stages, picking types and people, column values, filters, working days, the people layout.
3. **tiko writes the sample library at start and once a day.** Fixed ids (for example `demo-build`, `demo-anna`), so welcome boards keep pointing at them. Time off is set relative to today, so "away next week" stays true on a long-running instance. Rewriting replaces only the sample rows.
4. **Workload stays off on the demo.** It counts stages on every board of the instance, which on the demo means other visitors' boards. The workload entry is hidden when `sample` is true.
5. **The demo welcome board shows Planning.** Its Gantt gets stages with people on its task rows, the Priority, Size and Team columns with values, working days on, and a person whose time off overlaps a stage, so the red outline shows. A fresh self-hosted install keeps today's welcome Gantt: Planning is off there.
6. **The demo says it is a public server.** The first screen and the tooltip of the "Demo · N days" mark say: your boards are visible only to you, they are deleted after 7 days without a visit, and real or confidential data does not belong here.
7. **A public link on the demo carries the sample names**, as it does on any instance with Planning on.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A visitor sees the full Gantt (Priority: P1) 🎯

A visitor presses "Try the demo". Their welcome board opens with a Gantt whose task rows are cut into stages such as Discovery, Build and Review, with names under the stages, Priority, Size and Team columns, weekends hidden, and one stage outlined red because its person is away. They drag a stage, add a stage, pick Ben for it, filter by team Web and expand the Gantt to full size.

**Independent Test**: start the stack with `TIKO_DEMO=true`, press "Try the demo": the welcome Gantt shows stages, people, columns and a red outline. Add a stage and assign a person: it saves and survives a reload.

**Acceptance Scenarios**:

1. **Given** a demo instance, **When** a visitor opens their welcome board, **Then** the Gantt shows stages, people, the three columns with values and working days only.
2. **Given** a visitor on the demo, **When** they open a stage popover, **Then** they can pick any sample type and person, and there is no "+ New type" or "Add person".
3. **Given** two visitors, **When** one changes stages and values on their board, **Then** the other's board does not change, and neither can change the sample lists (`403`).
4. **Given** a demo instance running for a week, **Then** the sample time off still falls around today.

### User Story 2 - The demo says where boards live (Priority: P2)

A visitor reads on the first screen and under the demo mark that their boards are visible only to them, are deleted after 7 days without a visit, and that real data does not belong on the demo.

**Independent Test**: open the demo start screen and hover the demo mark: both show the text.

### Edge Cases

- A demo database from before this slice has empty Planning tables: the first start writes the sample library.
- A board copied to a self-hosted instance keeps the sample ids; that instance does not know them, so stages keep their place without names, as spec 027 already allows.
- An instance that turns `TIKO_DEMO` off keeps the sample rows as ordinary Planning data; Planning stays off there until an admin switches it on.

## Requirements *(mandatory)*

- **FR-001**: On a demo instance `GET /api/planning` answers with the sample library and `"sample": true`; elsewhere `sample` is `false`. The contract change goes into `specs/031-demo-planning/contracts/` before the code.
- **FR-002**: Writes to `/api/planning` and workload stay `403` on a demo instance.
- **FR-003**: The sample library is written at start and once a day with fixed ids; only made-up names (rule 8).
- **FR-004**: The demo welcome board's Gantt uses the sample library; the self-hosted welcome board does not change.
- **FR-005**: The Gantt and Settings hide every control that writes to the Planning lists, and the workload, when `sample` is true.
- **FR-006**: The public board payload carries the sample names on a demo instance.
- **FR-007**: The demo start screen and the demo mark tooltip say the boards are private, deleted after 7 days without a visit, and not for real data.
- **FR-008**: `CHANGELOG.md` line; the guide's Gantt page says the demo shows Planning with sample people.

## Success Criteria *(mandatory)*

- **SC-001**: A visitor sees stages, people and columns on the first screen of the welcome board, without opening Settings.
- **SC-002**: No request from a demo visitor or a signed-up demo member changes the sample library (tests cover each write route).
- **SC-003**: A self-hosted instance behaves exactly as before: its Planning and welcome tests pass unchanged.

## Slices

1. `feat/demo-planning`: both stories in one slice; it is small.

## Out of scope

- One click giving a full account with no visitor step. It is decided together with the G1 of the hosted tiko.
- Separate Planning lists per person or per team (workspaces). Needed before the hosted tiko; its own spec.
- Workload on the demo.
- Planning on the self-hosted welcome board.

## Decisions at G2

1. "Sign up to keep it" stays on the demo as it is until the hosted tiko G1.
