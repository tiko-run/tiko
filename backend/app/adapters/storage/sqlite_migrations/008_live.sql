-- Encoded CRDT state of a board; NULL until it is first opened live or after a plain save.
ALTER TABLE boards ADD COLUMN ydoc BLOB;
