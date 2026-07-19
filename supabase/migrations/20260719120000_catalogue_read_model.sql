-- Phase 2 revision, Phase A: catalogue read model.
--
-- candidate_view is wrong as the browser app's source for two reasons: it
-- filters out SKUs lacking a market price, and its pct_market sign is
-- inverted from the display convention this app requires (negative = ask
-- cheaper than the reference price). catalogue_view is the broad,
-- unfiltered-by-price replacement; candidate_view is untouched below and
-- stays available for the GraphQL-candidate pipeline.
--
-- Percentage convention: for every price_vs_*_pct column, ask below the
-- reference price is NEGATIVE. NULL when the reference price is missing or
-- <= 0 (never a false zero).

-- ---------------------------------------------------------------------------
-- catalogue_view: one row per active (parent_sku, format_code).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW catalogue_view AS
SELECT
    base.*,
    CASE
        WHEN base.next_lowest_price_p IS NOT NULL AND base.next_lowest_price_p > 0
        THEN ROUND(
            ((base.ask - base.next_lowest_price_p)::NUMERIC / base.next_lowest_price_p) * 100,
            1
        )
    END AS price_vs_next_pct
FROM (
    SELECT
        s.parent_sku,
        s.format_code,
        p.name,
        p.vintage,
        p.country,
        p.region,
        p.subregion,
        p.colour,
        p.producer,
        p.product_url,
        s.case_size,
        s.bottle_volume_ml,
        s.least_listing_price_p AS ask,
        s.market_price_p,
        s.last_transaction_p,
        s.highest_bid_p,
        CASE
            WHEN ob.floor_count >= 2 THEN s.least_listing_price_p
            ELSE ob.next_higher_p
        END AS next_lowest_price_p,
        s.qty_available,
        s.source_agreement,
        s.first_seen_at,
        s.last_seen_at,
        'stored_estimate'::TEXT AS signal_type,
        CASE
            WHEN s.market_price_p IS NOT NULL AND s.market_price_p > 0
            THEN ROUND(
                ((s.least_listing_price_p - s.market_price_p)::NUMERIC / s.market_price_p) * 100,
                1
            )
        END AS price_vs_market_pct,
        CASE
            WHEN s.last_transaction_p IS NOT NULL AND s.last_transaction_p > 0
            THEN ROUND(
                ((s.least_listing_price_p - s.last_transaction_p)::NUMERIC / s.last_transaction_p) * 100,
                1
            )
        END AS price_vs_last_pct
    FROM skus s
    JOIN products p ON p.parent_sku = s.parent_sku
    LEFT JOIN LATERAL (
        SELECT
            MIN(o.price_per_case_p) FILTER (
                WHERE o.price_per_case_p > s.least_listing_price_p
                    + GREATEST(0.005 * s.least_listing_price_p, 1)
            ) AS next_higher_p,
            COUNT(*) FILTER (
                WHERE ABS(o.price_per_case_p - s.least_listing_price_p)
                    <= GREATEST(0.005 * s.least_listing_price_p, 1)
            ) AS floor_count
        FROM offers o
        WHERE o.parent_sku = s.parent_sku
          AND o.format_code = s.format_code
          AND o.match_confidence = 'inferred'
          AND o.gone_since IS NULL
    ) ob ON TRUE
    WHERE s.gone_since IS NULL
) base;

-- ---------------------------------------------------------------------------
-- facet_values_view: long-format enum facet counts, global (not
-- cross-filtered by other active filters -- deferred, see Phase A note 4
-- in docs/PHASE2-catalogue-browser.md).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW facet_values_view AS
SELECT 'region' AS facet, region AS value, COUNT(*) AS n
FROM catalogue_view WHERE region IS NOT NULL GROUP BY region
UNION ALL
SELECT 'subregion', subregion, COUNT(*)
FROM catalogue_view WHERE subregion IS NOT NULL GROUP BY subregion
UNION ALL
SELECT 'country', country, COUNT(*)
FROM catalogue_view WHERE country IS NOT NULL GROUP BY country
UNION ALL
SELECT 'colour', colour, COUNT(*)
FROM catalogue_view WHERE colour IS NOT NULL GROUP BY colour
UNION ALL
SELECT 'case_size', case_size::TEXT, COUNT(*)
FROM catalogue_view WHERE case_size IS NOT NULL GROUP BY case_size
UNION ALL
SELECT 'bottle_volume_ml', bottle_volume_ml::TEXT, COUNT(*)
FROM catalogue_view WHERE bottle_volume_ml IS NOT NULL GROUP BY bottle_volume_ml;

-- ---------------------------------------------------------------------------
-- facet_ranges_view: single row, min/max for the range-filterable columns.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW facet_ranges_view AS
SELECT
    MIN(vintage) AS vintage_min,
    MAX(vintage) AS vintage_max,
    MIN(ask) AS ask_min,
    MAX(ask) AS ask_max,
    MIN(case_size) AS case_size_min,
    MAX(case_size) AS case_size_max,
    MIN(bottle_volume_ml) AS bottle_volume_ml_min,
    MAX(bottle_volume_ml) AS bottle_volume_ml_max,
    MIN(first_seen_at) AS first_seen_at_min,
    MAX(first_seen_at) AS first_seen_at_max,
    MIN(last_seen_at) AS last_seen_at_min,
    MAX(last_seen_at) AS last_seen_at_max
FROM catalogue_view;

-- ---------------------------------------------------------------------------
-- search_producers: trigram-backed producer typeahead. Producer is
-- high-cardinality, so the UI queries this async rather than preloading a
-- full producer list the way facet_values_view does for low-cardinality
-- enums. Scoped to the active catalogue via catalogue_view so counts match
-- what a search would return.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION search_producers(q TEXT)
RETURNS TABLE(producer TEXT, n BIGINT)
LANGUAGE sql
STABLE
AS $$
    SELECT producer, COUNT(*) AS n
    FROM catalogue_view
    WHERE producer % q
    GROUP BY producer
    ORDER BY similarity(producer, q) DESC, n DESC
    LIMIT 20;
$$;

-- ---------------------------------------------------------------------------
-- recent_price_change_view: latest price_changed event per active SKU,
-- joined to catalogue fields. Backs the Price-changes browse mode.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW recent_price_change_view AS
SELECT DISTINCT ON (ph.parent_sku, ph.format_code)
    ph.parent_sku,
    ph.format_code,
    c.name,
    c.vintage,
    c.country,
    c.region,
    c.subregion,
    c.colour,
    c.producer,
    c.product_url,
    c.case_size,
    c.bottle_volume_ml,
    ph.field_name,
    ph.old_value_raw,
    ph.new_value_raw,
    ph.observed_at
FROM price_history_view ph
JOIN catalogue_view c
    ON c.parent_sku = ph.parent_sku AND c.format_code = ph.format_code
ORDER BY ph.parent_sku, ph.format_code, ph.observed_at DESC, ph.event_id DESC;

-- ---------------------------------------------------------------------------
-- Lockdown: same pattern as migration 20260719081754_read_layer.sql. A fresh
-- CREATE VIEW/FUNCTION inherits broad default grants, so strip back to
-- SELECT/EXECUTE only before exposing to anon/authenticated.
-- ---------------------------------------------------------------------------

REVOKE ALL ON catalogue_view, facet_values_view, facet_ranges_view, recent_price_change_view
    FROM PUBLIC, anon, authenticated;

GRANT SELECT ON catalogue_view, facet_values_view, facet_ranges_view, recent_price_change_view
    TO anon, authenticated;

REVOKE ALL ON FUNCTION search_producers(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_producers(TEXT) TO anon, authenticated;
