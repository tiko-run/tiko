-- Pictures put on boards. One row per distinct file in a workspace, found again by its hash, so
-- a screenshot pasted ten times is stored once. The id is random: knowing a file is not enough
-- to name it.
CREATE TABLE files (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    id text PRIMARY KEY,
    sha256 text NOT NULL,
    mime text NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    color text NOT NULL,
    -- A GIF or animated WebP: the canvas draws it still, from a copy, until it may move.
    moving boolean NOT NULL,
    -- Stored bytes of the file and its copies, for the quota.
    size bigint NOT NULL,
    uploaded_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    data bytea NOT NULL,
    UNIQUE (workspace_id, sha256)
);

-- Smaller WebP copies the canvas draws instead of the original.
CREATE TABLE file_copies (
    workspace_id text NOT NULL,
    file_id text NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    width integer NOT NULL,
    data bytea NOT NULL,
    PRIMARY KEY (file_id, width)
);

-- The bytes are compressed already; Postgres would only spend time trying again.
ALTER TABLE files ALTER COLUMN data SET STORAGE EXTERNAL;
ALTER TABLE file_copies ALTER COLUMN data SET STORAGE EXTERNAL;

GRANT SELECT, INSERT, UPDATE, DELETE ON files, file_copies TO tiko_app, tiko_jobs;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
CREATE POLICY app_rows ON files TO tiko_app
    USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
    WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
CREATE POLICY jobs_rows ON files TO tiko_jobs USING (true) WITH CHECK (true);
ALTER TABLE file_copies ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_copies FORCE ROW LEVEL SECURITY;
CREATE POLICY app_rows ON file_copies TO tiko_app
    USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
    WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
CREATE POLICY jobs_rows ON file_copies TO tiko_jobs USING (true) WITH CHECK (true);
