---
description: "Task list for Planning mode"
---

# Tasks: Planning mode

**Input**: [spec.md](spec.md)

**Tests**: included; made-up people and tasks only.

## Phase 1: User Story 1 - Cut a task into stages (P1) 🎯

Slice `planning-stages`.

- [x] T001 [US1] Backend: `planning` settings and `planning_types` table with a migration; `GET` and `PATCH /api/planning`, types endpoints, default types on first enable; contract
- [x] T002 [US1] Domain: `Stage` in `gantt.py` with order, overlap, span and parent rules, 20 per row; tests for each rule and for content saved before this spec
- [x] T003 [US1] Settings → Planning: switch (read-only for members), Stages list with rename, hue and archive
- [x] T004 [US1] Gantt: stages drawn by type, add by drag or click, move and resize within neighbours, popover with type chips, "+ New type", dates and delete; bare bar as "No stage"; row dates follow the span; Planning off draws one bar
- [x] T005 [US1] Tests: drag, clamp, click adds a week, first type from a bare bar, Planning off snapshot; bundle check; guide page `gantt.md`, changelog

## Phase 2: User Story 2 - Put people on stages (P1)

Slice `planning-people`.

- [x] T006 [US2] Backend: `planning_people` table, people endpoints, archive; `planning` live event; people and types in the public payload
- [x] T007 [US2] Settings → Planning → People and the Gantt "People" button: list, add, teams, source, archive
- [x] T008 [US2] Stage popover: people chips, suggestions from the directory and from assignees of this Gantt's tasks, add on the fly; names inline or under the bar per Gantt
- [x] T009 [US2] Tests: three ways to add, no bulk import, archived person muted, public viewer read-only; guide, changelog

## Phase 3: User Story 3 - See who is away (P1)

Slice `planning-time-off`.

- [x] T010 [US3] Backend: time off ranges on a person, endpoints, limits
- [x] T011 [US3] Gantt: Time off lane shown only when needed, add by drag and person pick, stacked ranges, popover to remove; time off in the person's card
- [x] T012 [US3] Conflict outline, "!" and the away line in tooltip and popover
- [x] T013 [US3] Tests: lane hidden and shown, conflict on two Gantts, removal clears it; guide, changelog

## Phase 4: User Story 4 - Columns that inherit (P2)

Slice `gantt-fields`.

- [x] T014 [US4] Backend: `planning_fields` with the three standard fields; endpoints; `values` and `columns` in Gantt content
- [x] T015 [US4] Gantt: column headers with "+", editable cells, inherited value muted, up to 6 columns; Settings → Planning → Fields
- [x] T016 [US4] Tests: inherit, override, clear, field shared by two Gantts; guide, changelog

## Phase 5: User Story 5 - Filter and save a view (P2)

Slice `gantt-views`.

- [x] T017 [US5] Backend: `planning_views`, endpoints; `filters` in Gantt content
- [x] T018 [US5] Gantt: filter chips and "+ Filter", matching with inherited values, comma parts, Team through people, parents kept; views as pills, "Save as view"
- [x] T019 [US5] Tests: each match rule, saved view on another board, reload; guide, changelog

## Phase 6: User Story 6 - Plan in working days (P3)

Slice `gantt-working-days`.

- [x] T020 [US6] Backend: days off list; `workingDays` in Gantt content
- [x] T021 [US6] Gantt: weekends hidden, snapping and working-day counts, days off shaded; months over weeks in the Weeks header
- [x] T022 [US6] Tests: toggle, snapping, count with a day off, header; guide, changelog

## Phase 7: User Story 7 - A person's workload (P3)

Slice `planning-workload`.

- [ ] T023 [US7] Backend: `planning_stages` index rewritten on board save, backfilled by the migration; workload endpoint with access rules
- [ ] T024 [US7] Person card: twelve-week strip, overlap in red, time off hatched, stages with board links, "Busy" for boards without access
- [ ] T025 [US7] Tests: overlap across boards, hidden details without access, index updated on save; guide, changelog
