# API: planning on a demo instance

Changes to [spec 027's planning contract](../../027-planning/contracts/api.md).

## `GET /api/planning`

Adds `sample`:

```json
{"enabled": true, "types": [...], "people": [...], "fields": [...], "views": [], "daysOff": [], "sample": true}
```

`sample` is `true` on a demo instance (`TIKO_DEMO`) and `false` elsewhere. On a demo instance the answer is the sample library and nothing else, even when the database holds other rows: no other types or people, only the standard fields, no views and no days off. Planning is on, the types and people have fixed ids (`demo-build`, `demo-anna`), and their time off is dated around today. A client hides every control that writes to the lists, and the workload, when `sample` is `true`.

## Writes and workload

Unchanged: `PATCH /api/planning`, every write under `/api/planning` and `GET /api/planning/people/{id}/workload` answer `403` on a demo instance, for visitors and signed-up members alike.

## Public link

A board's public payload on a demo instance carries `planning` like any instance with Planning on, limited to what the board uses.
