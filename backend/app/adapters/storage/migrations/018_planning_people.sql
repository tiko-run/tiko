-- People the instance plans with; a directory of names, not accounts. Teams are a JSON list.
CREATE TABLE IF NOT EXISTS planning_people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    teams TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL
);
