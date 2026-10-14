# Feature Specification: Usage stats and error reports

**Feature Branch**: `feat/usage-stats`, `feat/error-reports`

**Created**: 2026-10-14

**Status**: Approved by the owner at G2 on 2026-10-14: Sentry Cloud (EU), 13 months of raw rows, failed installs report their step, the strategy line changes.

**Input**: Owner's idea: know how many people install and run tiko, on what, and where it breaks, without collecting anything personal, and say so honestly instead of "no telemetry".

## Why

Today we cannot tell how many instances exist. GitHub shows downloads of `compose.release.yml` per release, without the OS and mixed with our own test installs; the GHCR counter mixes installs, updates and CI. When a release breaks on someone's machine we learn about it only if they open an issue.

The README, the site and About say "no telemetry". tiko does not track people and will not, but two things help a self-hosted project decide what to support and what to fix: a count of installs and running instances, and error reports. The wording changes to say exactly what is sent. Counts are on by default, documented field by field and off with one setting, as in Homebrew, Grafana and GitLab; error reports stay off until an admin turns them on.

## Decisions

1. **Two streams, two switches.**

   | Stream | Default | What it answers | Switch |
   |---|---|---|---|
   | Usage stats: install event and a daily ping | on | how many installs and running instances, which versions, platforms and trackers | `TIKO_USAGE_STATS=false`, installer `--no-stats`, Settings → Privacy |
   | Error reports | off | what breaks, in which version | `TIKO_ERROR_REPORTS=true`, Settings → Privacy |

   An ENV variable wins over the setting; when it is set, the toggle in Settings is locked and says which variable set it.

2. **Install event.** After a successful install `install.sh` and `install.ps1` send one request with `kind`, `version`, `os` (`linux`, `darwin`, `windows`), `arch`, `installer` (`sh`, `ps1`) and `updater` (one-click updates on or off). A failed install sends the same fields plus `failed_step`: the name of the installer step (`docker-check`, `download`, `pull`, `start`, `health`), never the error text. The request has a 3-second timeout and its failure is ignored, so the install never depends on our server. Download of the compose file stays on GitHub.

3. **Daily ping.** The API sends one ping 10 minutes after start and then every 24 hours with a random shift of up to an hour. Fields, all of them:

   | Field | Example | Meaning |
   |---|---|---|
   | `schema` | `1` | payload version |
   | `instance_id` | `0b6f…` | random UUID made on first start, stored in the database, not derived from anything |
   | `version` | `2026.10.19` | tiko version |
   | `deploy` | `installer`, `compose`, `railway`, `render`, `source`, `demo` | how it runs: `TIKO_DEPLOY` set by the installer, else found from the platform, else `compose` |
   | `arch` | `arm64` | CPU architecture |
   | `trackers` | `["github", "jira_dc"]` | tracker kinds the cards come from (`demo`, `jira_dc`, `github`), no URLs |
   | `people` | `2-5` | active accounts, bucket: `1`, `2-5`, `6-20`, `21-100`, `100+` |
   | `boards` | `6-20` | boards, same buckets plus `0` |
   | `updater` | `true` | one-click updates on |

   Adding a field is a deliberate change: it bumps `schema`, the guide page and `CHANGELOG.md`.

4. **What is never sent or stored**: IP addresses (Cloudflare sees the address of a request like any web host; the collector reads only the country from `CF-IPCountry` and does not store the address), host names, tracker URLs, board names or contents, task data, usernames, names, emails, tokens, file paths, error messages from the installer.

5. **Collector.** A Cloudflare Worker at `t.tiko.run`, its code in `collector/` in this repository, so anyone can read what is kept. It accepts only the known fields of a known `schema`, drops anything else, adds `received_at` and `country`, and writes one row into Postgres (Neon). Raw rows are kept 13 months, then deleted; monthly counts are kept.

6. **Storage is built for dashboards later.** One table `events` (`id`, `received_at`, `kind`, `schema`, `instance_id`, `country`, `payload` as `jsonb`). Metabase and Grafana read Postgres directly; they are set up later and are not part of this feature. Until then, counts come from saved SQL queries kept outside the repository.

7. **Error reports go to Sentry.** `sentry-sdk` in the API and `@sentry/browser` in the page, loaded only when reports are on, to the project's Sentry in the EU region, free plan. The DSN ships in the image (a Sentry DSN only allows sending events). What a report holds is decided by keeping, not by cleaning:
   - only the error type, the frames of tiko's code (file, function, line) and `release` and the `deploy` tag;
   - no error message: a message can hold task data, an address or a name, and no pattern catches every case;
   - no request, person, host name, breadcrumbs, local variables, sessions, client reports or traces; no trace headers on calls to trackers;
   - only unhandled errors of requests in the API, no log capture;
   - the page sends through the API (`POST /api/privacy/errors`, our project's DSN only), so Sentry never sees the instance's address.

   The API reads the switch at send time, so it needs no restart; an open page picks it up on its next load. `TIKO_ERROR_REPORTS_DSN` points reports at another Sentry or at GlitchTip; `TIKO_ERROR_REPORTS=false` keeps the client from starting.

8. **Settings → Privacy.** Admins see two toggles for the whole instance. Under each: one line on what is sent and why, a link to the guide page, and for usage stats a "Show what is sent" box with the exact JSON of the next ping. Only admins see the section.

9. **Installers tell before they send.** Both installers print this before the first step, so it is on screen before anything is sent, and again at the end:

   ```text
   Usage stats:   on   (version, OS, install count; no personal data)
   Error reports: off
   Details and how to change: https://docs.tiko.run/privacy/
   ```

   `--no-stats` (`-NoStats`) or `TIKO_USAGE_STATS=false` in the environment writes `TIKO_USAGE_STATS=false` into `.env` and sends no install event.

10. **Honest wording everywhere.** "No telemetry" goes away from `README.md`, the site (Hero, SelfHost, FAQ), About and the guide's security page. It becomes "No tracking" with a link to a new guide page **Privacy: usage stats and error reports**, which explains, in this order: why we collect (scale, which platforms and trackers to support first, what breaks after a release), what is sent field by field with a sample JSON, what is never sent, where it goes and how long it is kept, how to turn each stream off, and a link to `collector/`.

11. **Our own instances.** `demo.tiko.run` runs with `TIKO_DEMO`, which reports `deploy: demo`, so it does not count as a self-hosted install.

12. **Rule.** The project constitution records it: usage stats carry no personal data, are on by default, documented and off with one setting; error reports are off by default.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Count installs and running instances (Priority: P1) 🎯

The owner opens a SQL query on Monday and sees: 140 installs last week, 60 % Linux, 25 % macOS, 15 % Windows; 310 instances pinged in the last 7 days, 70 % on the latest two releases, 40 % with Jira Data Center; 4 % of installs failed at `pull` on Windows.

**Independent Test**: run `install.sh` against a local collector: one install row with the documented fields and no IP. Start the API with a fake clock: a ping after 10 minutes and after 24 hours, matching the documented fields. With `TIKO_USAGE_STATS=false` nothing is sent.

**Acceptance Scenarios**:

1. **Given** a successful install, **Then** the collector stores one `install` row with `version`, `os`, `arch`, `installer`, `updater` and `country`, and no IP.
2. **Given** an install that fails at the image pull, **Then** the row carries `failed_step: pull` and no error text.
3. **Given** the collector is down, **Then** the install finishes as usual within 3 extra seconds at most.
4. **Given** `install.sh --no-stats`, **Then** no request is sent and `.env` has `TIKO_USAGE_STATS=false`.
5. **Given** a running API, **Then** the first ping goes 10 minutes after start and the next ones every 24 hours, with the same `instance_id` across restarts.
6. **Given** a payload with an unknown field, **Then** the collector stores only the known fields.
7. **Given** `TIKO_USAGE_STATS=false`, **Then** the API sends nothing and Settings shows the toggle locked with the variable's name.

### User Story 2 - See what breaks (Priority: P2)

An admin turns on error reports. A Jira sync throws in `v2026.10.20`; Sentry shows the exception type, the stack and the version, from 12 instances, without the Jira URL.

**Independent Test**: with a fake transport, raise an exception whose message holds a URL and an email: the captured event has the type and frames only, no message, no request data, no local variables, `release` and the tag `deploy`. With the toggle off nothing is captured. The same for the page with a thrown error on a board route.

**Acceptance Scenarios**:

1. **Given** error reports off (the default), **When** the API or the page throws, **Then** nothing is sent.
2. **Given** an admin turns the toggle on, **Then** the next error is sent without a restart.
3. **Given** an exception message with a URL, a host name or an email, **Then** the sent event has no message at all.
4. **Given** an error on a board, **Then** the event carries no page address and names scripts without the host.

### User Story 3 - Know what is collected before trusting it (Priority: P1)

A person reads "No tracking" on the site, follows the link and in two minutes knows why tiko counts installs, the exact fields, what is never sent, and how to turn it off.

**Independent Test**: the guide page exists and lists every field of the install event and the ping, matching the code (a test compares the field list in the guide page with the payload model); no page, README or UI text says "no telemetry".

**Acceptance Scenarios**:

1. **Given** `rg -i "no telemetry"` over `README.md`, `site/`, `frontend/src` and `docs/guide`, **Then** it finds nothing.
2. **Given** a new field in the ping, **Then** the guide test fails until the page lists it.
3. **Given** Settings → Privacy, **When** an admin opens "Show what is sent", **Then** they see the JSON of the next ping.

## Requirements *(mandatory)*

- **FR-001**: Usage stats MUST be on by default and MUST be off with `TIKO_USAGE_STATS=false`, the installer flag or the Settings toggle.
- **FR-002**: Error reports MUST be off by default and MUST be on only with `TIKO_ERROR_REPORTS=true` or the Settings toggle.
- **FR-003**: The install event and the ping MUST carry only the fields listed in this spec and the guide page.
- **FR-004**: The collector MUST NOT store IP addresses and MUST drop fields it does not know.
- **FR-005**: Sending MUST never block or fail an install, a start or a request; failures are logged at debug level only.
- **FR-006**: Error reports MUST hold only what decision 7 keeps, and MUST send nothing while off.
- **FR-007**: The guide page MUST document every field, the purpose, storage, retention and the switches, and MUST match the code.
- **FR-008**: The app MUST work as today with the collector and Sentry unreachable; tests use mock adapters and send nothing.

## Out of scope

- Metabase and Grafana dashboards.
- Product analytics in the page: clicks, screens, sessions, funnels.
- Usage stats per person or per board.
- A public stats page.
