CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    doc TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_snapshots (
    key TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    data TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
