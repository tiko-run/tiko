# Feature Specification: Workspaces on Postgres

**Feature Branch**: `feat/workspaces-spec`; slices in [Slices](#slices)

**Created**: 2026-10-19

**Status**: Draft, waiting for the owner at G2.

**Input**: Separate the people who run a server from the people who use it, and put everything a team shares into one closed workspace. A company should be able to run tiko on its own managed database. The demo should give each visitor lists of their own instead of a fixed sample ([spec 031](../031-demo-planning/spec.md)).

## Why

Everything in tiko except boards belongs to the whole instance: the tracker settings, the Planning lists, the people directory, the admin role, "Everyone with an account", invites. Nothing separates the people who use a server from the people who run it, and nothing separates one group of people from another.

- One role does two jobs: the admin who sets the Jira URL for the team also resets everyone's passwords and runs updates.
- On the demo every visitor lives on one instance. Spec 031 had to make Planning a read-only sample there, and workload stays off because it would count other visitors' stages.
- Every list that is shared by the instance has to be checked again for each new feature, as spec 031 did for Planning.

The fix is a workspace: a closed area with its own people, roles, settings and Planning. Every list that is shared by the instance today moves into it, and the server keeps only what runs the server.

Storage changes in the same step. Companies ask to run tiko on their own database with their own backups, and SQLite is one file on one disk. Postgres also lets the database itself check that a query never reads another workspace's rows (row-level security). Doing workspaces on SQLite first and moving to Postgres later would rewrite every query twice, so both land together.

## Terms

- **Workspace**: a closed area of a server. It holds its members, boards, tracker settings, Planning lists, invites and usage counts. Nothing in one workspace is visible from another.
- **Member**: an account in a workspace, with a role there: `admin` or `member`.
- **Server admin**: the account that runs the server: updates, usage stats, error reports, accounts. It is not a workspace role and opens no board by itself; since it can make a password reset link for any account, it is trusted like the server's operator.
- **Default workspace**: the workspace a server starts with. An upgraded instance moves all its data into it.

## Decisions

1. **Postgres is the only database.** SQLite is removed, with no "small" mode: two engines would mean two sets of migrations, two test runs and bugs found on one only. `docker compose up` starts a Postgres container next to the API, with a generated password, and nobody has to configure it. A company may point `DATABASE_URL` at its own server instead.
2. **Every row that belongs to a workspace carries its id**, and Postgres row-level security hides rows of other workspaces. The API sets the workspace on each transaction. A query that forgets to filter returns nothing instead of another team's data.
3. **A server has one workspace for its people.** Everyone who signs in works in the default workspace. This spec adds no way to create another; demo visitors' workspaces are the only others (decision 10). The data model allows more, so a later spec can add them without moving data.
4. **Accounts belong to the server, roles to the workspace.** Username, password and sessions belong to the account. Admin or member is a role in the workspace; it may have several admins, and the last one cannot leave or step down. The person directory, sharing search and "Everyone in this workspace" see only the workspace's members.
5. **Into the workspace**: the tracker type and Jira URL, the refresh interval, the public link switch, Planning (on or off, types, people, time off, fields, views, days off), invites, boards and their members, task caches, and each person's tracker tokens.
6. **Stays on the server**: the instance id, usage stats and error report switches, updates, metrics, accounts. ENV values such as `TIKO_TRACKER` and `JIRA_BASE_URL` lock their fields, as they do today.
7. **Accounts are the server admin's.** Resetting a password and disabling an account stay with the server admin. A workspace admin removes a person from the workspace only.
8. **A tracker token belongs to a person in a workspace.** It is used only in that workspace, so no other workspace can ever reach it.
9. **Settings split into three groups**: the workspace (general, members, task source, Planning, workload), the person (profile, security, my tracker) and the server (updates, privacy, accounts), the last shown only to the server admin. Otherwise every screen reads as today. The first account is the server admin and the admin of the default workspace, so an upgraded instance changes nothing visible apart from the groups.
10. **A demo visitor gets a workspace of their own.** It starts with an editable copy of the sample Planning lists and is deleted with the visitor. Workload comes back on the demo. "Sign up to keep it" keeps the workspace without an expiry. The read-only sample of spec 031 goes away.
11. **An existing instance moves on its own.** The first start of the new version finds `data/app.db` and an empty Postgres, copies everything into the default workspace, checks the row counts and renames the file instead of deleting it.
12. **This version is installed by the installer.** "Update now" swaps the API and web containers but cannot add the Postgres container. A bridge release on SQLite comes first: its About shows the installer command instead of the button when any release on the way needs it. An older instance that presses the button anyway fails the health check and is rolled back with its database, as today. Later releases update with the button again.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An existing instance keeps working on Postgres (Priority: P1) 🎯

An admin runs the installer again on a server with a week of boards. tiko starts with a Postgres container, and everyone signs in as before: the same boards, members, tracker settings, Planning lists and public links.

**Independent Test**: on a compose stack of the last SQLite release with boards, Planning and a public link, run the installer of the new version. Every board opens with its cards, stages and members. A public link still opens. `data/app.db` is renamed and kept.

**Acceptance Scenarios**:

1. **Given** an instance on SQLite, **When** the new version starts on an empty Postgres, **Then** every row is in the default workspace and the counts per table match.
2. **Given** the copy fails halfway, **When** the API starts again, **Then** it starts the copy over on a cleared database, and `data/app.db` is untouched.
3. **Given** an instance on the bridge release, **When** the Postgres release is out, **Then** About shows the installer command instead of "Update now", and nothing is stopped.
4. **Given** an instance older than the bridge release, **When** the admin presses "Update now", **Then** the new API fails its health check, the updater restores the old containers and database, and About says to run the installer.
5. **Given** a fresh machine, **When** someone follows the README, **Then** `docker compose up --build` starts tiko with Postgres without any configuration.
6. **Given** `DATABASE_URL` pointing to an outside Postgres, **Then** tiko uses it and the compose Postgres is not needed.

### User Story 2 - Roles in the workspace and on the server (Priority: P1)

The first account of a server is its server admin and the admin of the default workspace. They make a teammate admin of the workspace. The teammate sets the Jira URL and the Planning lists and invites people, but does not see updates, privacy or accounts. When someone forgets a password, the server admin makes the reset link.

**Independent Test**: a server with a server admin, a second workspace admin and a member. Each settings group opens only for the role it belongs to; every admin route answers `403` to the others.

**Acceptance Scenarios**:

1. **Given** a workspace admin who is not the server admin, **When** they open Settings, **Then** they see the workspace and personal groups and no server group.
2. **Given** a workspace admin, **When** they remove a person, **Then** the person loses the workspace and keeps their account; resetting their password is not offered.
3. **Given** the last admin of the workspace, **When** they try to leave or become a member, **Then** tiko refuses and says why.
4. **Given** an upgraded instance, **Then** every screen reads as before this spec, apart from the settings groups.

### User Story 3 - A demo visitor plans in their own space (Priority: P2)

A visitor presses "Try the demo", adds a stage type "Design", adds a person and gives them a week off. Another visitor never sees them. Workload opens and counts only the visitor's own boards.

**Independent Test**: on a demo stack, two visitors edit Planning lists; each sees only their own. Evicting a visitor deletes their workspace with every row in it.

**Acceptance Scenarios**:

1. **Given** a new visitor, **When** their welcome board opens, **Then** Planning shows the sample types and people, and "+ New type" and "Add person" work.
2. **Given** a visitor deleted after 7 days away, **Then** no row of their workspace remains.
3. **Given** a visitor signs up, **Then** their workspace and its lists stay, without an expiry.

### Edge Cases

- A person removed from the workspace can still sign in and sees that they are not in a workspace and that an invite link brings them back.
- A signed-in person who is already in a workspace and opens an invite into another one is told so; in this spec an account is in one workspace at a time.
- A public link carries its board's workspace, so an open link keeps working without an account.
- Deleting a demo workspace deletes its boards, members, invites, Planning, tokens and caches. Accounts follow the demo rules of spec 014.
- Two API processes start at once on an empty database with `data/app.db`: only one copies, the other waits.
- A very large `app.db` (board documents of many megabytes) copies in batches without holding it all in memory.
- A demo with thousands of visitors a day creates and deletes a workspace per visitor; this is a few dozen rows each.

## Requirements *(mandatory)*

- **FR-001**: Postgres is the only storage. `DATABASE_URL` selects the server; the compose files start one with a generated password when it is not set.
- **FR-002**: Every table of workspace data has `workspace_id` and a row-level security policy for the application role, forced on the table. No role that serves requests is a superuser, has `BYPASSRLS` or owns a table; the API refuses to start otherwise. A test fails when a table with `workspace_id` has no forced policy.
- **FR-003**: Every request runs with one workspace: from the board for a board, a live socket or a public link, from the person's membership for lists, or from a demo visitor. Without it a request reads no workspace rows. Work outside a request (live saves, background loops) names its workspace too.
- **FR-004**: The first start on an empty Postgres with `data/app.db` copies all data into the default workspace, checks row counts per table, renames the file with the date, and records the result in the log.
- **FR-005**: Roles move to workspace membership. The first account becomes the server admin. Server settings and accounts need the server admin; workspace settings need a workspace admin.
- **FR-006**: The settings show three groups by role, as in decision 9.
- **FR-007**: A demo visitor gets a workspace with an editable copy of the sample lists; eviction deletes it in one statement. Spec 031's read-only sample and its `sample` answer are removed; the contract notes the change.
- **FR-008**: Usage stats keep counting per instance as described in the guide.
- **FR-009**: Before updating, the updater saves a dump of the database to `data/backups`, and restores it when the update fails.
- **FR-010**: The installers write the Postgres password to `.env` when it is missing. A bridge release on SQLite shows the installer command when a release on the way needs it; an update from an older release rolls back on the failed health check and says to run the installer.
- **FR-011**: API contract changes go to `specs/032-workspaces/contracts/` before the code. `CHANGELOG.md`, the README, `.env.example`, the guide (install, configuration, architecture, backups, people) and `THIRD_PARTY.md` follow. `docs/decisions.md` and the constitution record Postgres and the workspace.

## Success Criteria *(mandatory)*

- **SC-001**: An instance of the last SQLite release with made-up boards, Planning and public links upgrades by the installer with no data lost; the counts per table match.
- **SC-002**: With two workspaces in tests (the default one and a demo visitor's), no API route returns a row of the other one; a test walks every route as a member of each.
- **SC-003**: `make check` stays within 30 seconds more than today on a laptop.
- **SC-004**: An upgraded instance looks and behaves as today apart from the settings groups: the existing UI tests pass with wording changes only.
- **SC-005**: A fresh compose stack with Postgres uses no more than 150 MB of RAM more than today at rest.

## Slices

1. `feat/pg-storage`: the Postgres adapter in its final shape, with `workspace_id`, row-level security and one default workspace, behind `DATABASE_URL`. SQLite stays the default until slice 3. Several pull requests, by groups of repositories.
2. `feat/installer-mark`: the bridge release: About shows the installer command when a release on the way needs it. Small, ships first, on SQLite.
3. `feat/pg-switch`: the copy from `app.db`, the compose files, the installers, the updater's dump and refusal, the Render blueprint. SQLite is removed. US1.
4. `feat/server-admin`: the server admin, accounts on their own routes, the three settings groups. US2.
5. `feat/workspace-membership`: removing a person, the last admin rule, the "not in a workspace" screen, joining by invite while signed in, tracker tokens in the workspace. US2.
6. `feat/demo-workspace`: a visitor workspace, editable sample lists, workload on the demo, spec 031's sample removed. US3.

## Out of scope

- Creating more workspaces, switching between them, a list of workspaces.
- Open sign-up, e-mail, password reset by e-mail, signing in with an outside identity.
- Encryption keys per workspace.
- Several API hosts.
- Teams inside a workspace, and roles besides admin and member.
- Exporting or importing one workspace.
- Storing board history as a log of updates instead of one document.

## Decisions at G2

1. The driver is psycopg 3; `make licenses` gets an exception for its three packages (owner, 2026-10-19).
2. The slice order stands.
3. No moderator role and no teams (owner, 2026-10-19).
4. This spec stops at the structure: one workspace, roles, the demo. Creating and switching workspaces wait for a later spec (owner, 2026-10-19).
5. A tracker token belongs to a person in a workspace (owner, 2026-10-19).
