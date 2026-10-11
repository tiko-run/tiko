# Data Model: Task sources

## Task

`Task` gains `source: str`, the id of the provider that made it (`"jira"`, `"demo"`).

A ref is `"{source}:{key}"`. Source ids match `^[a-z][a-z0-9_]*$`.

## Board document

No migration. Three places gain an optional `source`:

| Where | Field |
|---|---|
| card node (`task_card`, `jira_card` before spec 017) | `data.source` |
| timer | `data.watch.source` |
| Gantt task row | `source` next to `key` |

Without `source` the task belongs to the tracker the instance is set to. Everything written from this version on carries it. The key check stays per source: today's pattern for `jira` and `demo`.

## Cache

Migration `011_sources.sql`:

```sql
CREATE TABLE IF NOT EXISTS task_snapshots_v3 (
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    key TEXT NOT NULL,
    state TEXT NOT NULL,
    data TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (user_id, source, key)
);
-- then each person's rows are copied with the instance's tracker as their source
DROP TABLE IF EXISTS task_snapshots_v2;
```

A person's old rows get the source of the tracker the instance is set to, in the column and inside the stored task. Rows with an empty `user_id` were the demo tasks everyone shared; they are not copied, the demo source answers for them.

The cache is each person's own for every source.

`SnapshotRepo.get_many` takes refs and answers a map by ref.

## Sources in the web app

`frontend/src/sources/registry.ts`, one entry per source:

| Field | Example |
|---|---|
| `id` | `jira` |
| `name` | `Jira` |
| `mark` | `{ light, dark }`, bundled SVG files |

An id missing from the registry renders as "Unknown tracker" with a neutral icon.
