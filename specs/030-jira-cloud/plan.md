# Implementation Plan: Jira Cloud

**Spec**: [spec.md](spec.md) | **Contract**: [contracts/api.md](contracts/api.md)

## Summary

A second adapter, `adapters/tasks/jira_cloud.py`, reads Jira Cloud with Basic auth of e-mail and API token. It subclasses the Data Center adapter and keeps its mapping of an issue to `Task`, its error mapping and its JQL vocabulary parsing; it overrides the auth header, the poll and the search. Settings keep the kind of the instance's Jira next to its URL; `main.py` picks the adapter by the kind. A person's Jira credential gains an optional e-mail. The web app shows the e-mail field when the kind is Cloud. Slice 2 adds the search with its count and the JQL suggestions.

## Facts checked against the Jira Cloud REST docs (2026-10-18)

From the v2 and v3 OpenAPI specs of 2026-10, Atlassian's docs and live calls without a token to a public Cloud site.

- Basic auth with e-mail and API token works on `https://<site>.atlassian.net`. Tokens expire after 1 to 365 days (a year by default). Scoped tokens are recommended but need `https://api.atlassian.com/ex/jira/{cloudId}`; whether they work with Basic auth is not confirmed. Unscoped tokens are still offered.
- Atlassian's Basic auth page advises OAuth 2.0 (3LO) instead of collected API tokens for apps that act for many users. See "Risks".
- `GET/POST /rest/api/{2,3}/search` are being removed (CHANGE-2046); the GET answered 410 live. The replacement is `GET/POST /rest/api/{2,3}/search/jql`: `jql`, `fields` (default `id` only), `maxResults` up to 5000, `nextPageToken`; the answer has `issues`, `isLast`, `nextPageToken` and no `total`. There is no `validateQuery`.
- Live, `search/jql` answered 200 for unknown keys (dropping them) and even for an unknown field (empty list), where Data Center answers 400. A rejected query must be found with `POST /rest/api/3/jql/parse?validation=strict`.
- `POST /rest/api/{2,3}/search/approximate-count` with `{jql}` returns `{count}`, an estimate.
- `POST /rest/api/3/issue/bulkfetch` takes `issueIdsOrKeys` and `fields`: up to 1000 keys per call when the fields are listed without wildcards, 100 otherwise. Missing or hidden issues are left out silently.
- `GET /rest/api/2/issue/{key}` stays; v2 returns the same field shapes as Data Center. `statusCategory.key`, `issuetype.name`, `priority.name`, `assignee.displayName`, `updated` match.
- `/rest/api/2/jql/autocompletedata` and `.../suggestions` exist on Cloud and are not deprecated.
- `GET /rest/api/2/myself` has `accountId` and `displayName`; `name` is gone, `emailAddress` may be hidden.
- A wrong token answers 401; a missing or hidden issue 404. API-token traffic is outside the points quotas of 2026-03 and has burst limits (100 requests a second); 429 comes with `Retry-After`.
- Jira Cloud Free: up to 10 users, no time limit, anyone can make a site.

Checked in T001 on a live Cloud site with an API token (2026-10-18):

- `GET /rest/api/2/serverInfo` answers `deploymentType: "Cloud"` with and without auth.
- `bulkfetch` (v2 and v3) with a known, a missing and an unknown-project key: 200, the known issue under its own key, `issueErrors` empty.
- `GET /rest/api/2/issue/{key}`: the same field shapes as Data Center; a missing key 404; a wrong token on `/myself` 401.
- `search/jql` with unknown keys in `key in (...)`: 200 with the known ones. A syntax error: 400 with `errorMessages`, in the language of the person's Jira.
- `jql/parse?validation=strict`: 200 with `errors` per query; it also names an unknown field, which `search/jql` does not.
- `approximate-count`: 200 with an integer `count`. `jql/autocompletedata` and `.../suggestions` answer as on Data Center. The old `/search`: 410.

## Structure

```text
backend/app/adapters/tasks/jira_dc.py     two hooks for a subclass: the auth header and the read of one poll chunk
backend/app/adapters/tasks/jira_cloud.py  JiraCloudProvider(JiraDcProvider): Basic auth, bulkfetch poll; slice 2: search/jql with jql/parse and approximate-count
backend/app/adapters/tasks/jira_kind.py   kind(base_url) -> "dc" | "cloud" from serverInfo
backend/app/domain/settings.py            jira_kind next to jira_base_url; JiraCredentials.email; the credential stores e-mail and token
backend/app/api/settings.py, api/me.py    e-mail in test and save; kind in the views
backend/app/main.py                       the adapter by kind; the kind of an ENV URL found at start
backend/app/domain/usage.py, collector/   jira_cloud as a tracker value
backend/tests/jira_cloud_fake.py          a fake Jira Cloud on httpx.MockTransport, made-up projects and people
frontend/src/api/settings.ts              kind and email in the schemas
frontend/src/settings/sections/           MyTracker: the e-mail field and the token link for Cloud; TaskSource: the kind next to the URL
docs/guide/.../jira-cloud.md              Connect Jira Cloud
```

## Decisions

- **The kind is found, not chosen.** `GET {url}/rest/api/2/serverInfo` without auth; `deploymentType == "Cloud"` is Cloud, anything else Data Center; an answer without it (a login page) falls back to the host, `*.atlassian.net` being Cloud. It runs the first time the kind is needed for a URL (saving, testing, the first request after start with `JIRA_BASE_URL`) and is stored as `jira_kind` with the URL it is for. When the site cannot be reached, the host decides for a minute and the site is asked again. An admin sees the kind next to the URL ("Jira Cloud", "Jira Data Center").
- **One credential record, two halves.** The `jira` credential stores `{"email": ..., "token": ...}` encrypted as one secret; a record of the old shape (a bare token) reads as a token without an e-mail, so Data Center records need no migration. The e-mail is required to save a credential only when the kind is Cloud.
- **Poll by bulkfetch.** `POST /rest/api/2/issue/bulkfetch` with the six fields listed, in chunks of 1000 keys; keys missing from the answer are `not_found`, as on Data Center. One request covers a 300-card board (SC-003). v2 keeps the answer shapes of Data Center, so `to_task` is shared.
- **A moved key** behaves as on Data Center: the poll gets the issue under its new key, so the old key reads "not found" until the card is added again.
- **Search in slice 2.** `POST /rest/api/3/jql/parse?validation=strict` first: errors become `InvalidJql` with Jira's message. Then `POST /rest/api/2/search/jql` for one page of `MAX_SEARCH` (100), with the fields, or only `id` for a count-only call; when it is the last page, its length is the exact count. Only past it, `POST /rest/api/2/search/approximate-count`, and the answer carries `estimated: true`. One after another, not in parallel: most queries fit one page and skip the count. Live: `maxResults` must be 1 to 5000, and a query without a condition (`ORDER BY created`) answers 400 "unbounded JQL queries are not allowed", shown as Jira's message.
- **Same errors.** 401 and 403 → `JiraUnauthorized`, 404 → `TaskNotFound`, 429 with `Retry-After` → `JiraRateLimited`, 5xx → `JiraUnavailable`, transport → `JiraUnreachable`. `Beta-Retry-After` is read when `Retry-After` is absent.
- **The source stays `jira`.** The web registry, the mark, the key patterns and the paste are unchanged; a board link with `selectedIssue=KEY` joins the `/browse/` link in `canvas/refs.ts` for both kinds.
- **Tokens stay on the site.** The credential is bound to the URL's origin as today; the log formatter masks the token and the Basic header value.
- **No new dependency**, no new ENV variable.

## Slices

| Branch | Story | Done when |
|---|---|---|
| `feat/jira-cloud` | US1 | against the fake Cloud in tests and a live Cloud site on the compose stack: the kind is shown, a person connects with e-mail and token, cards by key, link and `selectedIssue` link, a change in Jira reaches the card, a wrong token and a 429 show in the sync list; Data Center tests pass unchanged; `make check`, `make smoke` green |
| `feat/jira-cloud-jql` | US2 | on a live Cloud site: suggestions for fields and `status` values, a query adds its tasks with the count, a broken query shows Jira's message |

## Risks

| Risk | Answer |
|---|---|
| Atlassian's advice to use OAuth for apps that collect API tokens | On a self-hosted tiko a person pastes their own token into their own team's server, as with command-line tools. OAuth stays possible later as a second way to fill the same credential |
| `search/jql` drops bad keys and errors silently | Poll by bulkfetch, which reports by absence; search validates with `jql/parse` first |
| The approximate count is off | Shown as "about N" past the limit; the tasks added are exact |
| API tokens expire after a year by default | 401 shows as a rejected token in the sync list; the guide names the expiry |
| Scoped tokens do not work on the site URL | The guide asks for an unscoped token ("Create API token", not "with scopes"); scoped tokens wait for OAuth |
| The kind check misreads a site behind a proxy | The fallback by host, and the admin sees the kind next to the URL |
| Data Center behaviour drifts while sharing code | The Data Center tests run unchanged; the shared code moves without edits |
