-- Each person's product tour and getting started progress, as JSON the domain reads.
CREATE TABLE IF NOT EXISTS onboarding (
    user_id TEXT PRIMARY KEY,
    state TEXT NOT NULL
);
