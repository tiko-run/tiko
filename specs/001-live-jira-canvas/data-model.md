# Data Model: Live Jira Canvas (MVP)

SQLite file `DB_PATH` (default `data/app.db`), WAL, one connection with a lock. Schema in `backend/app/adapters/storage/schema.sql`, versioned by `PRAGMA user_version`, migrated on startup.

## Tables

### `boards`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | uuid4 hex |
| `name` | TEXT | 1–100 chars, trimmed |
| `doc` | TEXT | JSON board document, see below |
| `version` | INTEGER | starts at 1; save is `UPDATE … WHERE id=? AND version=?`, rowcount 0 → `version_conflict` |
| `created_at`, `updated_at` | TEXT | ISO 8601 UTC |

### `task_snapshots`

| Column | Type | Notes |
|---|---|---|
| `key` | TEXT PK | issue key, upper case |
| `state` | TEXT | `ok` or `not_found` |
| `data` | TEXT | JSON `Task` (see contract) |
| `fetched_at` | TEXT | ISO 8601 UTC |

Shared by every card with that key on any board. A failed refresh does not touch rows (cards keep last known data).

### `settings`

Key-value rows: `provider` (`demo` default), `refresh_interval_s` (30 default, 30–300), `jira_base_url`, `jira_token_enc` (Fernet ciphertext). One set per instance.

## Board document (`boards.doc`)

```text
{ nodes: Node[], edges: Edge[], viewport: {x, y, zoom} }

Node  = {id, type, position:{x,y}, width?, height?, parentId?, data}
  type "jira_card" data {key, collapsed}
  type "frame"     data {title, color?, opacity?}   # color: none or a sticky color; absent reads as none
  type "sticky"    data {text, color, opacity?, bold?}
  type "shape"     data {shape, text, color, opacity?, stroke?, dash?, bold?, size?}
  type "text"      data {text, opacity?, bold?, size?}
Edge  = {id, source, target, sourceHandle?, targetHandle?}
```

Validation rules:

- `id` unique within the doc; edge `source` and `target` must exist.
- `parentId` must point at a `frame`; frames never have `parentId` (no nesting).
- Children are stored after their parent frame (xyflow ordering).
- `position` of a child is relative to its frame.
- Unknown fields are dropped (`selected`, `dragging`, `measured`).
- `key` matches `^[A-Z][A-Z0-9_]+-\d+$`.
- Style fields are left out until set and never null; absent reads as today's look. `opacity` is 10 to 100 in steps of 5 (absent 100), `stroke` is 1, 1.5 or 3 (absent 1.5), `size` is `small`, `medium` or `large` (absent `medium`), `dash` and `bold` are booleans (absent false).
- Limits: up to 2000 nodes, `text` up to 5000 chars (500 in a shape), `title` up to 200 chars.

## Domain types

- `Task`: `key, state, summary, status_name, status_category (new | indeterminate | done), type_name, assignee_name?, priority_name?, updated?, url, fetched_at`.
- `TaskRef`: parsed from a key or a `…/browse/KEY` URL; URL host must match the configured base URL host (demo: `jira.example.com`).
- `RefreshState` (in memory, per process): `fails`, `backoff_until`.

## State transitions

- Card snapshot: `missing → ok` on resolve; `ok ↔ not_found` on refresh; unchanged on provider error.
- Token: `none → set` on save; `set → unreadable` when the secret key changes; `unreadable → set` on re-entry.
