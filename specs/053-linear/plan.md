# Implementation Plan: Linear

**Spec**: [spec.md](spec.md) | **Contract**: [contracts/api.md](contracts/api.md)

Architecture reviewed by the `architect` subagent (Fable, high) on 2026-11-21; its findings are folded in below.

## Summary

Slice 0 moves what every tracker repeats into one place: a source description per tracker in `domain/sources.py`, one kept-per-person reader holder and one "not connected" stand-in in the adapters, token methods keyed by source in Settings. Slice 1 adds `adapters/tasks/linear.py` and its description. Slice 2 adds "do you know this prefix?" to the task port, a table of remembered choices and the dialog. Slice 3 adds a small JQL-subset parser that turns a query into Linear's filter.

## Facts checked against Linear (docs and live answers, 2026-11-21)

- Endpoint `https://api.linear.app/graphql`, header `Authorization: <API_KEY>` with no `Bearer`.
- An API key: 2,500 requests and 3,000,000 complexity points an hour, per user, shared by all of that user's keys. Every answer carries `x-ratelimit-requests-limit|remaining|reset` and `x-ratelimit-complexity-limit|remaining|reset` (resets in epoch ms) and `x-complexity`. Over the limit: HTTP 429 with `RATELIMITED`. A single query may cost at most 10,000 points.
- A missing issue is HTTP 200 with `errors[0].extensions.code = "INPUT_ERROR"`, "Entity not found: Issue". A bad key is HTTP 401 with `AUTHENTICATION_ERROR`. A partial answer is HTTP 200 with both `data` and `errors`.
- `issue(id:)` and `issues(filter: {id: {in: [...]}})` both take identifiers like `TIK-1`: checked live, the `in` filter returned exactly the asked issues. A filter of `or: [{team: {key}, number: {in}}]` returned wrong issues on the live API and is not used.
- `issues` hides archived issues unless `includeArchived: true`.
- `organization { urlKey previousUrlKeys }` exists; `url` is `https://linear.app/<urlKey>/issue/<ID>/<slug>`.
- `priority` is 0–4 with `priorityLabel`; state `type` is one of triage, backlog, unstarted, started, completed, canceled, duplicate.
- `CustomView` has `slugId`, `filterData` and `issues`.
- Linear has no typed query language in the app, the API, its CLI or its MCP server, and no community library turns text into its filter (research, 2026-11-21).
- Checked live on a test workspace (2026-11-21): a deleted issue stays in Linear's trash and is still answered, with `trashed: true`, by `issue(id:)` and by the list; an archived one comes back with `includeArchived`; an issue moved to another team is found by its old identifier; a state change reaches the next poll. Linear's API does not create cycles ("Cycle creation is not supported"), so the Cycle row is covered by the fake only.

## Structure

```text
backend/app/domain/sources.py           slice 0: Source(id, name, valid, own_ref, guest_link, credential, token_url, usage), SOURCES
backend/app/domain/tasks.py             slice 0: route_ref() used by resolve_task and API v1; slice 2: prefix routing
backend/app/domain/settings.py          slice 0: source_token / set_source_token / remove_source_token / source_token_state; token_stamps from SOURCES
backend/app/domain/public.py            slice 0: guest link from the source description (fixes CalDAV)
backend/app/domain/usage.py, preview.py slice 0: read SOURCES
backend/app/domain/linear_query.py      slice 3: JQL subset → Linear IssueFilter
backend/app/domain/ports.py             slice 2: TaskProvider.has_prefix; PrefixChoices repo port
backend/app/adapters/tasks/readers.py   slice 0: PersonalReaders (digest, idle drop, lock), NotConnected stand-in
backend/app/adapters/tasks/linear.py    slice 1: LinearApi, LinearProvider; slice 3: vocabulary, values, search
backend/app/adapters/storage/           slice 2: key_prefix_choices table, migration 015
backend/app/api/deps.py, main.py        slice 0: providers() loops over personal and open sources
backend/app/api/me.py                   slice 0: tokens map, checks by source; slice 2: /api/me/key-prefixes
backend/app/api/v1/*, api/mcp.py        slice 0: read SOURCES; slice 2: ambiguous keys
frontend/src/sources/registry.ts        slice 0: shortKey, keyPattern, linkPattern, credential texts per source
frontend/src/canvas/refs.ts             slice 0: patterns from the registry
frontend/src/settings/sections/         slice 0: SourceTokenForm replaces GitHubTokenForm; slice 2: Key prefixes list
frontend/src/canvas/                    slice 2: the prefix dialog in resolveAll
backend/tests/test_sources_matrix.py    slice 0: the pinning matrix, written first on today's code
```

## Decisions

- **Refactor first, the minimum.** Linear would be the third copy of the personal readers, the stand-in and the token methods. A source description removes the duplication of five trackers; a plugin system for trackers that do not exist is rejected. Stays special: Jira (instance URL, DC or Cloud, e-mail, JQL, TLS), CalDAV (discovery, address rules, lists, its picker), GitHub (shared reader, server token, fallback on a rejected token), demo (status scoping).
- **Pin, then move.** The first commit of slice 0 adds a matrix test on today's code: refs through `/api/tasks/resolve` and API v1 elements, `valid_key`, guest links, token stamps, usage names, the preview, the `/api/me/tracker` body. The refactor leaves it unchanged except two deliberate diffs in their own commits: the `tokens` map and the CalDAV guest link.
- **Workspace in the key** (spec decision 3). Rejected: the bare identifier (a silent wrong issue across workspaces); a workspace field on the card (touches cards, rows and watches).
- **Stateless poll.** `issues(first: 100, includeArchived: true, filter: {id: {in: [identifiers]}})` with `labels(first: 10)`; nothing to remember between polls, so a restart or a second API process costs nothing extra. An identifier missing from the answer is asked once with `issue(id:)`, at most 5 a poll, a miss remembered for 10 minutes; that also covers an issue moved to another team if the `in` filter does not match old identifiers.
- **Pace.** Ask Linear no more often than the board interval; read both limit headers after every answer; below a tenth of either raise `TrackerRateLimited` with the reset time and serve the cache. Let one probe through after the wait, since `RefreshService` caps a wait at 300 s.
- **Errors.** 401 or `AUTHENTICATION_ERROR` at save: 422 `validation_failed`, as GitHub and CalDAV. At poll: `LinearRejected(TrackerUnavailable)`, so cards keep their data and the sync list says the key was rejected. 429 or `RATELIMITED`: `TrackerRateLimited`. 5xx and network: `TrackerUnavailable` / `TrackerUnreachable`. `INPUT_ERROR` "Entity not found": `not_found`.
- **The key-change guard.** `linear` joins the token stamps (from `SOURCES` after slice 0), so a key swapped during a poll does not refill the cache with the old key's tasks.
- **Saving is the test.** No separate Test button, as for GitHub. The workspace slug is compared with the answer's `url`, not kept apart.
- **Prefix routing** (slice 2). Collect the sources whose `has_prefix` says yes: none goes to the instance's tracker, one wins, two or more use the remembered choice or answer `409 ambiguous_key`. A choice only breaks a tie, so a stale one is harmless. Jira: `GET /rest/api/2/project/{KEY}` with the person's token, on DC and Cloud; 200 yes, 404 no; a failure is "unknown" and not cached, and an unknown Jira next to a Linear team that knows the prefix asks with the dialog instead of routing on its own. Rejected: the full project list (megabytes on a big DC); asking Jira per issue. A person without Linear never reaches the check (SC-004).
- **Choices in a table**, `key_prefix_choices (workspace_id, user_id, prefix, source)`, not in the encrypted credential: an edit there would change the token stamp and drop a running poll.
- **The dialog lives in `resolveAll`**, which the card tool, the Gantt add form and paste share. It asks once per prefix and re-sends with `source`. In the Gantt popover it keeps the popover open while choosing, as `keepOpenWhileSuggesting` does.
- **Query** (slice 3). A recursive-descent parser in `domain/linear_query.py`, about 300 lines, no dependency. Operators map one to one (`=` eqIgnoreCase, `IN` in, `~` containsIgnoreCase, `IS EMPTY` null, comparisons, nested `and`/`or`); `text ~` is `or` of title and description; `labels != x` uses `every` with Linear's note that it also matches unlabeled issues, said in the guide; `NOT (…)` is refused with a message. Linear connections carry no total, so the answer counts the matches only when they fit on one page, else leaves `total` empty, and takes `more` from the connection's `pageInfo.hasNextPage`; API v1 keeps `total` a number (its contract only grows) and adds `more`. A view link reads `customView(id: slugId).issues`.
- **The mark**: Linear's logo mark from `linear.app/brand`, terms checked in T001.
- **The collector** (`collector/`) accepts `linear` in `trackers` before the release that sends it.

## Slices

| Branch | Story | Done when |
|---|---|---|
| `refactor/sources` | US0 | the matrix test passes before and after; the guard test is green; the CalDAV guest link is fixed; `make check`, `make smoke` green; no visible change on the dev stack |
| `feat/linear` | US1 | with a fake Linear: key saved, cards by link, statuses and rows, archived and missing issues, limits, teammate and guest; on the dev stack with a test workspace the same by hand in both themes |
| `feat/linear-keys` | US2 | the four routing cases, the dialog, remembered choices and Settings, API v1 and MCP, against a fake Linear and a fake Jira; on the dev stack a bare key from the test workspace |
| `feat/linear-query` | US3 | every field and operator of the subset maps to the expected filter; suggestions; a view link; on the dev stack a cycle query adds its issues |

## Risks

| Risk | Answer |
|---|---|
| The refactor changes behaviour | the matrix test written on today's code first; two deliberate diffs only, each in its own commit |
| The `id: {in}` filter misses a moved issue | a single `issue(id:)` for what is missing, capped per poll |
| A bare key goes to the wrong tracker | only for a person with Linear, only on a prefix a tracker confirms; two claims ask |
| The user's 2,500 an hour is spent by their other tools | a tenth kept in reserve, the cache served, the sync list says so |
| Jira down during a prefix check | the dialog asks, as for a prefix both trackers know; not cached |
| The query parser misreads a query | one test per field and operator; a mistake answers where and what was expected |
| The key leaks | own HTTP client without redirects, key masked in logs, the token leak test covers `linear` |
| The collector rejects `linear` | accept it there before the release |
| Linear objects to the mark | the official file unchanged, listed in `TRADEMARKS.md`; one registry entry to remove |
