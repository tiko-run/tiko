-- Which tracker a bare key goes to when two trackers know its prefix (spec 053). Kept apart
-- from the encrypted credentials: a change there would stop a running poll.
CREATE TABLE key_prefix_choices (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    prefix text NOT NULL,
    source text NOT NULL,
    PRIMARY KEY (workspace_id, user_id, prefix)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON key_prefix_choices TO tiko_app, tiko_jobs;
ALTER TABLE key_prefix_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_prefix_choices FORCE ROW LEVEL SECURITY;
CREATE POLICY app_rows ON key_prefix_choices TO tiko_app
    USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
    WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
CREATE POLICY jobs_rows ON key_prefix_choices TO tiko_jobs USING (true) WITH CHECK (true);
