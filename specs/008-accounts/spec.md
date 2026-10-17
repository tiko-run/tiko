# Feature Specification: Accounts and roles

**Feature Branch**: `008-accounts`

**Created**: 2026-10-08

**Status**: Draft

**Input**: Owner's decision at G1 on 2026-10-08: "I want to plan for team work from the start, like Miro. It is one of the features that will get us noticed by companies that want a Miro alternative inside their own network." Team mode leaves Won't. This spec is its first step: accounts, roles, a settings window, board sharing and a tracker token per person. Spec 007 (instance password) was step 0; its password becomes the first admin's.

## Team mode roadmap

This spec covers step 1. The others get their own specs; nothing here builds them, but the data model must not block them.

1. **Accounts and roles** (this spec): people, sessions, a settings window, invites, board sharing, a tracker token per person.
2. **Real-time** ([spec 009](../009-realtime/spec.md)): several people on one board at once with cursors and presence, on a CRDT (`yjs` in the browser, `pycrdt` and `pycrdt-websocket` on the server, both MIT). Until then two editors are kept apart by the existing `version_conflict` check.
3. **OIDC SSO** (Keycloak, ADFS, Entra ID).
4. **Several trackers at once**: each person connects their own accounts (Jira, Jira Cloud, GitHub) and a card remembers its tracker, for companies where teams use different trackers. Until then one tracker serves the whole instance.
5. **Postgres** as a second storage adapter next to SQLite, a Helm chart, backups. Several API replicas need Redis pub/sub for real-time fan-out.

Decisions that stand for every step:

- **Monolith.** One FastAPI process with WebSockets serves hundreds of people; no microservices.
- **License.** Accounts, roles, sharing and real-time are AGPL.
- **Fast and light.** No auth framework (better-auth is Node and brings its own tables, sign-up and mail); no new dependency where the standard library does the job.
- **Works without keys.** No mail server: invites and password resets are links the admin copies and sends however they like.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Signing in as a person, not as the instance (Priority: P1)

The owner upgrades an instance that already has boards and a Jira token. After the upgrade the sign-in screen asks for a username and a password. They sign in as `admin` with the instance password they used before and find everything as it was: their boards, their Jira token, their settings. On a fresh install the same happens with the password from `TIKO_PASSWORD` or the one printed to the log. In Settings they can change their name, username and password, and sign out on every device.

**Why this priority**: Every other story needs people to exist; the upgrade must not lose anything or lock the owner out.

**Independent Test**: take a `data/` folder from v2026.10.9 with two boards and a Jira token, start the new version: sign in as `admin` with the old password; both boards and the Jira connection are there. Change the password, sign in on a second browser, press "Sign out everywhere": both browsers are signed out.

**Acceptance Scenarios**:

1. **Given** a database with no users, **When** the API starts, **Then** it creates one admin with username `admin` and the instance password (from `TIKO_PASSWORD`, or `data/password`, generated and logged once as today), makes them the owner of every existing board and moves the stored tracker token to them.
2. **Given** users exist, **Then** `TIKO_PASSWORD` and `data/password` are no longer read, and the log says so once at start if `TIKO_PASSWORD` is still set.
3. **Given** the sign-in screen, **When** a username and password match an active account, **Then** a session starts (cookie as in spec 007: `HttpOnly`, `SameSite=Lax`, `Secure` behind HTTPS, 30 days) and the app opens.
4. **Given** a wrong username or password, **Then** the answer and its timing are the same whether the username exists or not, and the error is "Wrong username or password."
5. **Given** a signed-in person, **When** they change their password, **Then** every other session of theirs ends; the current one stays.
6. **Given** "Sign out everywhere", **Then** every session of that person ends, including the current one.
7. **Given** 10 wrong passwords for one username within 15 minutes, **Then** sign-in for that username answers 429 with `Retry-After` until the window passes; the instance-wide limit from spec 007 stays as a backstop.

---

### User Story 5 - Settings in one window with sections (Priority: P1, built right after US1)

Settings grow with this spec: profile, security, people, a tracker per person, instance options, later SSO. The side sheet holds one column of forms and already scrolls with just the account and the tracker. The owner opens the main menu, picks "Settings" (or presses `⌘,`), and a window opens over the board: sections on the left grouped as "Account" and "Instance", the picked section on the right. They change their name in Profile, switch the theme in Preferences, close with Esc and are back on the same board at the same spot. A link with `?settings=security` opens the window on that section.

**Why this priority**: People (US2) and My tracker (US4) need a place to live; building them into the sheet first and moving them later is double work.

**Why a window and not a page or the sheet**: tiko is a canvas; settings are a short visit, and the board stays in place behind the window, the way Figma, Miro and Notion do it. A separate page would unload the board and lose the view. The sheet is too narrow for a people table and has no room for navigation.

**Independent Test**: open Settings from the main menu and with `⌘,`: the window opens on Profile. Pick Security, reload the page: it opens on Security. Change the theme in Preferences: the board behind changes at once. As a member, the "Instance" group is not shown and `?settings=task-source` opens Profile. At 600px wide the window fills the screen and shows a list of sections first.

**Acceptance Scenarios**:

1. **Given** the main menu, **Then** it starts with the person's name and username, has "Settings" with `⌘,`, and ends with "Sign out".
2. **Given** the window, **Then** the sidebar shows "Account": Profile, Security, Preferences (and My tracker from US4), and for admins "Instance": Task source (and People from US2). Sections a person cannot use are not shown.
3. **Given** a section, **Then** its forms save on their own button, as today; leaving a section with unsaved changes keeps them until the window closes.
4. **Given** `?settings=<section>`, **Then** the window opens on it; an unknown or forbidden section opens Profile; closing the window removes the parameter.
5. **Given** the window, **Then** Esc or the × closes it, focus returns to the main menu button, and the board keeps its viewport.
6. **Given** a window under 720px wide, **Then** the window fills the screen, shows the list of sections, and each opens with a Back button.
7. **Given** the command palette, **Then** "Open settings" and "Change password" open the window on Profile and Security.

### User Story 2 - The admin brings people in (Priority: P2)

The admin opens Settings → People (Instance group), presses "Invite", picks a role (Member or Admin) and gets a link. They send it in chat. The colleague opens it, picks a username, a display name and a password, and lands on the board list. The admin sees the new person in People and can make them admin, disable them (they are signed out at once and cannot sign in) or issue a password reset link.

**Why this priority**: Without people there is nothing to share.

**Independent Test**: as admin, invite a member, open the link in a private window, finish sign-up: the member is signed in and sees no boards of the admin. Disable them from People: their next request gets `auth_required` and sign-in says the account is disabled. Issue a reset link, open it: a new password works, the old one does not.

**Acceptance Scenarios**:

1. **Given** an admin, **When** they create an invite with a role, **Then** they get a link with a random token valid for 7 days and usable once; only the token's hash is stored.
2. **Given** an invite link, **When** someone opens it, **Then** they see a form for username (3–32 characters, letters, digits, `.`, `-`, `_`, unique without regard to case), display name and password (at least 10 characters), and on submit they are signed in.
3. **Given** a used, expired or revoked invite, **Then** the page says "This invite link has expired. Ask your admin for a new one."
4. **Given** People, **Then** the admin sees every person with name, username, role, status and last sign-in, and pending invites with their expiry and a revoke button.
5. **Given** the admin disables a person, **Then** all their sessions end, they cannot sign in, and the boards they own stay reachable by the admins (see US3).
6. **Given** the admin issues a password reset for a person, **Then** they get a one-time link valid for 24 hours; using it sets a new password and ends that person's sessions.
7. **Given** only one active admin, **Then** they cannot demote or disable themselves.

---

### User Story 3 - Sharing a board (Priority: P3)

A lead builds a sprint board and presses "Share" in the top bar. A dialog lists who has access. They add two colleagues as editors and one as a viewer, or switch "Everyone in tiko" to "Can view". The editors see the board in their list and change it; the viewer sees it with a "View only" badge and cannot move or edit anything. The owner can change roles, remove people and transfer ownership.

**Why this priority**: This is the team value; real-time (spec 009) builds on it.

**Independent Test**: admin shares a board with member A as editor and member B as viewer. A moves a card: saved. B opens the board: the card moved, the toolbar is gone, "View only" shows, and `PUT /api/boards/{id}` as B answers 403. A third member C does not see the board in the list and gets 404 on its URL.

**Acceptance Scenarios**:

1. **Given** a board, **Then** each person has at most one role on it: owner (exactly one), editor or viewer. The board's "everyone" setting is none, viewer or editor, and a person's own role wins when it is higher.
2. **Given** a board a person has no role on and "everyone" is none, **Then** it is not in their list and every route for it answers 404, so its existence does not leak.
3. **Given** a viewer, **Then** they can open the board, refresh its cards and search it, but saving, renaming, deleting and sharing answer 403 `forbidden`, and the canvas is read-only.
4. **Given** an editor, **Then** they can change the content and rename the board, but not delete it or change who has access.
5. **Given** the owner, **Then** they can share, change roles, set "everyone", transfer ownership to another person and delete the board.
6. **Given** an admin, **Then** they see every board in a separate "All boards" section of the board switcher and can act as owner on any of them, so no board is ever stranded by a disabled owner.
7. **Given** two editors save the same board, **Then** the second gets `version_conflict` and reloads, as today.
8. **Given** a new person, **Then** they get their own welcome board once, owned by them.

---

### User Story 4 - Each person brings their own tracker token (Priority: P4)

Each person connects Jira with their own personal access token in Settings → My tracker. The admin sets the Jira URL once for the instance. On a shared board, every card shows what the viewer's own Jira access allows: a task they cannot see in Jira shows as a locked card with only its key, and someone without a token sees a prompt to connect one.

**Why this priority**: Without it, sharing a board would show every viewer what the owner's token can see, going around Jira's permissions.

**Independent Test**: with a fake Jira where token T1 sees DEV-1 and DEV-2 and token T2 sees only DEV-1: A connects T1, B connects T2. A puts both on a shared board. B opens it: DEV-1 shows its status, DEV-2 shows as locked with no summary. C without a token sees both cards as "Connect your tracker to see this task". No response to B or C ever contains DEV-2's summary.

**Acceptance Scenarios**:

1. **Given** the admin, **Then** they set the provider, the Jira URL and the refresh interval for the instance; members cannot change them. **Given** `TIKO_TRACKER` or `JIRA_BASE_URL` in the environment, **Then** those win and show as set by the server, so whoever deploys tiko can hand it over with the tracker already in place.
2. **Given** any person, **Then** they set, test and remove their own token; it is stored encrypted with `TIKO_SECRET_KEY`, never returned, never logged, as today.
3. **Given** a board refresh or open, **Then** tasks are fetched and cached with the requesting person's token, and the cache of task snapshots is kept per person: a snapshot fetched with one person's token is never returned to another.
4. **Given** a task the person's token cannot see, **Then** the card shows the key with a lock and "You don't have access to this task in Jira"; its summary, status and assignee are not sent.
5. **Given** a person with no token while the provider is Jira, **Then** cards show the key and "Connect your tracker to see this task", with a link to Settings.
6. **Given** the demo provider, **Then** everyone sees the demo tasks; no token is needed.

### Edge Cases

- Upgrade of an instance that was never signed into: the generated `data/password` becomes `admin`'s password; the log says so.
- Two people accept invites with usernames differing only in case: the second gets "This username is taken."
- The only admin forgets their password: `python -m app.reset_password <username>` run in the api container prints a one-time reset link.
- An admin removes the last owner's account: they cannot delete people, only disable; ownership stays until transferred.
- A board shared with "everyone: editor" and a person explicitly set as viewer: the higher role wins (editor); the dialog shows it.
- A person's role changes while their board is open: the next save answers 403 and the canvas turns read-only with a notice.
- The Jira URL changes: every person's stored token stays but shows "Test your token again", like today's unreadable state.
- Board JSON lists task keys a viewer cannot see: the keys themselves are visible to everyone on the board; only task data is filtered.

## Requirements *(mandatory)*

- **FR-001**: Passwords are hashed with `hashlib.scrypt` (n=2^14, r=8, p=1, 16-byte salt); no new dependency.
- **FR-002**: Sessions live in the database as SHA-256 hashes of a random 32-byte token, so they can be listed and revoked; checking one costs one indexed lookup, with an in-process cache of at most 30 s for active sessions.
- **FR-003**: Every board route checks the person's role through one domain function; routes do not check roles themselves.
- **FR-004**: Task data from the tracker is fetched, cached and returned per person; no code path returns a snapshot made with another person's token.
- **FR-005**: Invites and reset links store only the token's hash; the plain token is shown once.
- **FR-006**: No mail server, no new external service; works without keys.
- **FR-007**: The upgrade from v2026.10.9 is automatic and keeps every board, setting and the tracker token.
- **FR-008**: The API stays backward compatible for the frontend shipped in the same release only; the contract change is announced in `CHANGELOG.md`.

## Success Criteria *(mandatory)*

- **SC-001**: An instance upgraded from v2026.10.9 opens with every board and the Jira connection for `admin`, with no manual step.
- **SC-002**: The access test matrix (person × board role × route) passes: no route returns a board, task data or member list to someone without a role.
- **SC-003**: A signed-in request adds under 1 ms of server time on a board with 200 cards (session check and role check).
- **SC-004**: A colleague goes from an invite link to a shared board in under a minute.
