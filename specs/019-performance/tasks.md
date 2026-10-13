---
description: "Task list for the performance of live boards"
---

# Tasks: Performance of live boards

**Input**: [spec.md](spec.md), [baseline.md](baseline.md)

**Tests**: every slice ends with a run of `scripts/load` on the reference setup; the numbers go to `results.md`.

## Format: `[ID] [P?] [Story] Description`

- Backend paths under `backend/app/`, frontend under `frontend/src/`

## Phase 0: Baseline

- [x] T001 Load scripts in `scripts/load/`: `visitors.py`, `rooms.py`, `window.py`, `profile.py`, how to run them
- [x] T002 Baseline on the reference host: many small rooms, rooms of 30, the profile ([baseline.md](baseline.md))

## Phase 1: Slice `perf-ws-compression` (P1)

- [ ] T010 `backend/Dockerfile`, `Makefile`: uvicorn starts without per-message compression of sockets
- [ ] T011 Measure table B at 1 and 2 rooms; `results.md`

## Phase 2: Slice `perf-presence-batch` (P2)

- [ ] T020 `adapters/live/rooms.py`: a room collects presence and sends one frame every 50 ms; leaving is told at once. Tests: `tests/test_live.py` presence cases, a burst becomes one frame
- [ ] T021 `specs/009-realtime/contracts/live.md`: the timing of presence
- [ ] T022 Check in two browser tabs: pointers and drags of the other tab still follow smoothly
- [ ] T023 Measure table B at 1, 2 and 4 rooms; `results.md`

## Phase 3: Slice `perf-incremental-check` (P3)

- [ ] T030 `domain/live.py`: repair of the elements an update touched, plus the rules across elements. Tests unchanged and green; new tests for a broken element among 1000 valid ones
- [ ] T031 `adapters/live/rooms.py`: the room passes what changed to the check
- [ ] T032 Measure table B on 1000-element boards; `tiko_live_check_seconds`; `results.md`

## Phase 4: Slice `perf-metrics-under-load` (P4)

- [ ] T040 Measure scrapes at a failing step on the code of #138
- [ ] T041 If scrapes fail: gauges kept by the rooms, read off the loop. Tests

## Phase 5: Slice `perf-socket-path` (P5)

- [ ] T050 Measure the proxy's share again after P2
- [ ] T051 If it is still over 10%: options with a measurement each, owner decides at G2

## Phase 6: Slice `perf-workers` (P6)

- [ ] T060 Plan: what crosses processes (sign-out everywhere, role changes, limiters, REST save through a room) and how each is carried
- [ ] T061 Several API processes, the proxy picks one by board id. Tests
- [ ] T062 Measure on a host with 4 cores; `results.md`

## Phase 7: Slice `perf-remeasure` (P7)

- [ ] T070 Tables A, B and C again on the final code, same setup
- [ ] T071 `results.md`: baseline and result side by side, what is left to 100 rooms
