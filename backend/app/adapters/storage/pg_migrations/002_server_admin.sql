-- The owner sees no workspace rows; the jobs role sees them all.
SET LOCAL ROLE tiko_jobs;

-- The server's own settings leave the default workspace.
INSERT INTO server_settings (key, value)
SELECT s.key, s.value FROM settings s JOIN workspaces w ON w.id = s.workspace_id
WHERE w.kind = 'default' AND s.key IN ('instance_id', 'usage_stats', 'error_reports', 'last_ping_at')
ON CONFLICT (key) DO UPDATE SET value = excluded.value;

DELETE FROM settings
WHERE key IN ('instance_id', 'usage_stats', 'error_reports', 'last_ping_at');

-- A server started fresh on Postgres made its first admin before the server admin existed.
UPDATE users SET server_admin = true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE server_admin)
AND id = (
    SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id AND m.role = 'admin'
    WHERE u.demo_expires_at IS NULL AND u.disabled_at IS NULL
    ORDER BY u.created_at, u.id LIMIT 1
);

RESET ROLE;
