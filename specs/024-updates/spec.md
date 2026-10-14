# Feature Specification: Updates

**Feature Branch**: `feat/update-check`, `feat/one-click-update`

**Created**: 2026-10-14

**Status**: Approved by the owner at G2 on 2026-10-14, with one-click updates on by default in the installers.

**Input**: Owner's idea (ideas D20 and D20.1): a self-hosted instance should learn about a new release within half an hour, an admin should update it with one click and watch the progress, and a release that matters (security, breaking, hotfix) should stand out so people update soon.

## Why

Today the API asks GitHub for the latest release at most once in 6 hours and the page keeps the answer for another hour, so a release can stay unseen for up to 7 hours. Updating means a shell on the host: `docker compose pull` and `up -d`, and an install made by `install.sh` is pinned to its release, so a plain pull fetches nothing new. Every release looks the same in About, so a security fix gets the same small dot as a new color.

Hosted instances (`demo.tiko.run`, a future hosted tiko) are updated by us and are not part of this feature.

## Decisions

1. **Check every 30 minutes.** The API asks GitHub at most every 30 minutes and after a failure waits 10 minutes. It sends `If-None-Match` with the last `ETag`, so an unchanged answer is a `304` without a body. Without a token a `304` still counts against GitHub's limit of 60 calls an hour per address, which GitHub issue cards share, so the check stays at 2 calls an hour per API process plus Check now. The page refreshes the answer every 5 minutes and when the tab comes back into view.
2. **Check now.** About has a "Check now" button that asks GitHub at once, for anyone signed in, at most once in 5 minutes per API process.
3. **Release level.** Each release has one level: `security`, `breaking`, `hotfix` or `feature`. `make release LEVEL=<level>` writes it as the first line of the version's section in `CHANGELOG.md` (`**Security release.**`, `**Breaking changes.**`, `**Hotfix.**`; a feature release has no line), so people read it on GitHub and the API reads it from the release notes. No line means `feature`.
4. **The highest level wins.** The API reads the releases newer than the running version (the last 100) and reports the newest version and the highest level among them: three releases behind with one security fix in the middle is a security update.
5. **How a level shows:**

   | Level | About button | Banner above the About button |
   |---|---|---|
   | `feature` | dot, as today | - |
   | `hotfix` | dot | - |
   | `breaking` | dot | - |
   | `security` | red dot | for admins, closes for 24 hours and then comes back until the update |

   About lists what is new: the versions and their levels, with links to the notes. A `breaking` update asks the admin to read the notes before it starts.
6. **One-click update follows the big self-hosted projects.** Most of them (Immich, Gitea, Mastodon) only notify; the ones with a button in the app (Nextcloud AIO, Home Assistant Supervisor, Coolify) have a separate manager with access to Docker that the person chooses at install. tiko does the same:
   - a separate `updater` service in `compose.release.yml`, behind the compose profile `updater`; only it gets the Docker socket, and it has no port outside the compose network;
   - `install.sh` and `install.ps1` ask "Turn on one-click updates?" (default yes) and add the profile to `.env`; a manual install turns it on with `COMPOSE_PROFILES=updater`;
   - the API talks to it with a token in `data/updater-token`, made by the API on its first start, and only for an admin;
   - the updater recreates `api` and `web` through the Docker API from their own settings with the new image, as Watchtower did, and does not run `docker compose`: a compose file needs the install folder at the same path inside the container, and a Windows path does not exist in a Linux container;
   - the updater itself is updated by the installer, not by the button;
   - without the updater (a manual install that did not turn it on, a source build, Railway, Render) About shows the commands to update by hand or a note to redeploy.
7. **What an update does**: the API backs up `data/app.db` into `data/backups/` as `pre-update-<old version>.db` from its own connection, then asks the updater. The updater pulls the new images with progress, recreates `api` and then `web`, waits for the health check, and writes the new version into the default tag of the install's compose file, so a later `docker compose up` stays on it. If the new `api` is not healthy in 2 minutes, the updater starts the old containers and puts the backup back, and About says so with the log.
8. **Updates leave no garbage.** The updater keeps the 3 newest `pre-update-*.db` and deletes older ones; the `app-*.db` of `make backup` are not touched. After a healthy update it removes tiko images older than the previous release, so the disk holds two releases: the running one and the one to roll back to. Before the backup the API checks free space next to the database and refuses with the numbers when there is not enough. The free space for images cannot be measured from inside a container on Docker Desktop, so a full disk shows as a failed download, before any container is touched.
9. **Progress in the page.** The admin sees steps (backup, download, restart) and a bar for the download from the layer progress Docker reports. While `api` restarts the admin's page shows "Restarting tiko", waits for the new version and reloads itself. Other people's pages reconnect on their own like after any restart and then show "tiko was updated to vX" with a Reload button; a reload by force could drop changes not saved yet.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Learn about a release soon, and how much it matters (Priority: P1) 🎯

An admin of a self-hosted instance gets a security release within half an hour: a red dot on About and a banner on the board. About lists the two releases they missed and marks one as security.

**Independent Test**: with a fake release feed, publish a newer `hotfix` and then a `security` release: within the check interval About shows the newest version, both releases with levels and a red dot, and an admin sees the banner. "Check now" shows a just-published release at once.

**Acceptance Scenarios**:

1. **Given** a check 30 minutes ago, **When** the page asks for the version, **Then** the API asks GitHub again with the last `ETag`, and a `304` keeps the last answer.
2. **Given** GitHub is unreachable, **Then** About shows the last known answer and the API tries again in 10 minutes.
3. **Given** "Check now" pressed twice within 5 minutes, **Then** GitHub is asked once.
4. **Given** two newer releases, `hotfix` and `security`, **Then** the version reports the newest version and level `security`, and About lists both.
5. **Given** a security update and an admin on a board, **Then** a banner shows; closed, it comes back after 24 hours; a person who is not an admin sees no banner.
6. **Given** release notes without a level line, **Then** the level is `feature`.
7. **Given** `make release LEVEL=security`, **Then** the version's section in `CHANGELOG.md` starts with `**Security release.**`; an unknown level stops the release.
8. **Given** `UPDATE_CHECK=false`, **Then** nothing is asked and About shows the version only.

### User Story 2 - Update with one click (Priority: P2)

An admin opens About, sees v2026.10.20 with a security fix, clicks "Update now", watches the backup, the download bar and the restart, and the page comes back on the new version.

**Independent Test**: install the previous release with `install.sh` on a clean VM, publish a newer test release, click "Update now": the page reloads on the new version, `data/backups/` has a new backup, the boards are there. A release whose `api` fails its health check rolls back to the old version with the boards intact.

**Acceptance Scenarios**:

1. **Given** an install with the updater and an admin, **Then** About shows "Update now"; a person who is not an admin sees "Ask an admin to update".
2. **Given** a `breaking` update, **When** the admin clicks "Update now", **Then** About links the notes and the update starts only after a confirm.
3. **Given** an update running, **Then** the admin sees the step and the download bar, and a second click or a second admin cannot start another one.
4. **Given** `api` restarting, **Then** the admin's page shows "Restarting tiko" and reloads on the new version, and other open pages offer a reload once they see the new version.
5. **Given** the new `api` is not healthy in 2 minutes, **Then** the old images and the backup are back, and About shows that the update failed with the log.
6. **Given** an install without the updater, **Then** About shows the update commands to copy; on Railway and Render it says to redeploy the service.
7. **Given** five updates in a row, **Then** `data/backups/` holds the 3 newest `pre-update-*.db` and Docker holds the images of two releases.
8. **Given** too little free disk for the backup, **Then** the update does not start and About shows the space needed and free; a disk too full for the images fails the download and leaves the old version running.
9. **Given** a request to the updater without the token or from outside the compose network, **Then** it is refused.

## Requirements *(mandatory)*

- **FR-001**: The API MUST ask for releases at most every 30 minutes, with `If-None-Match`, and MUST keep the last answer when GitHub fails.
- **FR-002**: "Check now" MUST ask at once, at most once in 5 minutes per API process.
- **FR-003**: The version answer MUST carry the newest release, the highest level of the releases newer than the running one, and their list with versions, levels and links.
- **FR-004**: `make release` MUST take a level and write it into `CHANGELOG.md`; the release notes MUST carry it.
- **FR-005**: The updater MUST be the only service with the Docker socket, MUST be off unless its profile is on, and MUST answer only the API with the token.
- **FR-006**: Only an admin MUST be able to start an update, and only one update at a time.
- **FR-007**: An update MUST back up the database first and MUST roll back to the old images and the backup when the new `api` is not healthy.
- **FR-008**: An install without the updater MUST keep working as today and show the steps to update by hand.
- **FR-009**: An update MUST keep at most 3 of its own backups and the images of two releases, and MUST check free space for the backup before it starts.

## Out of scope

- Updates on a schedule without a click, and updating to a version other than the newest.
- Updating hosted instances (`demo.tiko.run`, Railway, Render) from the page.
- Email or push notifications about a release.
- Rolling back to an older version after a successful update.
- Updates of a source build.
- The updater updating itself.
