-- A moving picture plays from a light animated WebP, not from its GIF.
ALTER TABLE files ADD COLUMN motion bytea;
ALTER TABLE files ALTER COLUMN motion SET STORAGE EXTERNAL;

-- Which boards may serve a file: the one it was uploaded to and every board whose saved
-- document refers to it. Rows are only added, so a picture pasted onto a board stays readable
-- there while the board catches up; removing what nothing refers to is a cleanup job's work.
CREATE TABLE board_files (
    workspace_id text NOT NULL,
    board_id text NOT NULL,
    file_id text NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    PRIMARY KEY (board_id, file_id),
    FOREIGN KEY (workspace_id, board_id) REFERENCES boards (workspace_id, id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

GRANT SELECT, INSERT, UPDATE, DELETE ON board_files TO tiko_app, tiko_jobs;
ALTER TABLE board_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_files FORCE ROW LEVEL SECURITY;
CREATE POLICY app_rows ON board_files TO tiko_app
    USING (workspace_id = nullif(current_setting('app.workspace_id', true), ''))
    WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), ''));
CREATE POLICY jobs_rows ON board_files TO tiko_jobs USING (true) WITH CHECK (true);

-- Boards saved before this release.
INSERT INTO board_files (workspace_id, board_id, file_id)
SELECT DISTINCT b.workspace_id, b.id, n -> 'data' ->> 'file'
FROM boards b, jsonb_array_elements(b.doc -> 'nodes') n
JOIN files f ON f.id = n -> 'data' ->> 'file'
WHERE n ->> 'type' = 'image' AND f.workspace_id = b.workspace_id
ON CONFLICT DO NOTHING;
