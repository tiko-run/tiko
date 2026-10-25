-- The first admin replaces the password from the log or the file; people from earlier
-- releases are not asked.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
