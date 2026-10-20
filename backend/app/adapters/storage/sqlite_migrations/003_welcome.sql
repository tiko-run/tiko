-- Installs that already have boards never get the welcome board.
INSERT OR IGNORE INTO settings (key, value)
SELECT 'welcome_seeded', '1' WHERE EXISTS (SELECT 1 FROM boards);
