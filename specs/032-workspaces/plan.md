# Implementation Plan: Workspaces on Postgres

**Spec**: [spec.md](spec.md) | **Contract**: [contracts/api.md](contracts/api.md)

## Summary

A new storage adapter, `adapters/storage/postgres.py`, implements the same repository ports on Postgres through psycopg 3. Its schema is final from the first migration: a `workspaces` table, `workspace_id` on every workspace table, row-level security forced for the application role, cascades from `workspaces`. Until the switch it runs behind `DATABASE_URL` and the test suite runs on both engines. The switch copies `data/app.db` into the default workspace at the first start, adds Postgres to the compose files and installers, and removes the SQLite adapter. Roles and the demo follow as their own slices on top of the data that already carries `workspace_id`.

## Today

- `adapters/storage/sqlite.py`: one `Database` class with a writer and a reader connection, 17 repository classes, about 1300 lines of hand-written SQL. Migrations `001` to `023` are plain `.sql` files numbered by `PRAGMA user_version`.
- Repositories are synchronous and called from threads. The domain sees only the ports in `domain/ports.py`.
- Tests build the app on `:memory:`; 9 test files touch SQLite directly.
- The updater copies `app.db` with the SQLite backup API before an update and copies it back on failure.
- "One demo visitor at a time" is a file lock next to the database. Background loops run in process 0.

## Decisions

### Driver and connections

- **psycopg 3** (`psycopg[binary]`, LGPL-3.0) with **psycopg_pool** (LGPL-3.0); the license gate needs a change, see [New dependencies](#new-dependencies). Synchronous, called from threads as today: the ports stay as they are and nothing moves to async.
- A pool per API process, small (min 1, max 4), so `TIKO_WORKERS` processes stay far below the default `max_connections` of 100.
- No SQLAlchemy and no ORM. The SQL stays hand-written; an abstraction over two engines is not needed with one engine.

### Schema and migrations

- Migrations stay plain numbered `.sql` files, now in `adapters/storage/pg_migrations/`, starting again at `001`. A `schema_migrations` table records the applied numbers. Forward only: rolling back is restoring the dump taken before the update.
- Migrations run as the owner role at start, under `pg_advisory_lock`, so several processes starting together apply them once.
- Ids stay text, as today, so board ids, public tokens and links keep their shape. Times become `timestamptz`, JSON becomes `jsonb`, the CRDT state of a board becomes `bytea` as one document, as today.
- Global tables, without row-level security: `users`, `user_identities`, `sessions`, `workspaces`, `memberships`, `board_index`, `invites`, `password_resets`, `attempts`, `attempt_windows`, `known_browsers`, `server_settings`, `schema_migrations`.
- `workspaces` has `kind` (`default`, `demo`, `regular`), `owner_id` and `expires_at` (set for demo workspaces). `users` gets a nullable unique `email`, and `user_identities (provider, subject, user_id)` exists empty: both cost nothing now and keep sign-in by e-mail or an outside identity from changing the account table later.
- Workspace tables: `boards`, `board_members`, `settings`, `user_credentials`, `task_snapshots`, `demo_statuses`, `onboarding`, all `planning_*`. Each has `workspace_id text not null references workspaces(id) on delete cascade` and leads its primary key or main index with it.
- The public token lives in `board_index` only, unique across the server, so a public link finds its board and its workspace in one lookup.
- Tables whose ids are fixed names (the standard Planning fields) key by `(workspace_id, id)`; boards keep a global `id` key because `board_index` points at it.
- Stage dates in `planning_stages` stay text: they come from a board as drawn, and a malformed one must not fail the board's save.

### Row-level security

- Three roles, none of them a superuser, none with `BYPASSRLS`. `DATABASE_URL` logs in as `tiko_owner`; the first migration creates `tiko_app` and `tiko_jobs` without login, and each pool switches to its role with `SET ROLE` when it opens a connection. One URL to configure; the API needs the owner for migrations at start anyway:
  - `tiko_owner` owns the tables and runs migrations. It never serves requests.
  - `tiko_app` serves requests. It gets one policy per workspace table:

    ```sql
    CREATE POLICY app_rows ON boards TO tiko_app
      USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
      WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
    ```

    `nullif` matters: on a pooled connection that has used the setting once, a missing value reads as `''`, not `NULL`. No workspace id is ever empty.
  - `tiko_jobs` runs the named jobs that cross workspaces (demo eviction, usage counts, the copy from SQLite, deleting a workspace). It gets `USING (true) WITH CHECK (true)` on the same tables, and its own small pool.
- Every workspace table has `ENABLE` and `FORCE ROW LEVEL SECURITY`, so even the owner reads nothing without a policy.
- At start the API checks its request role in `pg_roles` and `pg_class`. It refuses to serve when the role is a superuser, has `BYPASSRLS` or owns a table. The image's `POSTGRES_USER` is a superuser, so it only creates the three roles at first start. With an outside `DATABASE_URL`, the guide gives the role setup as SQL; there is no single-role fallback.
- The repository runs every call in an explicit transaction that starts with `SELECT set_config('app.workspace_id', %s, true)`. The `true` makes it local to the transaction, so a pooled connection never carries one request's workspace into the next.
- The workspace is still passed in the code, through a context variable rather than a factory per request: services are built once at start, and threading a factory through each of them would touch every route. `WorkspaceScope` sets it for a request, a live room keeps its board's and sets it for its saves, a repository given a workspace in its constructor uses that one. Inserts name the workspace explicitly. Row-level security is the second line, for the query that forgets.
- The person's role is read in the request's workspace. A board route uses the board's workspace only when the person is a member there; otherwise the request runs in the person's own workspace and the board is not found.
- **References stay inside a workspace.** Workspace tables have a unique `(workspace_id, id)`, and references between them are composite: `FOREIGN KEY (workspace_id, board_id) REFERENCES boards (workspace_id, id) ON DELETE CASCADE`. A row cannot point at another workspace's row, and a failed insert cannot tell whether an id exists elsewhere. Ids stay globally unique (`uuid4().hex`, as today).
- Tests: one reads `pg_class` and `pg_policies` and fails for any table with a `workspace_id` column that is not forced or lacks the `tiko_app` policy. Another writes rows in workspace A for every repository and reads them as workspace B. A third runs two workspaces through one pooled connection.

### Lookups before the workspace is known

Some requests know only a token or a board id. They go through global tables outside row-level security, which hold no content:

- `board_index (board_id, workspace_id, public_token)`: a public link, a board route and a live socket find their board's workspace here.
- `invites` stays global with a `workspace_id` column, since the person opening an invite is not a member yet. Listing invites always filters by workspace in the domain.
- `password_resets`: reset links leave `invites`, because a reset belongs to the server, not a workspace.

### The workspace of a request

- Routes about one board (REST, live socket, public link) take the workspace from `board_index`, then check that the person is a member; a member of two workspaces can open a pasted link from either.
- List routes (boards, people, Planning) use the person's one membership. A person without one gets the "not in a workspace" answer.
- A demo visitor's requests use the visitor's own workspace.
- Room ids stay board ids; a board belongs to exactly one workspace, so routing by board id to a process is unchanged.

### Work outside a request

Each of these runs without a request and gets its workspace explicitly or uses `tiko_jobs`, each with a test:

- A live room stores its board's workspace when it is created; its timed saves, its save on shutdown and the REST save through the board's process use it.
- `adopt_orphans`, `bootstrap_admin`, `ping_daily`, the metrics gauges, the demo cleanup and the daily sample, `reset_password.py`.

### Roles and accounts

- `memberships (workspace_id, user_id, role)` with `role in ('admin','member')`; `workspaces.owner_id`; `users.server_admin boolean`. The copy from SQLite makes the first admin the server admin and every admin an `admin` member of the default workspace. The session cache rechecks a person when their role changes.
- In this spec an account is in at most one workspace. The domain enforces it when an invite is accepted, not the schema, so a later spec lifts it without a migration.
- Dependencies in `api/deps.py`: `ServerAdmin` for updates, privacy, metrics without a token and accounts; `WorkspaceAdmin` for workspace settings, Planning lists, members and invites. Password reset links and disabling an account move under `ServerAdmin`.
- The last admin check runs in the domain, in one transaction with the change, so two admins stepping down at once cannot leave the workspace without one.
- `user_credentials` is a workspace table keyed by `(workspace_id, user_id, provider)`; a token is never read outside its workspace.
- `TIKO_BOARD_LIMIT` stays as it is: boards a person may own, admins aside.

### Copy from SQLite

- In the API at start, not in the updater: when `server_settings` has no `copied_from_sqlite` mark, `data/app.db` exists, and Postgres holds no workspace. The check runs as `tiko_jobs`, since `tiko_app` sees no rows without a workspace. Process 0 takes an advisory lock; other processes wait for it.
- Steps: `PRAGMA wal_checkpoint(TRUNCATE)` on the file, read with Python's `sqlite3` (stdlib, stays for the copy only), write table by table in batches of 500 rows into one Postgres transaction, every row with the default workspace id. Board documents stream one at a time.
- Before commit, compare row counts per table; any difference aborts the transaction and leaves the file as it was. After commit, rename `app.db` to `app.db.copied-YYYY-MM-DD` and set the mark.
- Going back to the SQLite release means renaming the file back before starting the old image; the guide says so, because the old image on an empty `data/` starts as a new instance.
- `users.role = 'admin'` becomes an `admin` membership; the first created admin becomes the server admin. Instance settings split into `server_settings` (instance id, privacy switches) and the default workspace's `settings`.

### Install, update, backups

- `docker-compose.yml` and `compose.release.yml` get a `db` service on `postgres:18` (picked in T001: the newest released major and the managed default; its data lives under `/var/lib/postgresql/18/docker`, so the volume mounts `/var/lib/postgresql`), a named volume `pgdata`, a health check, and small memory settings (`shared_buffers=32MB`, `max_connections=30`). `api` waits for it to be healthy.
- A named volume and not `./data/postgres`: a bind mount breaks on Windows hosts and with mismatched owners. `docker compose down -v` removes it; the guide says so next to backups.
- `.env` gets `POSTGRES_PASSWORD`, generated by `install.sh` and `install.ps1` only when it is missing. The image reads it once, when the volume is created, so a new value on an existing volume would lock the API out. The `db` service publishes no port. Without it, `docker compose up --build` from source uses a fixed local default that the guide marks as for local use.
- The updater makes `pg_dump --format=custom` through a Docker exec in the `db` container into `data/backups/pre-update-<version>.dump`, keeps three, and restores with `pg_restore --clean` on failure. Stdlib only, as today. With an outside `DATABASE_URL` there is no `db` container: About asks the admin to confirm their own backup before updating, since migrations only go forward.
- Minor updates of the `db` image come with the installer; a major Postgres upgrade is a later spec.
- The bridge release reads a line `Requires: installer` in GitHub release bodies. About shows the installer command instead of the button when any release between the current one and the target carries it, not only the target.
- The Render blueprint gets a Postgres database; the public demo gets a Postgres database before the switch release is deployed there.

### Tests

- Postgres runs as a service in CI and as a throwaway container from `make check` locally (`docker run --rm` on a random port, removed on exit). `TIKO_TEST_DATABASE_URL` points tests at an existing server instead.
- Migrations apply once per test session. Before each test one `TRUNCATE ... RESTART IDENTITY CASCADE` over all tables. A rolled-back transaction per test does not work: the code commits by itself.
- From slice 1 until slice 3 the backend suite runs on both engines in CI; `make check` locally runs Postgres only.

### Demo

- A visitor gets a workspace at start; `demo_statuses` and the visitor's boards live in it. Eviction is `DELETE FROM workspaces WHERE id = ...`, the cascades remove the rest.
- The sample lists are copied into the visitor's workspace at its creation with fresh ids; the welcome board points at them. The daily rewrite of spec 031 goes away.
- "One demo visitor at a time" moves from the file lock to `pg_try_advisory_lock`. Rate limits stay in `attempts` with `INSERT ... ON CONFLICT`.

## Structure

```text
backend/app/adapters/storage/postgres.py        Database (pool, transaction with workspace), repositories
backend/app/adapters/storage/pg_migrations/     001_init.sql (final schema, roles, policies), later steps
backend/app/adapters/storage/copy_sqlite.py     the one-time copy from data/app.db
backend/app/adapters/storage/update_backups.py  free space for a dump instead of a file copy
backend/app/domain/workspaces.py                workspaces, memberships, roles, server admin, last admin rule
backend/app/api/deps.py                         the workspace of a request, ServerAdmin, WorkspaceAdmin
backend/app/config.py                           DATABASE_URL, POSTGRES_PASSWORD
backend/tests/conftest.py                       database per session, truncate per test
updater/updater.py                              pg_dump and pg_restore through the db container
docker-compose.yml, compose.release.yml         the db service and volume
install/install.sh, install/install.ps1         POSTGRES_PASSWORD in .env
render.yaml                                     a Postgres database
frontend/src/                                   settings groups, "not in a workspace" screen, wording
docs/guide/                                     install, configuration, backups, architecture, people
```

## Slices

| Branch | Done when |
|---|---|
| `feat/pg-storage` | with `DATABASE_URL` set, the whole backend suite passes on Postgres; the policy test passes; the cross-workspace read test passes for every repository; `make check` green on SQLite |
| `feat/installer-mark` | a fake release body with the mark makes About show the installer command; released before `feat/pg-switch` |
| `feat/pg-switch` | a compose stack of the bridge release with made-up data upgrades by the installer with equal counts; a fresh stack starts from the README; "Update now" from a pre-bridge release rolls back; `make check`, `make smoke` green; SQLite adapter gone |
| `feat/workspace-roles` | each settings group opens only for its role and every admin route answers `403` to the rest; reset and disable only for the server admin; the last admin rule; tokens per workspace; an upgraded instance looks as today apart from the groups |
| `feat/demo-workspace` | two demo visitors edit Planning lists apart; eviction leaves no rows; workload on the demo; the SC-002 route walk across the default and a visitor workspace |

## Risks

| Risk | Answer |
|---|---|
| A self-hosted instance loses data in the copy | Counts compared before commit, the file renamed and kept, the updater's dump before every later update, a test on a made-up database of every schema version |
| Old instances press "Update now" | The bridge release; older ones roll back on the failed health check |
| Postgres memory on a small server | Small settings in compose; SC-005 measured on the compose stack |
| Contributors need Docker for `make check` | `TIKO_TEST_DATABASE_URL` for a local server; the guide for contributors says so |
| A forgotten `workspace_id` filter | Row-level security forced for the application role; the policy and route-walk tests |
| A pooled connection keeps a workspace | `set_config(..., true)` is local to the transaction; a test runs two workspaces through one pooled connection |
| The suite gets slow | Truncate per test instead of a new database; SC-003 |
| Two engines drift while both exist | Both run in CI until slice 3 removes SQLite |
| A workspace admin takes over an account | Password reset and disabling stay with the server admin; a test checks both routes as a workspace admin |

## New dependencies

| Name | License | Why |
|---|---|---|
| `psycopg[binary]` 3 | LGPL-3.0 | Postgres driver; the wheel bundles libpq (PostgreSQL License) |
| `psycopg_pool` | LGPL-3.0 | connection pool |
| `postgres` image | PostgreSQL License | the database in compose |

All three go to `THIRD_PARTY.md`. Rule 9 allows weak copyleft, but `make licenses` fails on any license containing `GPL` with partial matching, so it rejects `LGPL-3.0-only` today (checked: `fail-on license LGPL-3.0-only was found for package psycopg:3.3.6`). The gate gets `--ignore-packages psycopg psycopg-binary psycopg-pool` with a comment naming rule 9, rather than a looser pattern that could let a GPL package through.
