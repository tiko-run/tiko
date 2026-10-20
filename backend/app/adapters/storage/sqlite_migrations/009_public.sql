-- The token of a board's public link; NULL while the board is not public.
ALTER TABLE boards ADD COLUMN public_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS boards_public_token ON boards (public_token)
WHERE public_token IS NOT NULL;
