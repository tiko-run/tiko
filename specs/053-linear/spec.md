# Feature Specification: Linear

**Feature Branch**: `053-linear`

**Created**: 2026-11-21

**Status**: Approved at G2 on 2026-11-21, reviewed by the architect subagent the same day.

**Input**: Roadmap issue #86, votes in discussion #71. Builds on [spec 013](../013-task-sources/spec.md) (a task knows its source, a new source is an adapter), [spec 015](../015-github-issues/spec.md) (a personal token, labels and rows) and [spec 040](../040-caldav/spec.md) (a source every person connects on their own).

## Why

Teams that left Jira often went to Linear, and they plan on whiteboards just as much. Today such a team cannot put a single one of its tasks on a tiko board.

Which fog does this clear: the Linear issues of a cycle sit on one board next to the notes, arrows and Jira or GitHub tasks they depend on, and stay current without being copied.

A second reason: more trackers will follow, and each must be one adapter and one description of the source, not another round of `if github … elif caldav …` across the code. Slice 0 does that before Linear lands.

## Terms

- **Linear issue**: an issue in a Linear workspace. Linear has no issue types.
- **Identifier**: what Linear shows on an issue, like `ENG-123`: the team key and a number.
- **Workspace slug**: the part of a Linear link after `linear.app/`, like `example` in `linear.app/example/issue/ENG-123`.
- **Key**: `<workspace slug>/<identifier>`, like `example/ENG-123`. The ref is `linear:example/ENG-123`. The card shows `ENG-123`, as a GitHub card shows `repo#12` of `owner/repo#12`.
- **Team key**: the prefix of an identifier, like `ENG`.
- **API key**: a personal key a person creates in Linear under Settings → Security & access. It reads what that person can read in one workspace.
- **Source description**: one entry per tracker in the code that says how its keys and links look, how a person connects it and what a guest may see. Every place that today asks "is this GitHub?" asks the description instead.

## Decisions

1. **The connection is personal.** Each person pastes their own Linear API key in Settings → My tracker, next to Jira, GitHub and CalDAV. Saving checks the key and answers "Connected as Ada Lovelace in Example". An admin sets nothing, and Linear works on every tiko whatever tracker the instance is set to. The key is stored encrypted like the other tokens and sent to `api.linear.app` only. A demo visitor cannot connect one.
2. **One workspace per person.** A Linear API key belongs to one workspace. Several are out of scope.
3. **The key carries the workspace.** Two people with keys of different workspaces may both have an `ENG-42`; a bare identifier would show one of them the wrong issue without a word. The workspace slug in the key rules that out, and gives a guest the right link without asking Linear.
4. **A task is added by its link, its key, or a bare identifier.**
   - A `linear.app/<workspace>/issue/ENG-123/...` link is a Linear card for a person who connected Linear.
   - A bare `ENG-123` looks like a Jira key. tiko asks every connected tracker whether it knows the prefix `ENG`: Linear by the person's team keys, Jira by one project lookup with the person's token. None knows it: it goes to the instance's tracker as today. One knows it: it goes there.
   - Both know it: a dialog "ENG is a project in Jira and a team in Linear. Where is ENG-123 from?" with the two trackers' marks as buttons, a "Remember for ENG" box and a link to Settings → My tracker → Key prefixes, where every remembered choice is listed and can be changed or removed. A remembered choice skips the dialog. A paste or a query of many keys asks once per prefix. Cancel leaves those keys unadded.
   - The card tool, the Gantt add form and a paste on the board all go through the same step. A timer watch takes the source of its card and never asks.
   - The public API and MCP take `linear:example/ENG-1` or a link; an ambiguous bare key uses the remembered choice, or answers that the caller must name the tracker.
   - Cards already on a board keep their source: nothing stored changes meaning.
5. **The card shows the identifier.** `type_name` is "Issue", or "Sub-issue" when the issue has a parent.
6. **Status** is the issue's workflow state, with its own name. The category comes from the state's type:

   | Linear state type | Category |
   |---|---|
   | triage, backlog, unstarted | new |
   | started | indeterminate |
   | completed, canceled, duplicate | done |

7. **Priority**: Urgent, High, Medium, Low; "No priority" shows no priority row.
8. **The mini-card** shows the labels as chips in their Linear colors, as GitHub labels do, and the rows Project, Cycle, Estimate and Parent that have a value. Assignee and updated time sit where they sit for every tracker.
9. **Dates for the Gantt**: the issue's due date fills `Task.due` with the field name `dueDate`. Linear issues have no start date; the Gantt fills it in itself.
10. **Refresh is one request per person per poll for up to 100 cards.** All of a person's Linear cards on an open board are asked by their identifiers in one GraphQL request, archived issues included, at the board's pace. tiko obeys the request and complexity limits Linear reports (2,500 requests and 3,000,000 points an hour per user, shared by all the user's keys and tools), keeps a tenth of each in reserve and serves the last answer while it waits.
11. **An issue moved to another team** gets a new identifier in Linear. The card keeps the key it was added with and shows the issue under it, the way Linear itself still opens the old identifier.
12. **A guest sees the key and the link only.** Nothing in Linear is public. A teammate without a key of their own sees the key and "Connect your Linear key to see this task".
13. **Many tasks by a query** (slice 3). The card tool takes a query for Linear in the JQL form people already know from Jira, with the same suggestions for fields, operators and values:

    ```
    team = ENG AND labels = bug AND cycle in openSprints() AND assignee = currentUser()
    text ~ "billing" AND updated > -2w
    ```

    tiko turns it into Linear's own filter; nothing reusable exists for this (research of 2026-11-21: Linear has no typed query language in the app, the API, the CLI or its MCP server, and no community library translates one). The query adds its issues in one batch, up to 50, and says when more match, as a JQL query does. `text ~` searches the title and the description. A link to a saved Linear view is a query too: its issues come from the view as Linear stores it.
14. **The mark** is Linear's logo from its brand page, unchanged, in the colors its guidelines allow. Linear agreed to this use in writing on 2026-11-26.
15. **Read only.** tiko never writes to Linear.

## User Scenarios & Testing *(mandatory)*

### User Story 0 - Every tracker described once (Priority: P0, no visible change)

A developer adds a tracker. They write its adapter, one source description and one entry with its mark in the web registry, and wire it in one list. No other file asks which tracker a key belongs to.

**Why this priority**: Linear would be the fifth tracker and the third copy of the personal readers, the "not connected" stand-in and the token methods.

**Independent Test**: a matrix test written on today's code pins how refs route, which keys are valid, what a guest gets, the usage names and the My tracker answer for every source; it passes before and after the refactor. A guard test fails on a tracker name written in `api/` or `domain/` outside the source descriptions.

**Acceptance Scenarios**:

1. **Given** the refactor, **Then** every existing test and the matrix test pass, and Jira, GitHub, CalDAV and demo cards behave as in the previous release.
2. **Given** a CalDAV card on a public link, **Then** a guest gets no Jira link for it (a bug fixed on the way, in its own commit).
3. **Given** My tracker, **Then** the token states come as one map by source; the web app reads it.

### User Story 1 - A Linear issue is a live card (Priority: P1) 🎯

A person opens Settings → My tracker, follows the link to Linear's Security & access page, creates a key and pastes it: "Connected as Ada Lovelace in Example". They paste a link to `ENG-42` on the board: a card with `ENG-42`, the title, "In Progress" in the color of work in progress, the Linear mark. In Linear the issue moves to Done; within a refresh the card is struck through and reads "Done". The sync list has a "Linear" row with the mark. A teammate without a key sees the key and the hint; a guest of the public link sees the key and the link.

**Why this priority**: this is the whole value; bare keys and queries are faster ways in on top of it.

**Independent Test**: against a fake Linear in the tests: connect, add by link, change the issue, see the card follow; a teammate and a guest. On the dev stack against a test workspace: the same by hand in both themes.

**Acceptance Scenarios**:

1. **Given** Settings → My tracker, **Then** a person can save and remove a Linear API key; saving answers with their name and workspace, a key Linear rejects is refused with a plain message.
2. **Given** a connected person, **When** they paste or type a Linear issue link, **Then** a card with the source `linear` appears.
3. **Given** a Linear card, **Then** it shows the identifier, the title, the state name in its category's color and the Linear mark; a sub-issue reads "Sub-issue".
4. **Given** the issue changes in Linear, **Then** the card follows within one refresh interval.
5. **Given** an issue that was archived, **Then** the card keeps showing it; **Given** one that was deleted or is in another workspace, **Then** the card says not found and the other cards still refresh.
6. **Given** Linear answers that the limit is used up, or tiko reaches its reserve, **Then** the cards keep their last data, the sync list shows when tiko tries again, and the other sources refresh as usual.
7. **Given** the person's key is revoked, **Then** the sync list says Linear rejected the key, the cards keep their last data, and My tracker asks for a new key.
8. **Given** a person without a key on a board with Linear cards, **Then** each card shows its key and "Connect your Linear key to see this task".
9. **Given** a guest on a public link, **Then** a Linear card shows its key and its Linear link only.
10. **Given** a Linear card, **Then** its mini-card shows the labels as chips, the Project, Cycle, Estimate and Parent rows that have a value, the priority, and "Open in Linear".
11. **Given** an issue with a due date, **Then** a Gantt row of it ends on that date.
12. **Given** the public API or MCP, **Then** a ref `linear:example/ENG-42` or a Linear link adds the card.

### User Story 2 - Bare keys and the prefix dialog (Priority: P1, ships with US1)

A person with Linear and a Jira instance types `ENG-43`. Only Linear has a team `ENG`: a Linear card, no question. They type `OPS-7`: only Jira knows `OPS`: a Jira card, as before. They type `CORE-5`, and both know `CORE`: the dialog asks, they pick Linear and tick "Remember for CORE". The next `CORE-6` goes to Linear without a question. In Settings → My tracker → Key prefixes they see "CORE → Linear" and switch it to Jira.

**Why this priority**: people copy identifiers more often than links; without this a Linear team on a Jira instance can only paste links.

**Independent Test**: against a fake Linear and a fake Jira: each of the four routing cases, a paste of three keys with two ambiguous prefixes asks twice, a remembered choice, its change in Settings, the API v1 answer for an ambiguous key.

**Acceptance Scenarios**:

1. **Given** a person without Linear, **Then** every bare key goes where it goes today, with no extra request (SC-004).
2. **Given** a prefix one connected tracker knows, **Then** the key goes there with no dialog.
3. **Given** a prefix two trackers know and no remembered choice, **Then** the dialog shows both marks; a choice adds the card; "Remember" stores it per person and prefix.
4. **Given** a remembered choice, **Then** the dialog is skipped; Settings lists the choice and can change or remove it.
5. **Given** the public API or MCP and an ambiguous bare key, **Then** the remembered choice is used, or the answer asks the caller to write `jira:` or `linear:` before the key.

### User Story 3 - Many Linear issues by a query (Priority: P2)

A person types `team = ENG AND cycle in openSprints() AND labels = bug` in the card tool. Suggestions offer fields, operators and the team, cycle and label names of their workspace as they type. Enter: 23 cards land in a batch. They paste the link of a saved Linear view instead: its issues land the same way.

**Why this priority**: a team fills a board from a cycle or a project, not one key at a time; it builds on slices 1 and 2.

**Independent Test**: against the fake Linear: each field and operator of the subset turns into the expected Linear filter; suggestions for fields and values; a view link; more than 50 matches; a query with a mistake answers where the mistake is.

**Acceptance Scenarios**:

1. **Given** a connected person, **When** they type a query with Linear fields, **Then** suggestions offer fields, operators and values of their workspace.
2. **Given** a valid query, **Then** up to 50 issues are added in a batch and the tool says when more match.
3. **Given** `text ~ "word"`, **Then** issues with the word in the title or the description match.
4. **Given** a link to a saved Linear view, **Then** its issues are added the same way.
5. **Given** a query tiko cannot read, **Then** the tool says which part it could not read and what it expected.

### Edge Cases

- A workspace renames its slug: Linear keeps the old one in `previousUrlKeys`; cards with the old slug stay live for the person whose workspace it is.
- A link with a slug of another workspace: not found, with "This issue is in another Linear workspace", and no request.
- A board of 300 Linear cards: three requests of 100 in one refresh.
- A status timer on a Linear task works on the state names of the person's workspace.
- A Jira that cannot be reached while a prefix is checked may still know it: when Linear knows the prefix, the dialog asks, and the check is not remembered.
- A board from this version opened by an older tiko: "Unknown tracker" with the key, as spec 013 already does.

## Requirements *(mandatory)*

- **FR-001** (slice 0): One source description per tracker holds its id, name, key and link rules, how a guest's link is built from a key, its credential kind and where a person creates a token. Key validation, ref routing, the key-change guard of a running poll, usage names, guest links, the preview and the API v1 element list read it. A test fails on a tracker name written elsewhere in `api/` or `domain/`.
- **FR-002** (slice 0): Personal readers kept per person, and the stand-in for a tracker a person has not connected, are one shared piece used by GitHub, CalDAV and Linear. The per-source token methods of Settings become one set keyed by source.
- **FR-003** (slice 0): No user-visible change except the fixed guest link of CalDAV cards.
- **FR-004**: A `linear` source implements the task port (`resolve`, `poll`, `check`) against the Linear GraphQL API with a personal API key, on its own HTTP client that follows no redirects. The key is masked in logs.
- **FR-005**: A person can save and remove a Linear API key; saving checks it with Linear. It is stored encrypted under the kind `linear`, bound to `https://api.linear.app`.
- **FR-006**: A poll asks Linear for up to 100 issues by identifier in one request, archived ones included, with at most 10 labels each; it reads both limit headers and stops before a tenth of either is left.
- **FR-007**: A rejected key at poll time keeps the cards' last data and says so in the sync list; at save time it is refused.
- **FR-008**: A guest reads no Linear task; every Linear ref on a public board is `private`, with a link built from its key.
- **FR-009**: The web registry gets `linear` with its mark; `THIRD_PARTY.md` and `TRADEMARKS.md` list the mark and its terms.
- **FR-010**: Usage stats count `linear`; the collector accepts the value before the release that sends it.
- **FR-011**: Works without keys: tests and the smoke run against a fake Linear; with the network down the source reports an error while the rest of the board works.
- **FR-012**: No new dependency; no new ENV variable.
- **FR-013** (slice 2): The task port gains "do you know this key prefix?". Jira answers with one project lookup per prefix with the person's token, kept for an hour (a miss for 10 minutes); Linear answers from the person's team keys, read with all pages and kept for an hour.
- **FR-014** (slice 2): Remembered prefix choices are stored per workspace, person and prefix, listed, changed and removed in Settings, and closed to demo visitors.
- **FR-015** (slice 3): A JQL subset for Linear — fields `team`, `project`, `cycle`, `status`, `statusCategory`, `assignee`, `reporter`, `labels`, `priority`, `created`, `updated`, `due`, `text`, `title`, `key`, `parent`; operators `=`, `!=`, `IN`, `NOT IN`, `~`, `IS EMPTY`, `IS NOT EMPTY`, `>`, `>=`, `<`, `<=`, `AND`, `OR`, parentheses; functions `currentUser()`, `openSprints()`, `nextSprint()`; relative dates like `-2w` — is turned into Linear's filter by a parser in the domain, with no dependency.
- **FR-016**: API and MCP: refs take Linear links and `linear:` keys; an ambiguous bare key follows decision 4.
- **FR-017**: The guide gets a Linear page (which key to create, what it can read, one workspace, the query fields), the trackers table marks Linear available, `CHANGELOG.md` a line per slice, `docs/brief.md` and the README name Linear as supported.

## Success Criteria *(mandatory)*

- **SC-001**: From an empty instance, a person with a Linear workspace gets their first live card in under 2 minutes, counting the key creation by the guide's link.
- **SC-002**: A change in Linear reaches the card within one refresh interval.
- **SC-003**: A person with 3 open boards of 100 Linear cards each, refreshed all day, never gets a "limit used up" answer from Linear.
- **SC-004**: A board with Jira, GitHub, CalDAV and demo tasks only renders and refreshes exactly as in the previous release; a bare Jira key of a person without Linear goes to Jira as before, with no extra request.
- **SC-005**: Through a shared board or a public link, a Linear task's title never reaches a person without their own key or a guest (the byte test of spec 012 on a board with a Linear task); the key never reaches the browser, the log or a host other than `api.linear.app`.
- **SC-006**: After slice 0, adding Linear touches no file that branches on a tracker name, apart from the source descriptions and the wiring list.

## Slices

0. `refactor/sources` (US0): source descriptions, shared personal readers and stand-in, token methods by source, the matrix and guard tests. No visible change.
1. `feat/linear` (US1): the key in My tracker, cards by link, statuses, rows, due dates, refresh with its limits, teammate and guest, mark, guide.
2. `feat/linear-keys` (US2): bare keys by prefix, the dialog, remembered choices and their Settings list, API v1 and MCP.
3. `feat/linear-query` (US3): the JQL subset with suggestions, saved view links.

Slices 1 and 2 ship in one release.

## Out of scope

- OAuth sign-in with Linear. A self-hosted instance cannot share one registered app with a fixed callback, as for Jira Cloud; it can fill the same per-person credential later.
- Several Linear workspaces per person.
- Webhooks; writing to Linear (changing a state from the board).
- Projects, cycles and initiatives as cards of their own, and project dates on the Gantt.
- `NOT (…)`, `ORDER BY`, history operators (`was`, `changed`) in the Linear query.
- A board element that follows a whole view and adds new issues by itself: a feature of its own, for every tracker.
- A plugin system for trackers: slice 0 removes today's duplication, nothing more.
- Comments, attachments, reactions, SLA, customer requests.

## API and MCP

Linear tasks are read through the existing card and task routes of API v1 and the MCP server; refs take `linear:` keys and Linear links (FR-016). The query of slice 3 is available to v1 search with `source: "linear"`.
