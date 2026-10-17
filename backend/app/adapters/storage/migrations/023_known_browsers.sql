-- Browsers a person signed in from: only the hash of the cookie's token, as for sessions.
CREATE TABLE IF NOT EXISTS known_browsers (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS known_browsers_user ON known_browsers (user_id, created_at);
CREATE INDEX IF NOT EXISTS known_browsers_created ON known_browsers (created_at);
