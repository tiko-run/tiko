---
description: "Task list for usage stats and error reports"
---

# Tasks: Usage stats and error reports

**Input**: [spec.md](spec.md)

**Tests**: included; made-up data, a local collector and a fake Sentry transport only.

## Phase 1: User Story 1 and 3 - Count installs and instances, say so honestly (P1) 🎯

Slice `usage-stats`.

- [x] T001 [US1] `collector/`: Cloudflare Worker, schema check for `install` and `ping`, `country` from `CF-IPCountry`, no IP; `events` table migration; retention job for rows older than 13 months
- [x] T002 [US1] Domain: `UsageStats` with the ping payload, buckets, `instance_id` made on first start; port `UsageReporter` with a mock adapter and an HTTP adapter
- [x] T003 [US1] Scheduler: first ping 10 minutes after start, then every 24 hours with jitter; `TIKO_USAGE_STATS`, `TIKO_DEPLOY`, `TIKO_STATS_URL` in `config.py` and `.env.example`
- [x] T004 [US1] `install.sh` and `install.ps1`: install event on success, `failed_step` on failure, 3-second timeout, `--no-stats` and `-NoStats`, notice before the first step and at the end; `TIKO_DEPLOY=installer` in `.env`; Railway and Render are found from their own variables
- [x] T005 [US1] Settings → Privacy: usage stats toggle for admins, locked by ENV, "Show what is sent"; API for the setting and the preview; contract
- [x] T006 [US3] Guide page `privacy.md`: why, fields with a sample JSON, never sent, storage and retention, switches, link to `collector/`; test that the page lists every payload field
- [x] T007 [US3] Replace "no telemetry" in `README.md`, `site/` (Hero, SelfHost, FAQ), About and the guide's security page
- [x] T008 [US1] Tests: payload fields and buckets, schedule with a fake clock, off by ENV and by setting, collector schema; install event against a local collector; Windows stand run for the installer change
- [x] T009 [US1] Deploy the Worker and Neon database, `t.tiko.run`; `THIRD_PARTY.md`, changelog

## Phase 2: User Story 2 - See what breaks (P2)

Slice `error-reports`.

- [x] T010 [US2] API: `sentry-sdk` behind a port with a mock adapter, `before_send` reads the switch, scrubbing of messages, no request data, no locals, no breadcrumbs, tags `version` and `deploy`
- [x] T011 [US2] Page: `@sentry/react`, route patterns, no replay and tracing, the switch from the API
- [x] T012 [US2] Settings → Privacy: error reports toggle, locked by `TIKO_ERROR_REPORTS`
- [x] T013 [US2] Tests: scrubbing with a fake transport, nothing sent when off, sent after turning on without a restart
- [x] T014 [US2] Guide page section on error reports, `THIRD_PARTY.md`, `make licenses`, changelog

## Phase 3: User Story 4 - Tell used instances from running ones (P2)

Slice `usage-stats-v2`.

- [ ] T015 [US4] API: last ping time in settings, no ping before 24 hours have passed; `make dev-api` with `TIKO_USAGE_STATS=false`
- [ ] T016 [US4] Ping schema 2: `boards_active` (changed in 7 days, the welcome board as made does not count) and `os`
- [ ] T017 [US4] Install event schema 2: `fresh` in `install.sh` and `install.ps1`
- [ ] T018 [US4] Collector: schema 1 and 2, missing new fields stored as `null`; tests; deploy
- [ ] T019 [US4] Guide page, contract, changelog
