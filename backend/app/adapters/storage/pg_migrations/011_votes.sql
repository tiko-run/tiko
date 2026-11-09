-- Timed voting rounds on a board (spec 043). Votes stay out of the shared board: an anonymous
-- round must not show anyone who voted for what.
CREATE TABLE vote_rounds (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    id text PRIMARY KEY,
    board_id text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
    name text NOT NULL,
    votes integer NOT NULL,
    stack boolean NOT NULL,
    anonymous boolean NOT NULL,
    elements jsonb NOT NULL,
    -- Each element's text when the round ended, by element id.
    texts jsonb NOT NULL DEFAULT '{}',
    started_by text NOT NULL,
    started_at timestamptz NOT NULL,
    ends_at timestamptz,
    ended_at timestamptz
);
-- One running round per board.
CREATE UNIQUE INDEX vote_rounds_running ON vote_rounds (board_id) WHERE ended_at IS NULL;
CREATE INDEX vote_rounds_board ON vote_rounds (board_id, started_at);

CREATE TABLE vote_people (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    round_id text NOT NULL REFERENCES vote_rounds (id) ON DELETE CASCADE,
    person_id text NOT NULL,
    done boolean NOT NULL DEFAULT false,
    PRIMARY KEY (round_id, person_id)
);

CREATE TABLE vote_ballots (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    round_id text NOT NULL REFERENCES vote_rounds (id) ON DELETE CASCADE,
    person_id text NOT NULL,
    element_id text NOT NULL,
    count integer NOT NULL CHECK (count > 0),
    PRIMARY KEY (round_id, person_id, element_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON vote_rounds, vote_people, vote_ballots TO tiko_app, tiko_jobs;
ALTER TABLE vote_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE vote_rounds FORCE ROW LEVEL SECURITY;
CREATE POLICY app_rows ON vote_rounds TO tiko_app
    USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
    WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
CREATE POLICY jobs_rows ON vote_rounds TO tiko_jobs USING (true) WITH CHECK (true);
ALTER TABLE vote_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE vote_people FORCE ROW LEVEL SECURITY;
CREATE POLICY app_rows ON vote_people TO tiko_app
    USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
    WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
CREATE POLICY jobs_rows ON vote_people TO tiko_jobs USING (true) WITH CHECK (true);
ALTER TABLE vote_ballots ENABLE ROW LEVEL SECURITY;
ALTER TABLE vote_ballots FORCE ROW LEVEL SECURITY;
CREATE POLICY app_rows ON vote_ballots TO tiko_app
    USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
    WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
CREATE POLICY jobs_rows ON vote_ballots TO tiko_jobs USING (true) WITH CHECK (true);
