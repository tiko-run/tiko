---
description: "Task list for updates"
---

# Tasks: Updates

**Input**: [spec.md](spec.md)

**Tests**: included; made-up data and a fake release feed only.

## Phase 1: User Story 1 - Learn about a release soon, and how much it matters (P1) 🎯

Slice `update-check`.

- [ ] T001 [US1] `UpdateService`: 30-minute check, 10-minute retry, "Check now" with a one-minute floor
- [ ] T002 [US1] `GitHubReleaseFeed`: the release list with `ETag` and `304`, the level from the first line of the notes
- [ ] T003 [US1] Version answer: newest release, highest level, list of newer releases; `POST /api/version/check`; contract
- [ ] T004 [US1] `scripts/release.sh`: `LEVEL=` writes the level line, refuses an unknown one
- [ ] T005 [US1] About: list of newer releases with levels, red dot for security, "Check now", refresh every 5 minutes and on focus; security banner for admins with a 24-hour close
- [ ] T006 [US1] Tests: intervals with a fake clock, `304`, highest level, rate floor, banner for admins only; `scripts/smoke.py` reads the new fields
- [ ] T007 [US1] Guide, `.env.example`, changelog

## Phase 2: User Story 2 - Update with one click (P2)

Slice `one-click-update`.

- [ ] T008 [US2] `updater` service and image: token check, one update at a time, free space check, backup, new compose file, pull with layer progress, recreate `api` and `web`, health wait, rollback, cleanup of old backups and images
- [ ] T009 [US2] `compose.release.yml` profile `updater`; release workflow builds and publishes its image
- [ ] T010 [US2] API: updater port with a mock adapter, `POST /api/update` and update status for admins, the token in `data/`
- [ ] T011 [US2] About: "Update now", confirm for `breaking`, steps and download bar, "tiko is updating" and reload for everyone, failure with the log; manual steps without the updater
- [ ] T012 [US2] `install.sh` and `install.ps1` ask about one-click updates
- [ ] T013 [US2] Tests: API with the mock updater, updater steps, rollback, cleanup and the free space refusal with a fake Docker; an update and a failed update on a clean VM from the previous release
- [ ] T014 [US2] Guide (update page, security of the updater), `THIRD_PARTY.md`, changelog
