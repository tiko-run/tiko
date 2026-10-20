CREATE TABLE IF NOT EXISTS user_credentials (
    user_id TEXT NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL,
    token_enc TEXT NOT NULL,
    base_url TEXT NOT NULL,
    PRIMARY KEY (user_id, provider)
);

-- Snapshots are kept per person: what one token can see never reaches another person.
CREATE TABLE IF NOT EXISTS task_snapshots_v2 (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    state TEXT NOT NULL,
    data TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
);
