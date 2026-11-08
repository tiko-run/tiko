-- Pictures of a workspace saved to its sticker panel. A sticker names a stored file; the file is
-- not copied, so saving a picture costs nothing against the quota.
CREATE TABLE stickers (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    id text PRIMARY KEY,
    file_id text NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    name text NOT NULL,
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, file_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON stickers TO tiko_app, tiko_jobs;
ALTER TABLE stickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stickers FORCE ROW LEVEL SECURITY;
CREATE POLICY app_rows ON stickers TO tiko_app
    USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
    WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
CREATE POLICY jobs_rows ON stickers TO tiko_jobs USING (true) WITH CHECK (true);
