# API: privacy

Admins only; anyone else gets `403`.

## `GET /api/privacy`

```json
{
  "usage_stats": true,
  "locked": [],
  "next_ping": { "kind": "ping", "schema": 2, "instance_id": "…", "version": "2026.10.20", "deploy": "installer", "arch": "arm64", "trackers": ["jira_dc"], "people": "2-5", "boards": "6-20", "boards_active": "2-5", "os": "linux", "updater": true }
}
```

- `locked`: `["usage_stats"]` when `TIKO_USAGE_STATS` is set; the switch is then read-only.
- `next_ping`: the exact body of the next daily ping, field by field as in the guide's Usage stats page.

## `PUT /api/privacy`

Body `{ "usage_stats": false }`. Answers like `GET`. `422` when the switch is locked.

## Collector: `POST https://t.tiko.run/v1/events`

The install event and the ping as listed in the guide, `schema` 1 or 2; a field schema 1 does not have is stored as `null`. `204` when accepted, `400` for an event it does not know; other methods and paths are refused.
