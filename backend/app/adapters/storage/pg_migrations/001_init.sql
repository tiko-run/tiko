-- Roles are global to the server, so a second tiko database on it shares them.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiko_app') THEN
        CREATE ROLE tiko_app NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiko_jobs') THEN
        CREATE ROLE tiko_jobs NOLOGIN;
    END IF;
END
$$;
-- The owner logs in and switches to these per pool; since Postgres 16 the creator needs SET.
GRANT tiko_app TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;
GRANT tiko_jobs TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;
GRANT USAGE ON SCHEMA public TO tiko_app, tiko_jobs;

-- Global tables: accounts and lookups that hold no workspace content.

CREATE TABLE users (
    id text PRIMARY KEY,
    username text NOT NULL,
    name text NOT NULL,
    password_hash text NOT NULL,
    email text UNIQUE,
    server_admin boolean NOT NULL DEFAULT false,
    disabled_at timestamptz,
    last_sign_in_at timestamptz,
    welcomed_at timestamptz,
    demo_expires_at timestamptz,
    created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX users_username ON users (lower(username));
CREATE INDEX users_demo ON users (demo_expires_at) WHERE demo_expires_at IS NOT NULL;

CREATE TABLE user_identities (
    provider text NOT NULL,
    subject text NOT NULL,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (provider, subject)
);

CREATE TABLE workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('default', 'demo', 'regular')),
    owner_id text REFERENCES users (id) ON DELETE SET NULL,
    expires_at timestamptz,
    created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX workspaces_one_default ON workspaces (kind) WHERE kind = 'default';

CREATE TABLE memberships (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('admin', 'member')),
    PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX memberships_user ON memberships (user_id);

CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

CREATE TABLE invites (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    role text NOT NULL CHECK (role IN ('admin', 'member')),
    created_by text REFERENCES users (id) ON DELETE SET NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL
);
CREATE INDEX invites_workspace ON invites (workspace_id);

CREATE TABLE password_resets (
    id text PRIMARY KEY,
    token_hash text NOT NULL UNIQUE,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_by text REFERENCES users (id) ON DELETE SET NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL
);

CREATE TABLE attempts (
    scope text NOT NULL,
    key text NOT NULL,
    at double precision NOT NULL
);
CREATE INDEX attempts_recent ON attempts (scope, key, at);

CREATE TABLE attempt_windows (
    scope text NOT NULL,
    key text NOT NULL,
    opened double precision NOT NULL,
    used integer NOT NULL,
    PRIMARY KEY (scope, key)
);

CREATE TABLE known_browsers (
    token_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at double precision NOT NULL
);
CREATE INDEX known_browsers_user ON known_browsers (user_id, created_at);
CREATE INDEX known_browsers_created ON known_browsers (created_at);

CREATE TABLE server_settings (
    key text PRIMARY KEY,
    value text NOT NULL
);

-- Workspace tables: each row names its workspace, references stay inside it.

CREATE TABLE boards (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    id text PRIMARY KEY,
    name text NOT NULL,
    doc jsonb NOT NULL,
    ydoc bytea,
    version integer NOT NULL,
    everyone_role text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (workspace_id, id)
);
CREATE INDEX boards_updated ON boards (workspace_id, updated_at DESC);
CREATE INDEX boards_everyone ON boards (workspace_id) WHERE everyone_role IS NOT NULL;

-- A public link and a live socket know only the board; this finds its workspace.
CREATE TABLE board_index (
    board_id text PRIMARY KEY REFERENCES boards (id) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    public_token text UNIQUE
);

CREATE TABLE board_members (
    workspace_id text NOT NULL,
    board_id text NOT NULL,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role text NOT NULL,
    PRIMARY KEY (board_id, user_id),
    FOREIGN KEY (workspace_id, board_id) REFERENCES boards (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX board_members_user ON board_members (workspace_id, user_id);

CREATE TABLE settings (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    key text NOT NULL,
    value text NOT NULL,
    PRIMARY KEY (workspace_id, key)
);

CREATE TABLE user_credentials (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider text NOT NULL,
    token_enc text NOT NULL,
    base_url text NOT NULL,
    PRIMARY KEY (workspace_id, user_id, provider)
);

CREATE TABLE task_snapshots (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    source text NOT NULL,
    key text NOT NULL,
    state text NOT NULL,
    data jsonb NOT NULL,
    fetched_at timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, user_id, source, key)
);

CREATE TABLE demo_statuses (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    key text NOT NULL,
    status text NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, user_id, key)
);

CREATE TABLE onboarding (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    state jsonb NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE planning_types (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    id text NOT NULL,
    name text NOT NULL,
    hue integer NOT NULL,
    archived boolean NOT NULL DEFAULT false,
    position integer NOT NULL,
    PRIMARY KEY (workspace_id, id)
);

CREATE TABLE planning_fields (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    id text NOT NULL,
    name text NOT NULL,
    standard boolean NOT NULL DEFAULT false,
    archived boolean NOT NULL DEFAULT false,
    position integer NOT NULL,
    PRIMARY KEY (workspace_id, id)
);

CREATE TABLE planning_views (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    id text NOT NULL,
    name text NOT NULL,
    filters jsonb NOT NULL,
    position integer NOT NULL,
    PRIMARY KEY (workspace_id, id)
);

CREATE TABLE planning_people (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    id text NOT NULL,
    name text NOT NULL,
    teams jsonb NOT NULL DEFAULT '[]',
    source text NOT NULL,
    archived boolean NOT NULL DEFAULT false,
    position integer NOT NULL,
    PRIMARY KEY (workspace_id, id)
);

CREATE TABLE planning_off (
    workspace_id text NOT NULL,
    id text NOT NULL,
    person_id text NOT NULL,
    start_day date NOT NULL,
    end_day date NOT NULL,
    PRIMARY KEY (workspace_id, id),
    FOREIGN KEY (workspace_id, person_id)
        REFERENCES planning_people (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX planning_off_person ON planning_off (workspace_id, person_id);

-- Stages of every board, so the workload never opens boards; rewritten with each save.
CREATE TABLE planning_stages (
    workspace_id text NOT NULL,
    board_id text NOT NULL,
    person_id text NOT NULL,
    row_title text NOT NULL,
    type text NOT NULL,
    -- Text, as drawn: a malformed date in a board must not fail its save.
    start text NOT NULL,
    "end" text NOT NULL,
    FOREIGN KEY (workspace_id, board_id) REFERENCES boards (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX planning_stages_person ON planning_stages (workspace_id, person_id);
CREATE INDEX planning_stages_board ON planning_stages (board_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tiko_app, tiko_jobs;
-- schema_migrations is the owner's alone.
REVOKE ALL ON schema_migrations FROM tiko_app, tiko_jobs;

-- Forced row-level security on every table with workspace_id: the request role sees its
-- workspace only, the jobs role sees all, the owner sees nothing.
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT c.relname FROM pg_class c
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'workspace_id'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE c.relkind = 'r'
          AND c.relname NOT IN ('board_index', 'invites', 'memberships')
    LOOP
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
