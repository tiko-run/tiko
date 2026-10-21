-- Home's trash: a deleted board keeps every row and waits 30 days before it goes for good.
ALTER TABLE boards
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by text REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX boards_trash ON boards (deleted_at) WHERE deleted_at IS NOT NULL;
