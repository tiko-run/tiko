-- The random id of the usage stats, made once here so processes that start together share it.
INSERT OR IGNORE INTO settings (key, value) VALUES (
    'instance_id',
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
    || substr(lower(hex(randomblob(2))), 2) || '-'
    || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-'
    || lower(hex(randomblob(6)))
);
