-- Fields a Gantt can show as columns; the three standard ones exist from the start.
CREATE TABLE IF NOT EXISTS planning_fields (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    standard INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL
);
INSERT OR IGNORE INTO planning_fields (id, name, standard, position) VALUES
    ('priority', 'Priority', 1, 1),
    ('size', 'Size', 1, 2),
    ('team', 'Team', 1, 3);
