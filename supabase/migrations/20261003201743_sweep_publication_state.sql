-- Source quality and publication are separate facts. Historical rows remain
-- unknown: an old terminal status did not prove that every cache was published.
ALTER TABLE private.scan_runs
    ADD COLUMN source_committed_at timestamptz,
    ADD COLUMN source_status text CHECK (source_status IN ('completed', 'partial')),
    ADD COLUMN published_at timestamptz,
    ADD COLUMN publication_stages jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN rotation_bucket integer CHECK (rotation_bucket BETWEEN 0 AND 14),
    ADD CONSTRAINT scan_publication_requires_source
        CHECK (published_at IS NULL OR source_committed_at IS NOT NULL);

CREATE OR REPLACE VIEW public.scan_health_view
WITH (security_invoker = true) AS
SELECT
    id AS run_id, scope, run_date, status, started_at, finished_at,
    error_message, algolia_complete, algolia_hits_expected,
    algolia_hits_collected, rest_skus_expected, rest_skus_priced,
    rest_skus_failed, rest_failed_skus,
    EXTRACT(EPOCH FROM (finished_at - started_at)) AS duration_seconds,
    source_committed_at, source_status, published_at, publication_stages
FROM private.scan_runs
ORDER BY started_at DESC;

COMMENT ON COLUMN private.scan_runs.published_at IS
    'All required catalogue, summary, scenario, facet and REST timestamp stages succeeded for this source generation.';
COMMENT ON COLUMN private.scan_runs.publication_stages IS
    'Compact stage outcomes, elapsed seconds and row counts. No query text or credentials.';
