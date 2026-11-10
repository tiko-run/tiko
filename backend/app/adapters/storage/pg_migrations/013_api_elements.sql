-- Elements a person added to a board through the API (spec 046). Kept beside the board, not in
-- it: copies people make carry nothing, and only these may have their text changed or be removed
-- with a key.
CREATE TABLE api_elements (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    board_id text NOT NULL,
    element_id text NOT NULL,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, board_id, element_id),
    FOREIGN KEY (workspace_id, board_id) REFERENCES boards (workspace_id, id) ON DELETE CASCADE
);

GRANT SELECT, INSERT, UPDATE, DELETE ON api_elements TO tiko_app, tiko_jobs;
ALTER TABLE api_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_elements FORCE ROW LEVEL SECURITY;
CREATE POLICY app_rows ON api_elements TO tiko_app
    USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
    WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
CREATE POLICY jobs_rows ON api_elements TO tiko_jobs USING (true) WITH CHECK (true);
