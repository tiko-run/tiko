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

## Phase 1b: Slice `perf2-demo-room`, added by the owner on 2026-10-13

Found in Phase 1: making room for a new demo visitor at the limit grew with the number of visitors, and a visitor who only opened their board counted as one who changed it.

- [x] T015 The search for a visitor who changed nothing goes on from where the last one ended. Test: places keep being found behind visitors who changed something
- [x] T016 A room that opens a board stores its live state without a new version. Test: a visitor who only opened the board goes within the hour
- [x] T017 Local number at the limit

Measured on a laptop with Docker: 3000 demo visitors at a limit of 3000, half of them only looking, then 300 more arrive. One run each.

| | Before | After |
|---|---|---|
| Newcomers let in | 0 of 300 | 300 of 300 |
| Looking for a place, average | 9.8 ms | 3.4 ms, the visitor and their board deleted in it |
| Boards of the 3000 still at their first version | 23 | 1304 |

## Phase 2: Slice `perf2-metrics-cost` (R2)

- [x] T020 A step with and without a scrape, three runs each
- [x] T021 Only if T020 shows a difference above the spread: the scrape made cheaper. Not needed: the difference is inside the spread

Measured on a laptop with Docker: 400 visitors for 40 seconds, the two variants taking turns, the median of three runs with the least and the most.

| | Scraped every 5 s | Not scraped |
|---|---|---|
| API container, share of a core | 21.7% [20.4 .. 22.6] | 22.0% [21.3 .. 22.8] |
| Web container, share of a core | 8.8% [8.4 .. 8.8] | 8.9% [8.7 .. 8.9] |
| Pointer echo, p95 | 2.4 ms [2.2 .. 2.6] | 2.5 ms [2.5 .. 2.5] |
| Socket in sync, p95 | 15.3 ms [15.0 .. 22.1] | 15.7 ms [15.2 .. 21.8] |
| Open a board, p95 | 6.4 ms [5.9 .. 17.9] | 13.4 ms [4.1 .. 22.3] |

One scrape answers in 3.0 ms at the median and 3.6 ms at p95 for 25 KB: every 5 seconds that is 0.06% of the time, an upper bound on what it can take from a core and not a measurement of CPU. The containers show no extra CPU above the spread. The hint from spec 019 came from two runs at the limit of a shared vCPU; nothing here supports it. The reference run (Phase 7) keeps its Prometheus.

## Phase 3: Slice `perf2-socket-path` (R3)

- [x] T030 nginx to the API over a Unix socket; the web container's share of the host before and after. Owner decides
- [x] T031 The host network measured on Linux in Phase 7 next to the Unix socket; it showed no reliable improvement, so no compose option was added
- [x] T032 nginx remains above 10% of the host; the direct browser-to-API socket proposal and tradeoffs are in [results.md](results.md) for the owner

T030, measured on a laptop with Docker: three rooms of 30 on boards of 1000 elements for a minute, the two ways taking turns, the median of three runs with the least and the most.

| | Docker network | Unix socket |
|---|---|---|
| Web container, share of a core | 11.5% [11.4 .. 11.7] | 10.4% [10.0 .. 11.5] |
| API container, share of a core | 19.5% [19.2 .. 19.7] | 17.3% [16.6 .. 19.0] |
| Pointer, p95 | 55.7 ms [53.7 .. 56.0] | 54.1 ms [54.0 .. 56.6] |
| Edit, p95 | 8.2 ms [7.3 .. 9.6] | 7.4 ms [7.1 .. 8.1] |

About a tenth less CPU in both containers, and the ranges touch. The socket ships as `TIKO_SOCKET_DIR`, off by default: whether the compose files turn it on is decided after Phase 7 measures it on the reference host, together with the host's network.

## Phase 4: Slice `perf2-edit-batch` (R4), not built

Dropped on 2026-10-13 by the owner's decision, see "The order after R3" in the spec: of 643 to 650 messages a second a room sent in 019, about 45 were edits.

- [ ] T040 `adapters/live/rooms.py`: updates of a tick merged and sent once, the first at once. Tests: one frame per recipient for a burst, the tabs converge
- [ ] T041 `specs/009-realtime/contracts/live.md`: the timing of edits

## Phase 5: Slice `perf2-incremental-save` (R5), only if Phase 7 asks for it

- [ ] T050 Plan: the format, the migration, what reads a board from the database (REST save, export, the copy before a migration)
- [ ] T051 Updates appended, a snapshot when the room is quiet or on a timer. Tests: restore equals live, a restart in the middle
- [ ] T052 Local number: `tiko_live_save_seconds` on a 1000-element board

## Phase 6: Slice `perf2-presence-rate` (R6), built before Phase 5

- [x] T060 The web app measures the gap between presence frames and takes 160 ms instead of 80 for a pointer or a dragged element when they come half as often
- [x] T061 A room of 10 sockets or more sends presence at most once in 100 ms; `specs/009-realtime/contracts/live.md`
- [x] T062 Local number: presence frames out and the CPU of both containers, 20 Hz against 10 Hz

On a laptop, three rooms of 30 on boards of 1000 elements, 60 s a run, the two rates in turn on one build, the median of three runs with the least and the most:

| | 20 Hz | 10 Hz in a busy room |
|---|---|---|
| Presence frames out a second | 2270 [2266 .. 2280] | 1206 [1191 .. 1207] |
| API container, share of a core | 21.4% [20.7 .. 22.3] | 18.5% [18.0 .. 18.5] |
| Web container, share of a core | 12.1% [11.7 .. 12.3] | 9.2% [9.0 .. 9.2] |
| Pointer, p95 | 54.1 ms [53.7 .. 54.6] | 56.2 ms [55.8 .. 56.8] |
| Pointer, p99 | 56.9 ms [56.5 .. 57.5] | 82.5 ms [82.2 .. 88.7] |
| Edit, p95 | 8.0 ms [6.3 .. 9.0] | 7.8 ms [7.8 .. 11.0] |

Frames fall by 47%, the API container by about a seventh and the web container by about a quarter, and the ranges do not touch. Whether more rooms pass is for Phase 7: a laptop at a fifth of a core is far from the limit.

In two tabs of a browser, with a room made busy at two sockets: the other tab went from 80 to 160 ms by itself and its pointer moved on every one of the last 120 frames.

## Phase 7: Slices `perf2-remeasure` (R7) and `perf2-verdict` (R8)

- [x] T070 Tables A to C by the rules of the spec, against the code of 019's end on the same VM. Not run: the target with 8 cores, a size the account does not allow, and a repeat of the profile of table C
- [x] T071 `results.md` with the verdict table
