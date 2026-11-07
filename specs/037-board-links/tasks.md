---
description: "Task list for Board links"
---

# Tasks: Board links

**Input**: [spec.md](spec.md)

**Tests**: frontend for every slice; backend and API for `public-to-board` and `steady-presence`.

## Phase 1: Slice `feat/public-to-board` (US1, SC-001)

- [x] T001 Contract: `GET /api/boards/by-public/{token}` in `specs/012-public-link/contracts/api.md`, signed in, answers `{id}` when the person can open the board and 404 `not_found` otherwise, same body as an unknown token
- [x] T002 Route and domain check over the existing public links and board access. API tests: member, viewer, no access, link off, deleted board
- [x] T003 Web: the public page asks the lookup when signed in and replaces itself with `/?board={id}`; "Sign in" signs in on the page and asks again; no button for a signed-in person without access. Tests; SC-001 checked on the compose stack; guide section on sharing; `CHANGELOG.md`

## Phase 2: Slice `feat/share-links` (US2, US3, US4)

- [ ] T004 Share: Copy link at the top for everyone who can open it; note on the public link row. Tests
- [ ] T005 No-access screen for a board address that does not open, in place of the toast and the move Home; the lost-access toast stays. Tests
- [ ] T006 Used or expired invite: a signed-in person goes to their boards. Tests; guide; `CHANGELOG.md`

## Phase 3: Slice `feat/steady-presence` (US5, SC-002)

- [x] T007 Server keepalive on every board socket and the guest socket, at most 15 s apart, as an empty awareness update. Test that a silent room still sends
- [x] T008 Faces keep a person 90 s after their last presence; a hidden tab sends presence on `visibilitychange`. Tests; `CHANGELOG.md`
