-- Phase 1B: persistent scan store schema.
-- Postgres flavour (Supabase). SQLite differences handled in core/db.py.

CREATE TABLE IF NOT EXISTS scan_runs (
    id                      UUID PRIMARY KEY,
    scope                   TEXT NOT NULL,
    run_date                DATE NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'running',
    started_at              TIMESTAMPTZ NOT NULL,
    finished_at             TIMESTAMPTZ,
    error_message           TEXT,
    algolia_complete        BOOLEAN,
    algolia_hits_expected   INT,
    algolia_hits_collected  INT,
    rest_skus_expected      INT,
    rest_skus_priced        INT,
    rest_skus_failed        INT,
    rest_failed_skus        TEXT[]
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_completed_sweep
    ON scan_runs(scope, run_date) WHERE status = 'completed';

CREATE TABLE IF NOT EXISTS products (
    parent_sku              TEXT PRIMARY KEY,
    name                    TEXT,
    vintage                 INT,
    region                  TEXT,
    subregion               TEXT,
    colour                  TEXT,
    country                 TEXT,
    producer                TEXT,
    grape_varieties         TEXT[],
    product_url             TEXT,
    first_seen_run_id       UUID REFERENCES scan_runs(id),
    first_seen_at           TIMESTAMPTZ NOT NULL,
    last_seen_run_id        UUID REFERENCES scan_runs(id),
    last_seen_at            TIMESTAMPTZ NOT NULL,
    consecutive_misses      INT NOT NULL DEFAULT 0,
    gone_since              TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS skus (
    parent_sku              TEXT NOT NULL REFERENCES products(parent_sku),
    format_code             TEXT NOT NULL,
    case_size               INT,
    bottle_volume_ml        INT,
    least_listing_price_p   INT,
    market_price_p          INT,
    last_transaction_p      INT,
    highest_bid_p           INT,
    qty_available           INT,
    source_agreement        TEXT DEFAULT 'unchecked',
    first_seen_run_id       UUID REFERENCES scan_runs(id),
    first_seen_at           TIMESTAMPTZ NOT NULL,
    last_seen_run_id        UUID REFERENCES scan_runs(id),
    last_seen_at            TIMESTAMPTZ NOT NULL,
    consecutive_misses      INT NOT NULL DEFAULT 0,
    gone_since              TIMESTAMPTZ,
    PRIMARY KEY (parent_sku, format_code)
);

CREATE TABLE IF NOT EXISTS offers (
    bbx_listing_id          TEXT PRIMARY KEY,
    parent_sku              TEXT NOT NULL REFERENCES products(parent_sku),
    format_code             TEXT,
    match_confidence        TEXT DEFAULT 'inferred',
    case_size               INT,
    bottle_volume_ml        INT,
    price_per_case_p        INT NOT NULL,
    first_seen_run_id       UUID REFERENCES scan_runs(id),
    first_seen_at           TIMESTAMPTZ NOT NULL,
    last_seen_run_id        UUID REFERENCES scan_runs(id),
    last_seen_at            TIMESTAMPTZ NOT NULL,
    consecutive_misses      INT NOT NULL DEFAULT 0,
    gone_since              TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS observation_events (
    id                      BIGSERIAL PRIMARY KEY,
    scan_run_id             UUID NOT NULL REFERENCES scan_runs(id),
    observed_at             TIMESTAMPTZ NOT NULL,
    entity_type             TEXT NOT NULL,
    entity_key              TEXT NOT NULL,
    event_type              TEXT NOT NULL,
    field_name              TEXT NOT NULL DEFAULT '',
    old_value_raw           TEXT,
    new_value_raw           TEXT,
    metadata                JSONB,
    UNIQUE (scan_run_id, entity_type, entity_key, event_type, field_name)
);

CREATE INDEX IF NOT EXISTS idx_obs_entity
    ON observation_events(entity_type, entity_key, observed_at);
CREATE INDEX IF NOT EXISTS idx_obs_run
    ON observation_events(scan_run_id);
