# API Contract: Linear

Changes to the contracts of [spec 013](../../013-task-sources/contracts/api.md) and [spec 015](../../015-github-issues/contracts/api.md). Errors use the common body `{"error": {"code", "message"}}`. The web app and the API ship together.

## Task

A Linear task has the source `linear` and the key `<workspace slug>/<identifier>`. `type_name` is `"Issue"` or `"Sub-issue"`.

```json
{"source": "linear", "key": "example/ENG-42", "state": "ok", "summary": "…",
 "status_name": "In Progress", "status_category": "indeterminate", "type_name": "Issue",
 "assignee_name": "Alex Rivera", "priority_name": "High", "updated": "2026-11-01T10:00:00+00:00",
 "url": "https://linear.app/example/issue/ENG-42/fix-the-thing", "fetched_at": "…",
 "labels": [{"name": "Bug", "color": "eb5757"}],
 "rows": [{"label": "Project", "value": "Billing"}, {"label": "Cycle", "value": "Cycle 12"},
          {"label": "Estimate", "value": "3"}],
 "due": "2026-11-30", "due_field": "dueDate"}
```

## Slice 0: My tracker by source

`GET`, `PUT`, `DELETE /api/me/tracker`: the answer has `tokens`, a map by source of `"none" | "set" | "unreadable"`, in place of `github_token_state` (and of the Jira `token_state`). `PUT {source, token}` checks the token with its tracker first and answers the view plus `connected_as` ("Ada Lovelace in Example" for Linear).

| Code | Status | When |
|---|---|---|
| `validation_failed` | 422 | the tracker rejected the token: "Linear did not accept this key" |
| `tracker_unavailable` | 503 | the tracker could not be reached to check it |
| `forbidden` | 403 | a demo visitor |

## Slice 1: changed routes

| Route | Change |
|---|---|
| `POST /api/tasks/resolve` | a `linear.app/<workspace>/issue/<ID>` link or a typed `<workspace>/<ID>` is answered by the person's Linear source; without a key: `422` "Connect your Linear key in Settings → My tracker"; another workspace: `404 task_not_found` |
| `POST /api/boards/{id}/refresh` | `sources` has a `linear` entry when the board has Linear tasks; errors `linear_rejected` (new, keeps the cards) and `tracker_rate_limited` with `retry_after` |
| `GET /api/public/{token}`, its refresh | every Linear task is `private`, with its Linear link built from the key |
| API v1 elements, MCP | refs take Linear links and `linear:<workspace>/<ID>` |

## Slice 2: bare keys

`POST /api/tasks/resolve` takes an optional `source`: `{"ref": "CORE-5", "source": "linear"}`. Without it, a bare key whose prefix two connected trackers know and that has no remembered choice answers:

```json
{"error": {"code": "ambiguous_key", "message": "CORE is known to Jira and Linear",
           "prefix": "CORE", "sources": ["jira", "linear"]}}
```

with status `409`. The web app shows the dialog and sends the ref again with `source`. API v1 and MCP answer the same and ask the caller to write `jira:CORE-5` or `linear:CORE-5`; the short `linear:CORE-5` takes the person's own workspace, and `linear:<workspace>/CORE-5` works too.

| Route | Answer |
|---|---|
| `GET /api/me/key-prefixes` | `{"choices": [{"prefix": "CORE", "source": "linear"}]}` |
| `PUT /api/me/key-prefixes/{prefix}` `{"source"}` | the list; `422` for a bad prefix or a source without prefixes |
| `DELETE /api/me/key-prefixes/{prefix}` | `204` |

All three are closed to demo visitors (`403`).

## Slice 3: query

`POST /api/tasks/search` with `{"jql": "...", "limit": 50, "source": "linear"}` reads the JQL subset of the spec (FR-015) or a saved view link. Answer: `{"tasks": [Task…], "total": null, "more": true}`: Linear gives no total; `more` is the connection's `pageInfo.hasNextPage`. A query tiko cannot read: `422 invalid_jql` with the position and what was expected. The JQL suggestion routes take `source: "linear"` and answer with Linear's fields and the person's teams, projects, cycles, states, labels and people.

## Board document

A card's `data`, a timer's `data.watch` and a Gantt task row with `source: "linear"` take a key matching `^[a-z0-9-]+/[A-Z][A-Z0-9_]*-[1-9][0-9]*$` (team key shape confirmed in T001).

## Environment

No new variable.

## Not changed

Settings → Task source, boards, people and sharing.
