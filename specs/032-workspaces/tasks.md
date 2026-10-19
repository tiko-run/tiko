---
description: "Task list for workspaces on Postgres"
---

# Tasks: Workspaces on Postgres

**Input**: [spec.md](spec.md), [plan.md](plan.md), [contracts/api.md](contracts/api.md)

**Tests**: on Postgres from slice 1; all people, boards and workspaces in fixtures are made-up.

## Phase 1: Slice `feat/pg-storage`

Several pull requests on one slice; SQLite stays the default.

- [x] T001 Pick the pinned Postgres major against the managed offerings; `docs/decisions.md` lines for Postgres and the workspace; the constitution's constraints amended (storage, multi-tenancy), as its governance asks
- [x] T002 `config.py`: `DATABASE_URL`, `TIKO_TEST_DATABASE_URL`; `conftest.py`: a database per session, truncate per test; `make check` starts a throwaway Postgres; CI service. The suite can run on either engine
- [x] T003 `pg_migrations/001_init.sql`: every table in its final shape, `workspaces` with `kind` and `expires_at`, `memberships`, `server_settings`, `board_index`, global `invites`, `password_resets`, `users.email`, `user_identities`; the three roles, policies per role, forced RLS, composite references, cascades. The policy test over `pg_policies`; the start refuses a superuser, `BYPASSRLS` or owner role
- [x] T004 `postgres.py`: `Database` with the pool and the transaction that sets the workspace; migrations under an advisory lock
- [x] T005 [P] Repositories: users, sessions, attempts, known browsers (global). Tests
- [x] T006 [P] Repositories: boards, members, invites, settings, credentials, snapshots. Cross-workspace read tests
- [x] T007 [P] Repositories: Planning types, people, fields, stages, views; usage counts; demo statuses; onboarding. Cross-workspace read tests
- [x] T008 `api/deps.py`: the workspace of a request, from `board_index` for board, socket and public routes, from the person's membership for lists; always the default one in this slice. Two workspaces through one pooled connection test
- [x] T008a Work outside a request: live room saves (timer, shutdown, REST through the process), `adopt_orphans`, `bootstrap_admin`, `ping_daily`, metrics gauges, demo cleanup, `reset_password.py`. A test for each that it writes into the right workspace
- [x] T009 The license gate with the driver picked at G2; `THIRD_PARTY.md`; CI runs the backend suite on both engines

## Phase 2: Slice `feat/installer-mark`

- [x] T010 About reads `Requires: installer` in release bodies and shows the installer command when any release between the current one and the target carries it. Tests with a fake release feed
- [ ] T011 `CHANGELOG.md`; the guide's update page; release before Phase 3

## Phase 3: Slice `feat/pg-switch` (US1)

- [ ] T012 `copy_sqlite.py`: checkpoint, batches, counts, rename; the advisory lock between processes. Tests on a made-up `app.db` of every migration's shape, a failed copy, two processes
- [ ] T013 Roles and settings split during the copy: admins to memberships, the first admin to server admin, instance settings to `server_settings` and the default workspace
- [ ] T014 Compose files: the `db` service with no published port, volume, health check, memory settings, first-start creation of the three roles; `.env.example`, README
- [ ] T015 [P] `install.sh` and `install.ps1`: `POSTGRES_PASSWORD` written only when missing; Windows checked on the stand
- [ ] T016 [P] Updater: `pg_dump` and `pg_restore` through the `db` container, three kept; `UpdateBackups` for a dump. Tests
- [ ] T017 [P] `render.yaml` with a Postgres database, `make render-validate`; the public demo's Postgres prepared
- [ ] T018 Remove the SQLite adapter, its migrations and the double CI run; `reset_password.py` on Postgres
- [ ] T019 On compose stacks: the bridge release with made-up boards, Planning and a public link upgrades by the installer with equal counts; a fresh stack from the README; "Update now" from a pre-bridge release rolls back. RAM at rest for SC-005
- [ ] T020 `CHANGELOG.md` with `Requires: installer`; the guide: install, configuration, backups (`down -v`), architecture; `make check`, `make smoke`, `make licenses` green

## Phase 4: Slice `feat/workspace-roles` (US2)

- [ ] T021 Contract part for `auth/status`, server settings and accounts, settings and Planning, invites
- [ ] T022 `domain/workspaces.py`: server admin, workspace roles, the last admin rule, one workspace per account on invite; `ServerAdmin` and `WorkspaceAdmin` on every admin route; reset and disable under the server admin. Tests, including both routes as a workspace admin
- [ ] T023 Tracker tokens per workspace; the person directory and "Everyone in this workspace" scoped to members. Tests
- [ ] T024 Frontend: the three settings groups, `serverAdmin` for the server group, the "not in a workspace" screen, wording. Tests; an upgraded instance looks as today apart from the groups
- [ ] T025 `CHANGELOG.md`, the guide's people, sharing and configuration pages; `make check` green

## Phase 5: Slice `feat/demo-workspace` (US3)

- [ ] T026 A workspace per visitor with a copy of the sample lists; the welcome board points at it; eviction by one delete; the visitor lock as an advisory lock. The demo guards in `people.py` stay until here. Tests
- [ ] T027 Remove spec 031's sample answer and the daily rewrite; workload back; the frontend controls back on the demo. Contract note
- [ ] T028 Sign up keeps the workspace. The SC-002 route walk across the default and a visitor workspace. On a demo compose stack: two visitors edit Planning apart
- [ ] T029 `CHANGELOG.md`, the guide's demo and Gantt pages; `make check`, `make smoke` green
