-- A task is identified by its tracker and its key.
CREATE TABLE IF NOT EXISTS task_snapshots_v3 (
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    key TEXT NOT NULL,
    state TEXT NOT NULL,
    data TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (user_id, source, key)
);
-- A person's old rows came from the tracker the instance is set to, so cards keep their data
-- while that tracker cannot be reached. Rows of nobody were the shared demo tasks, which are
-- read from the demo source now.
INSERT OR IGNORE INTO task_snapshots_v3 (user_id, source, key, state, data, fetched_at)
SELECT s.user_id, t.source, s.key, s.state, json_set(s.data, '$.source', t.source), s.fetched_at
FROM task_snapshots_v2 s
JOIN (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM settings WHERE key = 'provider' AND value = 'jira')
        THEN 'jira' ELSE 'demo' END AS source
) t
WHERE s.user_id != '';
DROP TABLE IF EXISTS task_snapshots_v2;
