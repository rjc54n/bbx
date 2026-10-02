-- REST-check timestamp decoupling (docs/REST-CHECK-DECOUPLING-2026-10-02.md).
--
-- The sweep stamped products.last_rest_checked_at for ~16k parents per run.
-- That column is copied into catalogue_mv and wine_market_summary_mv, so every
-- concurrent refresh rewrote ~28k + ~16k cached rows for the timestamp alone.
-- The timestamp now lives in a narrow table; the cached copies freeze.
--
-- checked_at  : internal, written with the prices; drives wave selection.
-- published_at: what "Market checked" shows; set from checked_at only after
--               the catalogue caches refresh, so it always matches the cached
--               prices beside it.
--
-- catalogue_view is replaced in place (same columns, names, order and types),
-- so its grants and every dependent view are kept; the five views that expose
-- last_rest_checked_at all read it through catalogue_view.

CREATE TABLE private.product_rest_checks (
    parent_sku    TEXT PRIMARY KEY REFERENCES private.products (parent_sku),
    checked_at    TIMESTAMPTZ NOT NULL,
    published_at  TIMESTAMPTZ
);

-- Same access as the other scan-store tables (20260729065629): no Data API
-- endpoint, but readable by the security_invoker views that join it.
REVOKE ALL ON TABLE private.product_rest_checks
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE private.product_rest_checks
    TO anon, authenticated, service_role;

-- The last sweep that committed also refreshed the caches, so the current
-- value is both the latest check and the published one.
INSERT INTO private.product_rest_checks (parent_sku, checked_at, published_at)
SELECT parent_sku, last_rest_checked_at, last_rest_checked_at
FROM private.products
WHERE last_rest_checked_at IS NOT NULL;

CREATE OR REPLACE VIEW public.catalogue_view
WITH (security_invoker = TRUE) AS
SELECT
    m.parent_sku,
    m.format_code,
    m.name,
    m.vintage,
    m.country,
    m.region,
    m.subregion,
    m.colour,
    m.producer,
    m.product_url,
    m.case_size,
    m.bottle_volume_ml,
    m.ask,
    m.market_price_p,
    m.last_transaction_p,
    m.highest_bid_p,
    m.next_lowest_price_p,
    m.qty_available,
    m.source_agreement,
    m.first_seen_at,
    m.last_seen_at,
    m.signal_type,
    m.price_vs_market_pct,
    m.price_vs_last_pct,
    m.price_vs_next_pct,
    m.price_per_bottle_p,
    m.price_per_litre_p,
    m.adjusted_guide_p,
    m.price_vs_adjusted_guide_pct,
    rc.published_at AS last_rest_checked_at,
    m.is_listed
FROM public.catalogue_mv m
LEFT JOIN private.product_rest_checks rc ON rc.parent_sku = m.parent_sku;

COMMENT ON COLUMN private.products.last_rest_checked_at IS
    'Obsolete since 2026-10-02: frozen; see private.product_rest_checks.';
COMMENT ON COLUMN public.catalogue_mv.last_rest_checked_at IS
    'Obsolete since 2026-10-02: frozen; use catalogue_view.last_rest_checked_at.';
COMMENT ON COLUMN public.wine_market_summary_mv.last_rest_checked_at IS
    'Obsolete since 2026-10-02: frozen; use catalogue_view.last_rest_checked_at.';
