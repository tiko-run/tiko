-- When the last board showing a picture and the sticker pack let go of it. The cleanup job
-- deletes it some days later, so undo and a pasted copy still find it in between.
ALTER TABLE files ADD COLUMN unused_since timestamptz;
