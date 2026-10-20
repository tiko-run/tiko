-- What the limiters count, kept here so that several API processes share one count.
CREATE TABLE attempts (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    at REAL NOT NULL
);
CREATE INDEX attempts_recent ON attempts (scope, key, at);

-- A budget of requests per key: the window opens at the first request.
CREATE TABLE attempt_windows (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    opened REAL NOT NULL,
    used INTEGER NOT NULL,
    PRIMARY KEY (scope, key)
);
