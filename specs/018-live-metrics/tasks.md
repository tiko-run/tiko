---
description: "Task list for live metrics"
---

# Tasks: Live metrics

**Input**: [spec.md](spec.md)

**Tests**: included; made-up data only.

## Format: `[ID] [P?] [Story] Description`

- Backend paths under `backend/app/`

## Phase 1: Slice `feat/live-metrics` — the operator sees how busy the instance is (US1) 🎯

- [x] T001 [US1] `observability.py`: the `tiko_` metrics, `live_message`, `watch_loop`
- [x] T002 [US1] `adapters/live/rooms.py`, `api/live.py`: messages in and out, closes, check and save times, board size, `LiveRooms.stats`
- [x] T003 [P] [US1] `adapters/storage/sqlite.py`: wait for the connection and length of a transaction
- [x] T004 [US1] `config.py`, `api/gate.py`, `main.py`: `TIKO_METRICS_TOKEN`, `/metrics` for admins and the token, gauges read at the scrape, the loop watcher in the lifespan
- [x] T005 [US1] Tests: `tests/test_metrics.py`
- [x] T006 [US1] Guide page "Monitoring", configuration, security, `.env.example`, `CHANGELOG.md`
- [x] T007 [US1] Check on the compose stack with the token and an open board. `make check`
