# Feature Specification: Jira Cloud

**Feature Branch**: `030-jira-cloud`

**Created**: 2026-10-18

**Status**: Approved at G2 on 2026-10-18.

**Input**: The brief names Jira Cloud as the provider that follows GitHub Issues ([spec 013](../013-task-sources/spec.md), [spec 015](../015-github-issues/spec.md)). Roadmap issue #91.

## Why

tiko reads Jira Data Center and Server, and most Jira teams are on Jira Cloud. Today such a team cannot use tiko on its own tasks at all. Cloud speaks the same JQL and returns the same issue fields, so the board, the cards, the JQL assist and the refresh stay as they are; what differs is how a person signs in and a few REST endpoints.

## Terms

- **Jira Cloud site**: a Jira hosted by Atlassian, like `https://example.atlassian.net`.
- **API token**: a token a person creates in their Atlassian account. Jira Cloud takes it together with the account's e-mail.
- **Kind**: Data Center (with Server) or Cloud, the two kinds of Jira tiko reads.

## Decisions

1. **One Jira per instance, of either kind.** Settings → Task source keeps one Jira URL; tiko finds the kind from the site itself. Two Jiras on one instance are out of scope, as they are today.
2. **A Cloud task is a Jira task.** Same source `jira`, same mark, same keys, same card. A team that moves from Data Center to Cloud changes the URL and its boards keep their cards: the keys survive the move.
3. **A person connects with their e-mail and API token** in Settings → My tracker. The e-mail field shows only when the instance's Jira is Cloud. Both are stored encrypted together, bound to the Jira URL like the token today, and sent to that site only.
4. **Everything a Data Center Jira does, a Cloud one does**: a card by key or by link, a paste of links and keys, a range of keys, a JQL query of up to 50 tasks with its count, JQL suggestions, the refresh, the sync list, status timers, the Gantt, public links.
5. **Cloud limits are obeyed.** On a "too many requests" answer tiko waits as long as Jira asks, and the sync list says so, as it does for Data Center.
6. **Read only.** tiko never writes to Jira.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Jira Cloud task is a live card (Priority: P1) 🎯

An admin enters `https://example.atlassian.net` in Settings → Task source. In My tracker a person sees fields for their e-mail and API token, with a link to where the token is made. They press "Test": "Connected as Ada Lovelace". They type `DEMO-12` in the card tool: a card with its type, title, status and assignee. They paste a link copied from Jira: another card. The issue moves to "In Progress" in Jira; within a refresh the card follows.

**Why this priority**: this is the whole value; the rest is the JQL on top.

**Independent Test**: against a fake Jira Cloud in the tests and a live Cloud site on the compose stack: connect, add by key and by link, change the issue, see the card follow.

**Acceptance Scenarios**:

1. **Given** a Jira Cloud URL in Task source, **Then** My tracker asks for an e-mail and an API token; for a Data Center URL it asks for the token only, as today.
2. **Given** a correct e-mail and token, **When** the person presses "Test", **Then** tiko answers with their display name; a wrong pair answers that Jira rejected it, without saying which half was wrong.
3. **Given** a connected person, **When** they add a key, a `/browse/` link or a board link with `selectedIssue`, **Then** a live card appears.
4. **Given** a task that does not exist or that the person cannot see, **Then** the tool says the task was not found, and on a board the card says so; the other cards still refresh.
5. **Given** Jira answers "too many requests", **Then** the cards keep their last data, the sync list shows when tiko tries again, and the other sources refresh as usual.
6. **Given** `TIKO_TRACKER=jira` and `JIRA_BASE_URL` set to a Cloud site, **Then** the instance works the same as when an admin set it in Settings.
7. **Given** a person on a board without a token of their own, **Then** a Cloud card shows its key and "Connect your Jira token", as for Data Center.
8. **Given** a guest on a public link, **Then** Cloud cards show what they show for Data Center today.

### User Story 2 - JQL on Jira Cloud (Priority: P2)

A person types `project = DEMO AND status = "In Progress"` in the card tool. Suggestions offer fields, operators and values as they type. They press Enter: the tasks land on the board in a batch, with "24 tasks" in the tool before they confirm.

**Why this priority**: a batch by query is how a team fills a board; it builds on slice 1.

**Independent Test**: against the fake Jira Cloud: suggestions for fields and for the values of `status`, a query that returns tasks and their count, a query Jira rejects.

**Acceptance Scenarios**:

1. **Given** a connected person, **When** they type JQL, **Then** they get the same suggestions as on Data Center: fields, operators, values, keywords and functions.
2. **Given** a valid query, **Then** up to 50 tasks are added and the tool shows how many the query matches.
3. **Given** a query Jira rejects, **Then** the tool shows Jira's own message.

### Edge Cases

- A Cloud site under a custom domain, not `atlassian.net`: the kind comes from the site's answer, not from its name.
- An admin moves the instance from Data Center to Cloud: every stored token waits to be entered again (the URL changed), cards keep their keys and turn live once a person connects.
- A key moved to another project in Jira: Jira answers with the new key; the card shows the task under its new key as on Data Center today.
- A person's API token expires: the sync list says Jira rejected the token, and My tracker asks for a new one.
- An e-mail with spaces or capitals pasted around it: trimmed; case is kept, Jira compares it.
- Poll of many keys where some were deleted: deleted keys come back "not found", the rest are live, in one pass.

## Requirements *(mandatory)*

- **FR-001**: A Jira Cloud adapter implements the task port (`resolve`, `poll`, `search`, `check`, JQL vocabulary and values) against the Jira Cloud REST API with Basic auth of e-mail and API token.
- **FR-002**: The instance finds the kind of its Jira from the site when the URL is saved or tested, and keeps it with the URL. A URL from the environment is checked the same way at start.
- **FR-003**: The person's Jira credential holds an optional e-mail next to the token; the API to save and test it takes the e-mail. The contract change is written in `specs/030-jira-cloud/contracts/` before the code.
- **FR-004**: Tasks keep the source `jira`; nothing stored on boards changes.
- **FR-005**: Errors map to the same Jira errors and codes as Data Center: unauthorized, not found, rate limited with the wait, unavailable, unreachable.
- **FR-006**: Usage stats count a Cloud instance as `jira_cloud`, apart from `jira_dc`; the collector accepts the new value.
- **FR-007**: Works without keys: the tests run against a fake Jira Cloud; the smoke covers the kind check.
- **FR-008**: No new dependency; no new ENV variable.
- **FR-009**: The guide gets a "Connect Jira Cloud" page, the trackers table marks Jira Cloud available, `CHANGELOG.md` gets a line per slice, `docs/brief.md` and the README name Jira Cloud as supported.

## Success Criteria *(mandatory)*

- **SC-001**: From an empty instance, a person with a Jira Cloud site gets their first live card in under 2 minutes, counting the token creation by the guide's link.
- **SC-002**: A change in Jira Cloud reaches the card within one refresh interval.
- **SC-003**: A board of 300 Cloud cards refreshes in one pass without a "too many requests" answer.
- **SC-004**: An instance on Jira Data Center behaves exactly as in the previous release: its tests pass unchanged.
- **SC-005**: The API token never reaches the browser, the log or a host other than the Jira site (the token leak test covers the e-mail and token).

## Slices

1. `feat/jira-cloud` (US1): the kind check, e-mail and API token, cards by key and link, the refresh, errors and limits, the guide page.
2. `feat/jira-cloud-jql` (US2): search with its count and JQL suggestions.

## Out of scope

- Two Jiras on one instance (Data Center and Cloud side by side).
- Sign-in with an Atlassian account (OAuth) instead of a pasted token. It would fill the same per-person credential later.
- Scoped API tokens through `api.atlassian.com`, if the plan finds plain site requests enough.
- Jira Service Management portals, Jira Product Discovery fields, Atlassian Teams.
- Webhooks; writing to Jira.

## Decisions at G2

1. **API tokens.** Atlassian recommends OAuth 2.0 (3LO) for apps that act for many users. On a self-hosted tiko a person pastes their own token into their own team's server, as with command-line tools. OAuth needs a registered app with a secret and a fixed callback, which a self-hosted instance on its own domain cannot share, so API tokens stay the way to connect a self-hosted tiko. OAuth can come later as a second way to fill the same per-person credential; the adapter then only changes its base URL and header.
2. **Two slices**: cards first, JQL second.
