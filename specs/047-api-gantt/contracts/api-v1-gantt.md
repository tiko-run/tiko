# Contract additions: gantt and Planning reads

Additions to [the v1 contract](../../046-api-mcp/contracts/api-v1.md). Its rules hold: Bearer key, error body, budgets (each call here is one read), clients ignore what they do not know.

## Board outline and elements

`GET /api/v1/boards/{id}` without parameters gains `modules`:

```json
"modules": [{"id": "m1", "module": "gantt", "title": "Release plan", "frame": null, "rows": 42}]
```

An element of kind `module` gains `"module": "gantt"`. `rows` is present for a gantt only.

## `GET /api/v1/boards/{id}/modules/{module_id}`

```json
{
  "id": "m1", "module": "gantt", "title": "Release plan", "planning": true,
  "gantt": {
    "start": "2026-11-02", "end": "2027-01-31", "scale": "week",
    "rows": [
      {"id": "r1", "depth": 0, "title": "Payments",
       "start": "2026-11-02", "end": "2026-12-04", "dates": "own",
       "span": {"start": "2026-11-02", "end": "2026-12-18"},
       "values": [{"field": {"id": "f1", "name": "Priority"}, "value": "High", "inherited": false}]},
      {"id": "r2", "parent": "r1", "depth": 1, "key": "PROJ-12", "source": "jira",
       "task": {"title": "Refunds", "status": "In Progress", "assignee": "Mira Example", "due": "2026-12-18", "url": "...", "fetched_at": "..."},
       "start": "2026-12-12", "end": "2026-12-18", "dates": "tracker", "guessed": "start",
       "stages": [],
       "values": [{"field": {"id": "f1", "name": "Priority"}, "value": "High", "inherited": true}]},
      {"id": "r3", "parent": "r1", "depth": 1, "key": "PROJ-13", "source": "jira", "task": {"...": "..."},
       "start": "2026-11-02", "end": "2026-11-27", "dates": "own",
       "tracker": {"start": "2026-11-09", "end": "2026-12-04"},
       "values": [{"field": {"id": "f1", "name": "Priority"}, "value": "High", "inherited": true}],
       "stages": [
         {"id": "s1", "type": {"id": "t1", "name": "Design"}, "start": "2026-11-02", "end": "2026-11-13",
          "people": [{"id": "p1", "name": "Mira Example"}]},
         {"id": "s2", "type": {"id": "t9", "name": null}, "start": "2026-11-16", "end": "2026-11-27", "people": []}
       ]}
    ],
    "milestones": [{"id": "ms1", "date": "2026-12-20", "title": "Release"}],
    "links": [{"from": "r3", "to": "r2"}]
  }
}
```

- A field that does not apply is absent. Only these may be `null`: `task` on a task row, a module's `title` and `frame`, the `name` of an id Planning does not know, and a hidden workload stage's `board`, `board_name`, `row` and `type`.
- `planning`: whether Planning is on in the workspace. Off: rows carry no `stages` and no `values`.
- Rows in display order; every row, collapsed or filtered out in the web app or not.
- `parent` absent on top-level rows. `key`, `source` and `task` on task rows (`task: null` when the person's tracker credentials cannot read it); `title` on rows without a task.
- `dates`: `tracker` (the task's dates; `guessed` names a side the tracker has no date for), `stored` (follows the tracker, but the task cannot be read or has no dates: the dates last stored), `own`.
- `tracker`: `{start, end, guessed?}`, present when the task's dates disagree with what the row shows, a guessed side not compared; a parent is compared on its `span`.
- `span`: on parents, what the whole branch covers.
- `stages`: rows without children, Planning on; `[]` when none. Stage people carry `id` and `name` only; `GET /planning` says who is archived.
- `values`: fields the gantt shows as columns; `inherited` when the value comes from an ancestor.
- An id Planning does not know comes with `name: null`.
- `links`: `to` starts after `from` ends.
- Another module kind answers without `gantt`. An id that is not a module: `404 not_found`.

## `GET /api/v1/planning`

```json
{"enabled": true,
 "types": [{"id": "t1", "name": "Design", "archived": false}],
 "people": [{"id": "p1", "name": "Mira Example", "teams": ["Backend"], "archived": false,
             "off": [{"start": "2026-12-22", "end": "2027-01-02"}]}],
 "fields": [{"id": "f1", "name": "Priority", "archived": false}],
 "days_off": ["2026-12-25"]}
```

Off: `{"enabled": false}`. Time off and days off from today on. A key for chosen boards gets only the types and people of its boards' drawn stages, the fields of their gantts' columns, and days off only within gantts that count working days.

## `GET /api/v1/planning/people/{id}/workload?from=2026-11-09&weeks=12`

```json
{"person": {"id": "p1", "name": "Mira Example"},
 "weeks": [{"start": "2026-11-09", "stages": 2, "overlap": true, "off": false}],
 "stages": [
   {"board": "b1", "board_name": "Release 4.2", "row": "PROJ-13", "type": {"id": "t1", "name": "Design"},
    "start": "2026-11-02", "end": "2026-11-13"},
   {"board": null, "board_name": null, "row": null, "type": null, "start": "2026-11-12", "end": "2026-11-20"}
 ]}
```

- `from` defaults to today and counts from its Monday; `weeks` 1–26, default 12.
- A stage on a board the key does not reach keeps only its dates. A key for chosen boards counts and lists only stages on its boards.
- `404 not_found`: Planning off, an unknown person, or, for a key for chosen boards, a person its boards do not use.

## MCP

| Tool | Scope | Hints | Maps to |
|---|---|---|---|
| `read_gantt(board, gantt?, branch?, start?, end?)` | read | read-only | `GET /boards/{id}/modules/{module_id}` |
| `read_planning()` | read | read-only | `GET /planning` |
| `read_workload(person, start?, weeks?)` | read | read-only | `GET /planning/people/{id}/workload` |

- `read_gantt` without `gantt`: the board's only gantt; with several, `{"gantts": [{id, title, frame, rows}]}`; with none, a tool error.
- `branch`: one row and everything under it. `start`/`end`: rows whose bars touch the window, with their ancestors.
- When more than 100 rows remain, narrowed or not, the answer holds the top level of what remains, each row with `holds` (rows under it), and `note` on how to narrow.
- `read_workload` takes a Planning id or a name (any case); a name several people share answers `{"matches": [{id, name, teams}]}`.
- A `read` key now lists six tools.
