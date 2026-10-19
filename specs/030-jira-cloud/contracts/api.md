# API contract changes: Jira Cloud

Additive only: every field is optional or new, and old clients keep working against a Data Center instance.

## `GET /api/settings`, `PUT /api/settings`

`jira` gains `kind`, set by the server, and a `PUT` takes `jira.email` next to `jira.token`:

```json
{
  "provider": "jira",
  "jira": { "base_url": "https://example.atlassian.net", "kind": "cloud", "token_state": "set" }
}
```

- `kind`: `"dc" | "cloud" | null`, `null` while no URL is set. A `PUT` with a new `jira.base_url` finds the kind before it answers.

## `POST /api/settings/jira/test`

Body gains `email`:

```json
{ "base_url": "https://example.atlassian.net", "email": "ada@example.com", "token": "…" }
```

- `email`: optional. Blank means the stored one. Required for a Cloud URL when no e-mail is stored: `422` with `email: enter the e-mail of your Atlassian account`.
- The answer is unchanged: `{ "ok": true, "user": "Ada Lovelace" }`. A wrong pair answers `401` with the code of a rejected Jira token, as today.

## `GET /api/me/tracker`, `PUT /api/me/tracker`

`PUT` body gains `email` for `source: "jira"`:

```json
{ "source": "jira", "token": "…", "email": "ada@example.com" }
```

- Required when the instance's Jira is Cloud and no e-mail is stored; ignored for Data Center and GitHub.

`GET` gains `kind` and `email` (the person's own, never anyone else's):

```json
{
  "provider": "jira",
  "base_url": "https://example.atlassian.net",
  "kind": "cloud",
  "email": "ada@example.com",
  "token_state": "set",
  "github_token_state": "none"
}
```

## `POST /api/tasks/search`

The answer gains `estimated`:

```json
{ "tasks": [], "total": 140, "estimated": true }
```

- `estimated`: `true` when `total` is the tracker's estimate. Jira Cloud has no exact total past one page of 100, so a larger query answers with its approximate count. `false` for Data Center and the demo tasks.

## Usage stats

The `tracker` value gains `jira_cloud` next to `demo`, `jira_dc` and `github`.
