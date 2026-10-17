-- Saved sets of Gantt filters, shared by every board of the instance.
CREATE TABLE IF NOT EXISTS planning_views (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    filters TEXT NOT NULL,
    position INTEGER NOT NULL
);
