---
description: "Task list for Everyday fixes"
---

# Tasks: Everyday fixes

**Input**: [spec.md](spec.md)

**Tests**: frontend for every slice; backend and API for slice `first-password` only.

## Phase 1: Slice `feat/touch-select` (US1, SC-001)

- [x] T001 Partial selection in React Flow, with frames kept only when fully inside the box. Tests for notes, arrows, frames, a box that grows and shrinks; SC-001 measured

## Phase 2: Slice `feat/wheel-zoom` (US2)

- [x] T002 "Mouse wheel" in Preferences (`tiko.wheel`), the canvas switches between pan and zoom on scroll, Shift + wheel pans sideways in zoom mode, `nowheel` areas untouched. Tests; guide and `CHANGELOG.md`

## Phase 3: Slice `feat/first-password` (US3, SC-002)

- [ ] T003 Contract: `must_change_password` on the person and the `password_change_required` 403 in `specs/008-accounts/contracts/api.md`
- [ ] T004 Column on people (false for existing rows), set by `bootstrap_admin`, cleared by a password change; the generated password file deleted then. Domain tests
- [ ] T005 Guard: every route except sign-out, `/api/auth/me` and the password change answers 403 for a marked person; the live socket refuses that person too. API test over every router and the socket (SC-002)
- [ ] T006 Web: the new password screen in place of the app for a marked person; "First time here?" link on sign-in; guide section about the first password. Tests; `make smoke`

## Phase 4: Slice `feat/gantt-push` (US4, SC-003)

- [ ] T007 Stages push the later ones of their row on a drag or stretch to the right, Alt moves one alone. Tests in `stages.test.ts`
- [ ] T008 "Expand all" / "Collapse all" in the task column header, one undo step, hidden for viewers. Tests; SC-003 measured

## Phase 5: Slice `feat/overlay-scrollbars` (US5, #214)

- [ ] T009 One scroll wrapper over `OverlayScrollbars`, swapped into every scrolling area; browser bars hidden there. Screenshots in both themes, no layout shift. Tests

## Phase 6: Slice `feat/recent-inputs` (US6, #83)

- [ ] T010 Last five inputs that added a card in `tiko.card.recent`, shown in an empty card input, keyboard pick. Tests
