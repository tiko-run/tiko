# Gantt content: Planning additions

Everything below is optional, so content saved before spec 027 stays valid. Unknown keys are ignored as before.

## Row

```json
{
  "id": "r2", "key": "PAY-40", "source": "jira", "title": "Payment API",
  "start": "2026-10-05", "end": "2026-11-27", "parent": "r1",
  "stages": [
    {"id": "s1", "type": "t1", "start": "2026-10-05", "end": "2026-10-16", "people": ["p1"]},
    {"id": "s2", "type": "t3", "start": "2026-10-19", "end": "2026-11-27", "people": ["p2", "p3"]}
  ],
  "values": {"priority": "1", "f7": "Q4"}
}
```

- `stages`: up to 20, sorted by `start`, no two overlapping (`end` of one is before `start` of the next), each `end` not before its `start`. Ids unique within the Gantt, up to 40 characters.
- On a row without children, when `stages` is not empty, `start` equals the first stage's `start` and `end` the last stage's `end`; the server rejects content where they differ (422).
- A parent row (one with children) may keep stages from before it had children; they are not drawn while it has any.
- `type` is an id from `/api/planning`, or empty for a stage without a type ("No stage"). `type` and `people` hold ids from `/api/planning`. An id the instance does not know is kept and drawn as "Unknown", so a board copied between instances still opens.
- `people`: up to 10 per stage, unique.
- `values`: field id → text up to 100 characters, up to 20 keys. An empty string is not stored.

## Content

```json
{
  "columns": ["priority", "size", "f7"],
  "filters": {"f7": ["Q4"], "team": ["Web"], "person": ["p5"]},
  "people": "inline",
  "workingDays": true
}
```

- `columns`: up to 6 field ids, unique.
- `filters`: field id or `person` → up to 20 values each.
- `people`: `"inline"` (default) or `"below"`.
- `workingDays`: default `false`.
