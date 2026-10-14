# API Contract: Live Jira Canvas (MVP)

Base path `/api`. JSON only. Errors use the existing skeleton format `{"error": {"code": "...", "message": "..."}}`. No response ever contains the Jira token.

## Types

```text
BoardSummary = {id, name, updated_at}
Task = {
  key, state: "ok" | "not_found",
  summary, status_name, status_category: "new" | "indeterminate" | "done",
  type_name, assignee_name: string|null, priority_name: string|null,
  updated: string|null, url, fetched_at
}
Doc = see data-model.md
Settings = {
  provider: "demo" | "jira",
  refresh_interval_s: int,             # 30..300
  secret_key_configured: bool,
  jira: {base_url: string|null, token_state: "none" | "set" | "unreadable"}
}
```

## Boards

| Method, path | Request | Response | Errors |
|---|---|---|---|
| `GET /boards` | – | `{boards: BoardSummary[]}` | |
| `POST /boards` | `{name}` | 201 `BoardSummary` | 422 `invalid_request` |
| `GET /boards/{id}` | – | `{id, name, version, doc, tasks: {KEY: Task}, updated_at}` | 404 `not_found` |
| `PUT /boards/{id}` | `{version, doc}` | `{version}` (incremented) | 404, 409 `version_conflict`, 422 `invalid_request` (schema) or `validation_failed` (doc rules) |
| `PATCH /boards/{id}` | `{name}` | `BoardSummary` (doc version unchanged) | 404, 422 |
| `DELETE /boards/{id}` | – | 204 | 404 |
| `POST /boards/{id}/refresh` | – (keys from the saved doc) | `{tasks: {KEY: Task}, fetched_at, sources: SyncSource[]}`; a failing tracker is reported in `sources`, not as an HTTP error | 404 |

`SyncSource` is one tracker's state after this call:

```text
SyncSource {
  id: string,                  # "demo" | "jira"
  name: string,                # "Demo tasks" | "Jira Data Center"
  state: "ok" | "error",
  synced_at: string | null,    # last successful poll since the server started
  error: {code, message, retry_after: int | null} | null   # retry_after while the server backs off
}
```

Backoff is per tracker on the server: `jira_rate_limited` and Jira 5xx double the wait (honouring `Retry-After`, up to 300 s); auth, config and network errors (`Jira is unreachable`, timeouts) retry at the normal interval.

## Tasks

| Method, path | Request | Response | Errors |
|---|---|---|---|
| `POST /tasks/search` | `{jql, limit?}` (limit 0..100, default 50; 0 returns only `total`, a validity and count check) | `{tasks: Task[], total}` (total counts every match) | 422 `invalid_jql`, 422 `invalid_request`, 400 `jira_not_configured`, 401, 429, 503 |
| `POST /tasks/resolve` | `{ref}` (key or issue URL) | `{task: Task}` | 422 `invalid_ref`, 422 `host_mismatch`, 404 `task_not_found` (also no access), 400 `jira_not_configured`, 401, 503 |

## JQL suggestions

| Method, path | Request | Response | Errors |
|---|---|---|---|
| `GET /jql/vocabulary` | – | `{fields: [{name, label, operators}], functions: string[], keywords: string[]}` (cached 10 min per Jira) | 400 `jira_not_configured`, 401, 429, 503 |
| `GET /jql/values?field=&prefix=` | – | `{values: [{value, label}]}` (`value` is quoted where Jira needs it, `label` is plain text; empty for fields without suggestions) | 400, 401, 429, 503 |

## Settings

| Method, path | Request | Response | Errors |
|---|---|---|---|
| `GET /settings` | – | `Settings` | |
| `PUT /settings` | `{provider?, refresh_interval_s?, jira?: {base_url, token?}}` (token omitted or blank keeps the stored one) | `Settings` | 400 `secret_key_missing`, 422 `invalid_request`, 422 `validation_failed` (new host without a new token) |
| `POST /settings/jira/test` | `{base_url?, token?}` (falls back to stored; the stored token is used only for the stored host) | `{ok: true, user}` | 400 `jira_not_configured`, 401 `jira_unauthorized`, 422 `validation_failed`, 429 `jira_rate_limited`, 503 `jira_unavailable` |

## Version

| Method, path | Request | Response | Errors |
|---|---|---|---|
| `GET /version` | – | `{version, update_check, latest: Release \| null, update_available, level: Level \| null, newer: Release[]}`, `Release = {version, url, level}`, `Level = feature \| hotfix \| breaking \| security` (`version` is the running release; `latest` is the newest of the last 100 GitHub releases, asked every 30 min per API process with `If-None-Match`, retried after 10 min on failure; a failed check keeps the last answer, so `latest` is `null` only when `UPDATE_CHECK=false` or no check has succeeded yet; `newer` lists the releases after the running one, newest first, and `level` is the highest of theirs; a release's level is the first line of its notes, see [spec 024](../../024-updates/spec.md)) | |
| `POST /version/check` | – | as `GET /version`, asking GitHub at once, at most once in 5 minutes per API process | |
| `GET /update` | – | `{available, hosting: railway \| render \| null, status: UpdaterStatus \| null}`, `UpdaterStatus = {state: idle \| running \| done \| failed, step, target, downloaded, total, error, log: string[]}`; `available` is false and `status` null when no updater answers ([spec 024](../../024-updates/spec.md)) | |
| `POST /update` | – | as `GET /update`; the API checks the room for the database copy, then the updater moves to the newest release and copies the database once the old API has stopped | 403 `forbidden` (not an admin), 409 `update_not_possible` (one-click updates off, no newer release, one running), 503 `dependency_unavailable` (the updater does not answer), 507 `not_enough_space` |

## Demo

| Method, path | Request | Response | Errors |
|---|---|---|---|
| `PUT /demo/tasks/{key}/status` | `{status}` | `{task: Task}` | 404 `task_not_found` |

The demo provider has no JQL parser: every quoted value in the query must appear in a task's key, title, status, type or assignee; a query without quotes matches all demo tasks.

`Done` and `Closed` map to `status_category: "done"`, `In Progress` and `In Review` to `indeterminate`, anything else to `new`.

## Existing (skeleton)

`GET /health`, `GET /ready`, `GET /metrics` unchanged.
