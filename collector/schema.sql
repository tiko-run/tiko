-- Usage stats of tiko instances: the fields are listed at https://docs.tiko.run/privacy/.
CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind TEXT NOT NULL,
    schema INTEGER NOT NULL,
    instance_id UUID,
    country TEXT,
    payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS events_kind_received ON events (kind, received_at);
CREATE INDEX IF NOT EXISTS events_instance_received ON events (instance_id, received_at);

-- What is left of a month once its rows are older than 13 months.
CREATE TABLE IF NOT EXISTS events_monthly (
    month DATE NOT NULL,
    kind TEXT NOT NULL,
    dims JSONB NOT NULL,
    events INTEGER NOT NULL,
    instances INTEGER NOT NULL,
    PRIMARY KEY (month, kind, dims)
);

-- The Worker's role: writes events and rolls old ones up, reads nothing else.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'collector') THEN
        CREATE ROLE collector LOGIN;
    END IF;
END $$;
GRANT SELECT, INSERT, DELETE ON events TO collector;
GRANT USAGE ON SEQUENCE events_id_seq TO collector;
GRANT INSERT, UPDATE, SELECT ON events_monthly TO collector;

-- The Cloud waitlist: what https://tiko.run/privacy/ lists, nothing more.
CREATE TABLE IF NOT EXISTS waitlist (
    email TEXT PRIMARY KEY,
    signed_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source TEXT NOT NULL,
    -- True when the form asked for news; the launch e-mail asks the mailbox owner to confirm it.
    news BOOLEAN NOT NULL DEFAULT false,
    consent TEXT NOT NULL,
    country TEXT
);
-- The Worker adds addresses and cannot read them back.
GRANT INSERT ON waitlist TO collector;
