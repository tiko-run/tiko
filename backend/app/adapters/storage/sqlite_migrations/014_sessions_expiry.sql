-- Expired sessions are swept at every sign-in: without an index that reads every session.
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);
