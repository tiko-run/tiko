-- Home's stars and folders: a person's own, nobody else sees them.
CREATE TABLE board_stars (
    workspace_id text NOT NULL,
    board_id text NOT NULL,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (board_id, user_id),
    FOREIGN KEY (workspace_id, board_id) REFERENCES boards (workspace_id, id)
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX board_stars_user ON board_stars (workspace_id, user_id);

CREATE TABLE folders (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name text NOT NULL,
    position integer NOT NULL,
    -- A board can only go into a folder of the person it is placed for.
    UNIQUE (id, user_id)
);
CREATE INDEX folders_user ON folders (workspace_id, user_id, position);

-- The primary key keeps a board in at most one folder of a person.
CREATE TABLE folder_boards (
    workspace_id text NOT NULL,
    board_id text NOT NULL,
    user_id text NOT NULL,
    folder_id text NOT NULL,
    PRIMARY KEY (board_id, user_id),
    FOREIGN KEY (workspace_id, board_id) REFERENCES boards (workspace_id, id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (folder_id, user_id) REFERENCES folders (id, user_id) ON DELETE CASCADE
);
CREATE INDEX folder_boards_user ON folder_boards (workspace_id, user_id);
CREATE INDEX folder_boards_folder ON folder_boards (folder_id);

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['board_stars', 'folders', 'folder_boards'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO tiko_app, tiko_jobs', t);
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY app_rows ON %I TO tiko_app'
            ' USING (workspace_id = nullif(current_setting(''app.workspace_id'', true), ''''))'
            ' WITH CHECK (workspace_id = nullif(current_setting(''app.workspace_id'', true), ''''))',
            t
        );
        EXECUTE format(
            'CREATE POLICY jobs_rows ON %I TO tiko_jobs USING (true) WITH CHECK (true)', t
        );
    END LOOP;
END
$$;
