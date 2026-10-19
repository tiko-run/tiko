---
description: "Task list for Jira Cloud"
---

# Tasks: Jira Cloud

**Input**: [spec.md](spec.md), [plan.md](plan.md), [contracts/api.md](contracts/api.md)

**Tests**: in every slice, against a fake Jira Cloud; fixtures with made-up sites, projects and people only. A live site is used by hand on the compose stack and never recorded into fixtures.

## Format: `[ID] [P?] [Story] Description`

- Backend paths under `backend/app/`, frontend paths under `frontend/src/`

## Phase 1: Slice `feat/jira-cloud` — a Jira Cloud task is a live card (US1) 🎯

**Goal**: connect a Jira Cloud site and get live cards by key and link.

- [x] T001 [US1] On a live Cloud site with an API token: `serverInfo` with and without auth, `bulkfetch` with an unknown and a moved key, `search/jql` and `jql/parse` on unknown keys and a broken query. Write the answers' shapes into `plan.md` (no site name, no data)
- [x] T002 [US1] `adapters/tasks/jira_dc.py`: hooks for a subclass (the auth header, the read of a poll chunk), `Beta-Retry-After`, no behaviour change. Data Center tests unchanged
- [x] T003 [US1] `adapters/tasks/jira_kind.py`: the kind from `serverInfo`, the fallback by host. Tests
- [x] T004 [US1] `adapters/tasks/jira_cloud.py`: Basic auth, `check`, `resolve`, `poll` by bulkfetch with missing keys, errors and 429; `tests/jira_cloud_fake.py`. Tests
- [x] T005 [US1] `domain/settings.py`: `jira_kind`, the credential with an e-mail (old records read as a bare token), the e-mail required for Cloud. Tests, the token leak test with the e-mail and the Basic header
- [x] T006 [US1] `api/settings.py`, `api/me.py`, `main.py`: the contract of `contracts/api.md`, the adapter by kind, the kind of an ENV URL at start; `domain/usage.py` and `collector/worker.js` with `jira_cloud`. API tests
- [x] T007 [P] [US1] `api/settings.ts` schemas; My tracker: the e-mail field and the token link for Cloud; Task source: the kind next to the URL; `canvas/refs.ts`: `selectedIssue` links. Tests
- [x] T008 [US1] `make check` green (done); `make smoke` on the stack. The smoke has no fake Cloud on the stack, so the Cloud answers are covered by the API tests, as GitHub did
- [x] T009 [US1] On the compose stack with a live Cloud site, in both themes: connect, a card by key, by link and by `selectedIssue` link, a change in Jira reaches the card, a wrong token in the sync list (SC-001, SC-002)
- [x] T010 [US1] Guide page "Connect Jira Cloud" (an unscoped API token, its expiry, the e-mail), the trackers table, README, `CHANGELOG.md`

## Phase 2: Slice `feat/jira-cloud-jql` — JQL on Jira Cloud (US2)

**Goal**: a query fills the board, with suggestions as on Data Center.

- [x] T011 [US2] `jira_cloud.py`: `search` by `jql/parse` then `search/jql` and `approximate-count`; `jql_vocabulary` and `jql_values` through the shared parsing. Tests on the fake
- [x] T012 [US2] The card tool shows "about N" for an estimated count past the limit. Tests
- [x] T013 [US2] On the compose stack with a live Cloud site: suggestions for fields and `status`, a query with its count, a broken query with Jira's message. `make check` green
- [x] T014 [US2] Guide, `CHANGELOG.md`
