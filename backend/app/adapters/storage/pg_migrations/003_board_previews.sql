-- Home's previews: the last drawing of each board, drawn again for a newer board version or a
-- newer way of drawing.
CREATE TABLE board_previews (
    workspace_id text NOT NULL,
    board_id text PRIMARY KEY,
    version integer NOT NULL,
    drawing integer NOT NULL,
    svg text NOT NULL,
    -- A board that moves to another workspace takes its preview along.
    FOREIGN KEY (workspace_id, board_id) REFERENCES boards (workspace_id, id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

GRANT SELECT, INSERT, UPDATE, DELETE ON board_previews TO tiko_app, tiko_jobs;
ALTER TABLE board_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_previews FORCE ROW LEVEL SECURITY;
CREATE POLICY app_rows ON board_previews TO tiko_app
    USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
    WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
CREATE POLICY jobs_rows ON board_previews TO tiko_jobs USING (true) WITH CHECK (true);

-- The board list tells an empty board without reading every document.
ALTER TABLE boards ADD COLUMN has_nodes boolean
    GENERATED ALWAYS AS (coalesce(doc -> 'nodes' <> '[]'::jsonb, false)) STORED;
