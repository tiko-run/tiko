-- Personal API keys (spec 046). Global like invites: a request is signed in by the key's hash
-- before its workspace is known, so a policy here would hide every row.
CREATE TABLE api_keys (
    id text PRIMARY KEY,
    token_hash text NOT NULL UNIQUE,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name text NOT NULL,
    scope text NOT NULL CHECK (scope IN ('read', 'write')),
    -- NULL: every board the person reaches; otherwise only these.
    boards text[],
    -- The first characters after the prefix, so a person can tell keys apart.
    prefix text NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    last_used_on date,
    -- Kept a while after the end, so a request can be told why its key stopped working.
    ended_at timestamptz,
    ended_reason text CHECK (ended_reason IN ('revoked', 'signed_out', 'removed'))
);
CREATE INDEX api_keys_person ON api_keys (user_id, workspace_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO tiko_app, tiko_jobs;
