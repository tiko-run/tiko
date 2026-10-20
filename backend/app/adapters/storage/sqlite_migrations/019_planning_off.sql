-- Time off of a planning person: dates only, never the reason.
CREATE TABLE IF NOT EXISTS planning_off (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES planning_people(id),
    start_day TEXT NOT NULL,
    end_day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS planning_off_person ON planning_off (person_id);
