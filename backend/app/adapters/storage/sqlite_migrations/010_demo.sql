-- Set for a demo visitor only: the time they are deleted unless they come back or sign up.
ALTER TABLE users ADD COLUMN demo_expires_at TEXT;
CREATE INDEX users_demo ON users (demo_expires_at) WHERE demo_expires_at IS NOT NULL;

-- Demo task statuses a person changed, on a demo instance; a task without a row has its own.
CREATE TABLE demo_statuses (
    user_id TEXT NOT NULL REFERENCES users(id),
    key TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
);

-- A person's board list reads their own boards and the shared ones, not every board.
CREATE INDEX boards_everyone ON boards (everyone_role) WHERE everyone_role IS NOT NULL;
