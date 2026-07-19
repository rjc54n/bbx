-- Phase 2 read layer: curated views for the Next.js/Supabase front end,
-- plus the search indexes and lockdown grants the views depend on.
--
-- Design (agreed in handover, not relitigated here):
--   - No custom backend; PostgREST exposes these views directly.
--   - Views are ordinary (security definer, the Postgres default) since the
--     store is single-owner with no per-user rows yet. Revisit with
--     `security_invoker = true` once per-user rows (watchlists) exist.
--   - candidate_view exposes pct_market/pct_last computed from stored sku
--     prices. It deliberately does NOT compute pct_next: that requires the
--     live GraphQL order-book check the existing scan pipeline performs,
--     which stored data does not replace (see core/pipeline.py
--     classify_order_book). signal_type flags this as a stored estimate so
--     the UI doesn't present it as live-verified.

-- ---------------------------------------------------------------------------
-- Search indexes
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_products_name_trgm
    ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_producer_trgm
    ON products USING gin (producer gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_region ON products(region);
CREATE INDEX IF NOT EXISTS idx_products_colour ON products(colour);
CREATE INDEX IF NOT EXISTS idx_products_vintage ON products(vintage);

CREATE INDEX IF NOT EXISTS idx_skus_gone_since ON skus(gone_since);
CREATE INDEX IF NOT EXISTS idx_offers_gone_since ON offers(gone_since);

-- ---------------------------------------------------------------------------
-- candidate_view: one row per (parent_sku, format_code), with the discount
-- metrics computable from stored data.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW candidate_view AS
SELECT
    s.parent_sku,
    s.format_code,
    p.name,
    p.vintage,
    p.region,
    p.subregion,
    p.colour,
    p.country,
    p.producer,
    p.product_url,
    s.case_size,
    s.bottle_volume_ml,
    s.least_listing_price_p,
    s.market_price_p,
    s.last_transaction_p,
    s.highest_bid_p,
    s.qty_available,
    s.source_agreement,
    ROUND(
        ((s.market_price_p - s.least_listing_price_p)::NUMERIC / s.market_price_p) * 100,
        1
    ) AS pct_market,
    CASE
        WHEN s.last_transaction_p IS NOT NULL AND s.last_transaction_p > 0
        THEN ROUND(
            ((s.last_transaction_p - s.least_listing_price_p)::NUMERIC / s.last_transaction_p) * 100,
            1
        )
    END AS pct_last,
    'stored_estimate'::TEXT AS signal_type,
    (s.gone_since IS NULL) AS is_active,
    s.first_seen_at,
    s.last_seen_at
FROM skus s
JOIN products p ON p.parent_sku = s.parent_sku
WHERE s.least_listing_price_p IS NOT NULL
  AND s.least_listing_price_p > 0
  AND s.market_price_p IS NOT NULL
  AND s.market_price_p > 0;

-- ---------------------------------------------------------------------------
-- product_detail_view: one row per product, with aggregate SKU/offer
-- coverage. Per-format detail and price history come from candidate_view
-- and price_history_view respectively, filtered by parent_sku.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW product_detail_view AS
SELECT
    p.parent_sku,
    p.name,
    p.vintage,
    p.region,
    p.subregion,
    p.colour,
    p.country,
    p.producer,
    p.grape_varieties,
    p.product_url,
    p.first_seen_at,
    p.last_seen_at,
    (p.gone_since IS NULL) AS is_active,
    (
        SELECT COUNT(*) FROM skus s
        WHERE s.parent_sku = p.parent_sku AND s.gone_since IS NULL
    ) AS active_sku_count,
    (
        SELECT COUNT(*) FROM offers o
        WHERE o.parent_sku = p.parent_sku AND o.gone_since IS NULL
    ) AS active_offer_count,
    (
        SELECT MAX(ROUND(
            ((s.market_price_p - s.least_listing_price_p)::NUMERIC / s.market_price_p) * 100, 1
        ))
        FROM skus s
        WHERE s.parent_sku = p.parent_sku
          AND s.gone_since IS NULL
          AND s.least_listing_price_p IS NOT NULL AND s.least_listing_price_p > 0
          AND s.market_price_p IS NOT NULL AND s.market_price_p > 0
    ) AS best_pct_market
FROM products p;

-- ---------------------------------------------------------------------------
-- price_history_view: sku price-change events, one row per field per change.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW price_history_view AS
SELECT
    oe.id AS event_id,
    oe.entity_key,
    split_part(oe.entity_key, '|', 1) AS parent_sku,
    split_part(oe.entity_key, '|', 2) AS format_code,
    oe.field_name,
    oe.old_value_raw,
    oe.new_value_raw,
    oe.observed_at,
    oe.scan_run_id
FROM observation_events oe
WHERE oe.entity_type = 'sku'
  AND oe.event_type = 'price_changed';

-- ---------------------------------------------------------------------------
-- scan_health_view: sweep run history, for a status/health page.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW scan_health_view AS
SELECT
    id AS run_id,
    scope,
    run_date,
    status,
    started_at,
    finished_at,
    error_message,
    algolia_complete,
    algolia_hits_expected,
    algolia_hits_collected,
    rest_skus_expected,
    rest_skus_priced,
    rest_skus_failed,
    rest_failed_skus,
    EXTRACT(EPOCH FROM (finished_at - started_at)) AS duration_seconds
FROM scan_runs
ORDER BY started_at DESC;

-- ---------------------------------------------------------------------------
-- Lockdown: base tables are internal only; anon/authenticated read curated
-- views via PostgREST. Auth is deferred (per handover), so this data is
-- public read for now.
--
-- Supabase grants ALL on newly created relations to anon/authenticated via
-- a default ACL on the `postgres` role (schema public) -- a fresh CREATE VIEW
-- inherits INSERT/UPDATE/DELETE/etc, not just SELECT. GRANT SELECT alone is
-- additive, not restrictive, so the views must be explicitly stripped back
-- down first. The ALTER DEFAULT PRIVILEGES below closes this for every
-- future view/table this migration set creates in `public`, so later phases
-- don't reintroduce the same gap.
-- ---------------------------------------------------------------------------

REVOKE ALL ON scan_runs, products, skus, offers, observation_events
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON candidate_view, product_detail_view, price_history_view, scan_health_view
    FROM PUBLIC, anon, authenticated;

GRANT SELECT ON candidate_view, product_detail_view, price_history_view, scan_health_view
    TO anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon, authenticated;
