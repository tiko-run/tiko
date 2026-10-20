CREATE TABLE IF NOT EXISTS board_members (
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL,
    PRIMARY KEY (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS board_members_user ON board_members (user_id);
ALTER TABLE boards ADD COLUMN everyone_role TEXT;

-- Each person gets their own welcome board once; people who already had one are done.
ALTER TABLE users ADD COLUMN welcomed_at TEXT;
UPDATE users SET welcomed_at = created_at
WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'welcome_seeded');
