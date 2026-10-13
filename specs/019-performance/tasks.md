---
description: "Task list for the performance of live boards"
---

# Tasks: Performance of live boards

**Input**: [spec.md](spec.md), [baseline.md](baseline.md)

**Tests**: per slice, with a local look at its number where `/metrics` shows one. One run of `scripts/load` on the reference setup at the end (Phase 6); its numbers go to `results.md`.

## Format: `[ID] [P?] [Story] Description`

- Backend paths under `backend/app/`, frontend under `frontend/src/`

## Phase 0: Baseline

- [x] T001 Load scripts in `scripts/load/`: `visitors.py`, `rooms.py`, `window.py`, `profile.py`, how to run them
- [x] T002 Baseline on the reference host: many small rooms, rooms of 30, the profile ([baseline.md](baseline.md))

## Phase 1: Slice `perf-ws-compression` (P1)

- [x] T010 `backend/Dockerfile`, `Makefile`: uvicorn starts without per-message compression of sockets
- [x] T011 Check on the compose stack: the upgrade of a board's socket answers without `permessage-deflate`, two tabs still edit together

## Phase 2: Slice `perf-presence-batch` (P2)

- [ ] T020 `adapters/live/rooms.py`: a room collects presence and sends one frame every 50 ms; leaving is told at once. Tests: `tests/test_live.py` presence cases, a burst becomes one frame
- [ ] T021 `specs/009-realtime/contracts/live.md`: the timing of presence
- [ ] T022 Check in two browser tabs: pointers and drags of the other tab still follow smoothly

## Phase 3: Slice `perf-incremental-check` (P3)

- [ ] T030 `domain/live.py`: repair of the elements an update touched, plus the rules across elements. Tests unchanged and green; new tests for a broken element among 1000 valid ones
- [ ] T031 `adapters/live/rooms.py`: the room passes what changed to the check
- [ ] T032 Local check on a 1000-element board: `tiko_live_check_seconds` before and after

## Phase 4: Slice `perf-metrics-under-load` (P4)

- [ ] T040 Gauges kept by the rooms, read off the loop. Test: `/metrics` answers while the loop is held busy

## Phase 5: Slice `perf-workers` (P5)

- [ ] T050 Plan: what crosses processes (sign-out everywhere, role changes, limiters, REST save through a room) and how each is carried
- [ ] T051 Several API processes, the proxy picks one by board id. Tests with two processes

## Phase 6: Slice `perf-remeasure` (P6)

- [ ] T060 Tables A, B and C again on the final code, same setup, plus a host with 4 cores
- [ ] T061 `results.md`: baseline and result side by side, what each slice was worth, what is left to 100 rooms

## Phase 7: Slice `perf-socket-path` (P7), only if P6 asks for it

- [ ] T070 If nginx is still over 10% of the host: options with a measurement each, owner decides at G2
