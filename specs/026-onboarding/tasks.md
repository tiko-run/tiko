---
description: "Task list for the product tour and getting started"
---

# Tasks: Product tour and getting started

**Input**: [spec.md](spec.md)

**Tests**: included; made-up data and a fake API only.

## Phase 1: User Story 1 - See the main features once (P1) 🎯

Slice `tour`.

- [ ] T001 [US1] Backend: `onboarding` JSON on the user row with a migration; returned in `/api/me`, `PATCH /api/me/onboarding` with a schema for known keys only; contract
- [ ] T002 [US1] `data-tour` anchors on the Task card, Timer and Modules buttons, the focus capsule and About
- [ ] T003 [US1] `frontend/src/onboarding/`: tour steps on driver.js behind `import()`, popover styled with theme tokens, centered fallback for a missing anchor, start rules (once, editable board, new person)
- [ ] T004 [US1] Loops for the seven steps, ported from `site/src/components/Features.astro`, still frame under `prefers-reduced-motion`
- [ ] T005 [US1] About: "Take the tour" row
- [ ] T006 [US1] Tests: start rules, reduced motion, missing anchor; bundle check that driver.js is not in the main chunk and the main chunk grew by 3 KB gzipped at most
- [ ] T007 [US1] `THIRD_PARTY.md`, `make licenses`, guide page `quick-start.md`, changelog

## Phase 2: User Story 2 - Learn by doing (P1)

Slice `getting-started`.

- [ ] T008 [US2] Checklist pill and list next to About, "Hide", one check animation when all done; About "Getting started" row
- [ ] T009 [US2] Ticks from `addCards`, paste of references, search pick with a filter chip, `addTimer`, timer panel open, Gantt row from a card, focus start, own tracker token saved; demo visitors without the tracker item
- [ ] T010 [US2] "Show me" runs a single tour step
- [ ] T011 [US2] Tests: each tick from its action, progress after reload, hidden and restored, demo list of seven; guide page, changelog
