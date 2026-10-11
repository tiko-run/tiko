# Feature Specification: GitHub Issues

**Feature Branch**: `015-github-issues`

**Created**: 2026-10-11

**Status**: Approved at G2 on 2026-10-11.

**Input**: Owner's decision at G1 on 2026-10-11: "the ground is ready, now add GitHub as a tracker so issues can be pulled from it." Step 4 of the launch plan (a tracker the launch audience actually uses) and roadmap issue #90. Builds on [spec 013](../013-task-sources/spec.md): a task knows its source, a board mixes sources, a new source is an adapter.

## Why

tiko reads Jira Data Center only, and the people who will see the launch sit on GitHub. A GitHub source lets anyone try tiko on real tasks in a minute, with no key and no admin: paste a link to a public issue and it is a live card. It also makes the project's own roadmap a public tiko board fed by the issues of `tiko-run/tiko`.

## Terms

- **GitHub task**: an issue or a pull request of a repository on github.com.
- **Key**: `owner/repo#number`, like `tiko-run/tiko#90`. The ref is `github:tiko-run/tiko#90`.
- **Server token**: an optional read-only GitHub token in the environment that raises the request limit of the instance. It reads public repositories only.
- **Personal token**: a person's own GitHub token, entered in Settings → My tracker, for private repositories.

## Decisions

1. **GitHub is always available, like the demo source.** It needs no setup: public repositories are read without a key. Settings → Task source keeps choosing the tracker a typed Jira key goes to. No request leaves the instance until someone adds a GitHub task.
2. **github.com only.** GitHub Enterprise Server is a later source.
3. **Issues and pull requests are both tasks.** The type is "Issue" or "Pull request", with its own icon; the card stays the one card of spec 013.
4. **The card shows the short key** `repo#number`; the mini-card and the link carry the full one.
5. **Status** comes from the state:

   | GitHub | Status name | Category |
   |---|---|---|
   | open issue | Open | new |
   | open pull request | Open | indeterminate |
   | draft pull request | Draft | indeterminate |
   | merged pull request | Merged | done |
   | closed pull request | Closed | done |
   | issue closed as completed | Closed | done |
   | issue closed as not planned | Not planned | done |
   | issue closed as duplicate | Duplicate | done |

6. **An open issue takes its status from a label** when it has one of the well-known names, compared without case: `planned`, `todo`, `to do`, `backlog` (new); `in progress`, `in-progress`, `wip`, `doing`, `in review` (indeterminate); `shipped`, `done`, `released` (done). The status name is the label's name. A closed issue ignores labels. The list is built in; a list per board or per instance is not part of this spec.
7. **Labels show as chips in the mini-card**, in their own colors, never on the card: a board of colored labels would shout. The mini-card also gains extra rows (label and value); GitHub fills one, "Author" (asked for by the owner on 2026-10-11, who also dropped a "Repository" row: the full key in the mini-card already names the repository). These are the two shared places of spec 013, decision 3.
8. **A task is added by its link or its key.** A github.com issue or pull request link, or `owner/repo#number`, typed into the card tool, the Gantt add form or pasted on the board, becomes a GitHub card on any instance. Anything else goes to the instance's tracker, as today.
9. **The board's refresh pace stays one for every tracker; the GitHub source paces itself inside it.** A board asks every 30 seconds as before, and the source answers from memory until a repository is due. How often a repository is due follows from the request budget GitHub reports: 60 an hour per address without a token, 5000 with one. The budget is spread over the repositories in turn, the longest-waiting first, so a busy instance gets older data, never a burst of requests and a used-up limit. Without a token that means every few minutes and the sync list says so; once a token is there the same rule gives the board's pace back with nothing to switch.
10. **What is read without a personal token is public**, so a guest of a public board sees it in full. A task that only a personal token can read shows a guest its key only, as a Jira task does.
11. **The server token never opens a private repository.** If the token in the environment can read one, tiko still answers "not found" for it.
12. **The mark is the official GitHub mark**, unchanged: black on the light theme, white on the dark one.
13. **Read only.** tiko never writes to GitHub.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A public issue is a live card (Priority: P1) 🎯

A person on a fresh instance with no tracker connected copies a link to an issue of a public repository and pastes it on the board. A card appears: the issue icon, `tiko#90`, the title, "Planned". They paste a pull request link: another icon, "Open". The issue is closed on GitHub; a few minutes later the card is struck through and reads "Closed". The sync list has a "GitHub" row with the mark. A guest of the board's public link sees the same cards in full.

**Why this priority**: this is the whole value of the source and the roadmap board; the rest refines it.

**Independent Test**: on a compose stack with a mock GitHub and no token, paste an issue link and a pull request link: two cards with their types, titles and statuses. Change the issue in the mock: the card follows after the next poll. Open the public link in a clean browser: both cards in full.

**Acceptance Scenarios**:

1. **Given** any instance, **When** a github.com issue or pull request link, or `owner/repo#number`, is entered in the card tool or pasted on the board, **Then** a card with the source `github` appears.
2. **Given** a GitHub card, **Then** it shows the type icon, the short key, the title and the status of decisions 5 and 6.
3. **Given** an open issue labelled `in progress`, **Then** its status reads "in progress" in the color of work in progress; once closed it reads "Closed".
4. **Given** a board with GitHub tasks, **When** it refreshes, **Then** the sync list has a "GitHub" row, and without a token the row says the tasks update every few minutes.
5. **Given** GitHub answers that the limit is used up, **Then** the row turns red with the time of the next try, the cards keep their last data and the other sources refresh as usual.
6. **Given** a link to a repository or an issue that does not exist or is private, **Then** the tool says the task was not found.
7. **Given** a board that mixes GitHub with another source, **Then** GitHub cards carry the GitHub mark, black on light and white on dark.
8. **Given** a guest on a public board, **Then** GitHub tasks of public repositories show in full.
9. **Given** `GITHUB_TOKEN` in the environment, **Then** GitHub tasks refresh at the board's pace, and a private repository this token can read still answers "not found".
10. **Given** an instance with no Jira, **Then** the card tool, the context menu, the shortcuts list and the command palette say "Task card", not "Jira card".

### User Story 2 - Labels and the author in the mini-card (Priority: P2)

A person opens a GitHub card. The mini-card shows the assignee, the updated time, the author and the issue's labels as small chips in their GitHub colors. The button reads "Open in GitHub". A Jira card's mini-card is unchanged.

**Why this priority**: labels are how GitHub projects sort their work; the card stays quiet without them, the mini-card is where they belong.

**Independent Test**: screenshots of the mini-card of a labelled issue and of a Jira task in both themes; the Jira one matches the previous release.

**Acceptance Scenarios**:

1. **Given** a GitHub task with labels, **Then** the mini-card lists them as chips with the label's name and color, readable in both themes.
2. **Given** a GitHub task, **Then** the mini-card has an "Author" row with who opened it and no "Priority" row.
3. **Given** a task with several assignees, **Then** the mini-card shows the first one.
4. **Given** a task of another source, **Then** its mini-card has no chips and no extra rows.

### User Story 3 - Private repositories with a personal token (Priority: P3)

A person enters their GitHub token in Settings → My tracker, next to their Jira token. They paste a link to an issue of a private repository: a live card. Their GitHub tasks now refresh at the board's pace on their own limit. A teammate without a token sees that card as a key with "Connect your GitHub token to see this task". A guest of the public link sees the key only.

**Why this priority**: teams keep their work in private repositories; without this GitHub is a demo source.

**Independent Test**: with a mock GitHub that serves a private repository to one token only: the token's owner sees the task, a second person sees the key and the hint, a guest sees the key.

**Acceptance Scenarios**:

1. **Given** Settings → My tracker, **Then** a person can save, test and remove a GitHub token; it is stored encrypted and is sent to api.github.com only.
2. **Given** a person with a token, **Then** all their GitHub requests use it, and a task of a private repository it can read shows in full.
3. **Given** a person without a token on a board with a private task, **Then** the card shows the key and "Connect your GitHub token to see this task".
4. **Given** a guest, **Then** a GitHub task that cannot be read without a personal token shows the key only.
5. **Given** a token that GitHub rejects, **Then** the sync list says so and public tasks keep working without it.

### Edge Cases

- An issue is transferred to another repository: the old key answers "not found"; tiko does not follow the move.
- A repository is renamed: GitHub redirects, the card keeps its old key and stays live.
- A link to a comment (`#issuecomment-…`) or to a pull request's files tab resolves to its issue or pull request.
- `owner/repo#5` is an issue on one board and nothing tells a pull request apart in the key: GitHub numbers them in one sequence, so the key is unique.
- A Jira key and a GitHub key cannot be confused: only the GitHub one holds `/` and `#`.
- A repository is made private after its public issue was added: the card turns to "not found" for people without a token.
- A board from this version opened by an older tiko: "Unknown tracker" with the key, as spec 013 already does.
- A status timer on a GitHub task works on the statuses of decisions 5 and 6.
- On a demo instance visitors may add any public GitHub task. Requests are counted per repository, not per task or person, so a thousand people watching the same repositories cost what one does; many repositories make each of them refresh less often. A high cap on tracked repositories keeps one script from starving everyone.

## Requirements *(mandatory)*

- **FR-001**: A `github` source implements the task port (`resolve`, `poll`, `check`) against the GitHub REST API; `search` and the JQL routes answer that GitHub has no query yet.
- **FR-002**: The source is present in every request's set of providers, on every instance.
- **FR-003**: `resolve` sends a GitHub link or key to the GitHub source and everything else to the instance's tracker. The request body is unchanged.
- **FR-004**: A card, a Gantt task row and a timer watch accept a GitHub key when their source is `github`; a Jira key is still required for the other sources.
- **FR-005**: Reads without a personal token go through one shared reader for the instance: one request per repository per poll, paced to stay inside the limit GitHub reports, with its answers shared by everyone.
- **FR-006**: `GITHUB_TOKEN` in the environment is used by the shared reader. A repository GitHub marks private is never served through it.
- **FR-007**: A limit, an outage and an unreachable network map to tracker errors that the refresh backoff understands for any source. The error codes of Jira do not change.
- **FR-008**: `Task` gains `labels` (name and color) and `rows` (label and value), both empty for the other sources. The contract change is written in `specs/015-github-issues/contracts/` before the code.
- **FR-009**: The web registry of sources gains `github` with a mark per theme. `THIRD_PARTY.md` and `TRADEMARKS.md` list the mark and its terms.
- **FR-010**: A personal GitHub token is stored per person like the Jira token, encrypted, and is only ever sent to api.github.com.
- **FR-011**: A guest route reads GitHub tasks through the shared reader only. What it cannot read is answered as `private`.
- **FR-012**: Works without keys: the tests and the smoke run against a mock GitHub, and with the network down the source reports an error while the rest of the board works.
- **FR-013**: New ENV variable `GITHUB_TOKEN` in `.env.example`, the README and the guide. No new dependency.
- **FR-014**: The guide gets a GitHub page, `CHANGELOG.md` a line per slice, `docs/brief.md` names GitHub Issues as a supported tracker.

## Success Criteria *(mandatory)*

- **SC-001**: On a fresh instance with no token and no setup, a pasted link to a public issue is a card with its title and status within 3 seconds.
- **SC-002**: A change on GitHub reaches the card within 1 minute with a token and within 7 minutes without one, for up to 5 repositories.
- **SC-003**: An instance without a token never gets a "limit used up" answer from GitHub in an hour of 3 open boards over 5 repositories.
- **SC-004**: A board with Jira and demo tasks only renders and refreshes exactly as in the previous release.
- **SC-005**: A private task's title never reaches a person without a token or a guest (the byte test of spec 012 on a board with a private GitHub task).
- **SC-006**: A roadmap board of the issues of `tiko-run/tiko` shows "planned", "in progress" and "shipped" from their labels on a public link.

## Slices

1. `feat/github-issues` (US1): the source, adding by link and key, statuses with labels, the mark, the pace without a token, the server token, tracker-neutral names for the card tool.
2. `feat/github-labels` (US2): chips and extra rows in the mini-card.
3. `feat/github-token` (US3): the personal token and private repositories.

## Open points for slice `feat/github-token` (2026-10-11)

Raised by the owner before the slice; each is answered in the slice, in code or in the guide.

1. **A person with a token leaves the shared queue.** All their GitHub reads, public and private, go through their own provider, on their own limit and into their own cache. The shared budget is not spent on them.
2. **The personal provider has no pacing rule yet.** The turn-by-turn budget of decision 9 is written for the shared reader only. The limit belongs to the person's GitHub account, and their other tools spend it too, so the personal provider must obey `x-ratelimit-remaining` and `x-ratelimit-reset` and slow down before it runs dry. Decide whether it reuses the shared reader's rule.
3. **GitHub counts the limit per user, not per token.** A classic token, a fine-grained token and a token from a later sign-in share one 5000 an hour. Two tokens of one person do not add up; the guide says so.
4. **Access follows the token, not membership.** A fine-grained token reads only the repositories picked for it. A member of an organization whose token leaves a repository out sees the key and the hint, like a person with no token. The hint and the guide must not promise that a token alone is enough.
5. **Sharing private tasks with a team.** Everyone adds their own token with access to that repository; one token is never handed to the whole board. The guide gets a section for a person who asks how their team sees private issues and pull requests (T023).
6. **Which token the guide recommends.** Fine-grained, on picked repositories, with "Issues: Read-only" and "Pull requests: Read-only" ("Metadata: Read-only" comes with them). A classic token needs the `repo` scope, which is full write access to every private repository: the guide names it as a fallback with that warning.
7. **The server token stays.** `GITHUB_TOKEN` keeps serving people without a token, demo visitors and guests of a public link, with or without personal tokens around.
8. **The shared reader lives in the memory of the one API process**, as live boards do. It needs no store while there is one process. Several API processes would each keep their own queue and spend the same limit several times over: a shared store for the reader's state belongs to the work that adds a second process, not to this slice.

## Out of scope

- Adding many tasks by a GitHub search query, and query suggestions.
- GitHub Projects fields (a status column of a project), milestones, linked pull requests of an issue, comment counts, reactions, every assignee beyond the first.
- GitHub Enterprise Server.
- Sign-in with GitHub. It will hand tiko a person's token with no pasting; the personal token of slice 3 is stored per person whatever way it came, so sign-in later fills the same place. Whether that is an OAuth app or a GitHub App is decided with that spec. Known ahead of it: an OAuth app reads private repositories only with the `repo` scope (full write access), a GitHub App can ask for read-only issues and pull requests; a token from sign-in shares the person's 5000 an hour with their other tokens, and a person who signed in needs no token of their own.
- Renaming the stored node type `jira_card`: its own slice right after this spec, with a database backup and a migration of stored boards.
- Webhooks; writing to GitHub.
- A label-to-status list per board or per instance.
- A list of tracker connections in Settings and a source filter in search: they wait for the second tracker that needs setup (Jira Cloud).
- Following a transferred issue.

## Answers from the owner (2026-10-11)

1. Statuses from labels are a built-in list for now.
2. GitHub is always on, with no switch for an admin.
3. The slice order stands: public tasks, labels, then the personal token for private repositories.
4. "Jira card" becomes "Task card" in the texts in slice 1. The stored node type `jira_card` is renamed in its own slice after this spec, with a backup first.
5. Demo visitors may add any public GitHub task. The owner asked for requests to be spread in turn inside the limit instead of sent at once: decision 9.
6. A token is the answer to the limit. Sign-in with GitHub is to be kept in mind so that a person does not paste a token twice: see Out of scope.
