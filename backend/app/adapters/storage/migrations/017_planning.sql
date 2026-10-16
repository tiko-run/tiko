-- Stage types the instance's Gantt charts share in Planning mode; the switch is a setting.
CREATE TABLE IF NOT EXISTS planning_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hue INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL
);
