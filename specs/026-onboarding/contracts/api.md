# API: onboarding

Per person; any signed-in person, demo visitors included.

## `GET /api/me/onboarding`

```json
{"tour_seen": false, "done": {"add_card": "2026-10-15T09:12:03Z"}, "hidden": false}
```

`done` maps an item to when it was first done. Items: `add_card`, `paste_link`, `search_filter`, `set_timer`, `timer_list`, `gantt_task`, `focus`, `tracker`.

## `PATCH /api/me/onboarding`

```json
{"tour_seen": true, "done": ["set_timer"], "hidden": false}
```

Every field is optional. Items in `done` are added; an item already done keeps its first time and is never removed. Answers with the whole state as `GET` does. An unknown item is `422`.
