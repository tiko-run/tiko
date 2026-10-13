---
description: "Task list for the second round of performance of live boards"
---

# Tasks: Performance of live boards, second round

**Input**: [spec.md](spec.md), [results of spec 019](../019-performance/results.md)

**Tests**: per slice, with its number on a local stack before and after. One reference run at the end (Phase 7), every row three times.

## Phase 0: Slice `perf2-measure` (R0)

- [x] T001 `scripts/load`: a driver that runs a step, repeats it and prints the median and the spread; the CPU of each container for the window
- [x] T002 The same step against two images in turn on one target
- [x] T003 `tiko_db_held_seconds` by the kind of transaction; `docs/guide` Monitoring

## Phase 1: Slice `perf2-db-readers` (R1)

- [x] T010 Find the transaction that grows with the data: a local database of several thousand people, the numbers of T003. Found: the list of a person's boards read every board of the instance
- [x] T011 `adapters/storage/sqlite.py`: a connection for reads, the write lock only where a transaction writes. Test: a read answers while a write is held; the two-process tests of 019 stay green
- [x] T012 The query of T010 fixed, with its number before and after

Measured on a laptop with Docker, 200 visitors joining a database of 4400 people and their boards, one run each:

| | Empty database | 4400 people, before | 4400 people, after |
|---|---|---|---|
| Wait for the database, average | 0.05 ms | 1.22 ms | 0.04 ms |
| The list of boards, average | 0.06 ms | 2.85 ms | 0.10 ms |
| Open the list of boards, p95 | 16 ms | 40 ms | 17 ms |
| Socket in sync, p95 | 17 ms | 42 ms | 17 ms |

The sweep of expired sessions at sign-in read every session; it has an index now (0.59 ms to 0.17 ms). 500 visitors at once were not measured on their own: that run crossed the limit of demo visitors, where making room for a new visitor is a transaction of its own kind. It is left for the owner to decide.

## Phase 2: Slice `perf2-metrics-cost` (R2)

- [ ] T020 A step with and without a scrape, three runs each
- [ ] T021 Only if T020 shows a difference above the spread: the scrape made cheaper

## Phase 3: Slice `perf2-socket-path` (R3)

- [ ] T030 nginx to the API over a Unix socket; the web container's share of the host before and after. Owner decides
- [ ] T031 Only if T030 is not enough: the host's network as a compose option. Owner decides
- [ ] T032 Only if nginx is still over 10% of the host: the direct socket, as a proposal for the owner

## Phase 4: Slice `perf2-edit-batch` (R4)

- [ ] T040 `adapters/live/rooms.py`: updates of a tick merged and sent once, the first at once. Tests: one frame per recipient for a burst, the tabs converge
- [ ] T041 `specs/009-realtime/contracts/live.md`: the timing of edits

## Phase 5: Slice `perf2-incremental-save` (R5)

- [ ] T050 Plan: the format, the migration, what reads a board from the database (REST save, export, the copy before a migration)
- [ ] T051 Updates appended, a snapshot when the room is quiet or on a timer. Tests: restore equals live, a restart in the middle
- [ ] T052 Local number: `tiko_live_save_seconds` on a 1000-element board

## Phase 6: Slice `perf2-presence-rate` (R6), only if Phase 7 asks for it

- [ ] T060 The web app interpolates pointers, one release ahead
- [ ] T061 A busy room sends presence at 10 Hz

## Phase 7: Slices `perf2-remeasure` (R7) and `perf2-verdict` (R8)

- [ ] T070 Tables A to C by the rules of the spec, against the code of 019's end on the same VM
- [ ] T071 `results.md` with the verdict table
