-- Phase 3: format premium correction.
--
-- BBX's market_price is identical to the Liv-ex market price (verified
-- against 115 cellar holdings, 2026-07-23) and Liv-ex quotes a standard
-- 12x75cl case, scaling every other format by pure volume. adjusted_guide_p
-- corrects this with the measured premium curve in core/format_premium.py
-- (kept in sync by tests/test_format_premium_migration_sync.py) -- this is a
-- MODELLED correction from BBR release-offer pricing, not an observed BBX
-- fact, and must be labelled as such wherever it is surfaced (see
-- apps/web/src/lib/query/registry.ts).
--
-- The four new columns are appended strictly after catalogue_view's existing
-- last column (price_vs_next_pct). CREATE OR REPLACE VIEW requires existing
-- output columns to keep their name, type and ordinal position -- breaking
-- that would force a DROP, which cascades through facet_values_view,
-- facet_ranges_view, search_producers and recent_price_change_view, all of
-- which depend on catalogue_view. A SELECT-list alias (e.g. adjusted_guide_p)
-- cannot be referenced by another expression in the same SELECT list, so
-- price_vs_adjusted_guide_pct is computed in one more layer of nesting
-- rather than inline alongside it.

CREATE OR REPLACE VIEW catalogue_view AS
SELECT
    ext.*,
    CASE
        WHEN ext.adjusted_guide_p IS NOT NULL AND ext.adjusted_guide_p > 0
        THEN ROUND(
            ((ext.ask - ext.adjusted_guide_p)::NUMERIC / ext.adjusted_guide_p) * 100,
            1
        )
    END AS price_vs_adjusted_guide_pct
FROM (
    SELECT
        base.*,
        CASE
            WHEN base.next_lowest_price_p IS NOT NULL AND base.next_lowest_price_p > 0
            THEN ROUND(
                ((base.ask - base.next_lowest_price_p)::NUMERIC / base.next_lowest_price_p) * 100,
                1
            )
        END AS price_vs_next_pct,
        ROUND(base.ask::NUMERIC / NULLIF(base.case_size, 0), 0) AS price_per_bottle_p,
        ROUND(
            base.ask::NUMERIC / NULLIF(base.case_size * base.bottle_volume_ml / 1000.0, 0),
            1
        ) AS price_per_litre_p,
        -- Format premium curve, measured from 450 BBR historic release offers
        -- that priced a bottle case and another format in the same offer
        -- (median premium of the other format's price-per-litre over the
        -- bottle case's). Kept in lockstep with FORMAT_PREMIUM in
        -- core/format_premium.py -- do not edit one without the other.
        CASE
            WHEN base.market_price_p IS NULL THEN NULL
            WHEN base.bottle_volume_ml = 375  THEN ROUND(base.market_price_p * 1.031)  -- half bottle, +3.1%
            WHEN base.bottle_volume_ml = 750  THEN base.market_price_p                 -- reference
            WHEN base.bottle_volume_ml = 1500 THEN ROUND(base.market_price_p * 1.031)  -- magnum, +3.1%
            WHEN base.bottle_volume_ml = 3000 THEN ROUND(base.market_price_p * 1.178)  -- double magnum, +17.8%
            WHEN base.bottle_volume_ml = 6000 THEN ROUND(base.market_price_p * 1.109)  -- imperial/methuselah, +10.9%
            WHEN base.bottle_volume_ml = 9000 THEN ROUND(base.market_price_p * 1.143)  -- salmanazar, +14.3%
            ELSE base.market_price_p  -- unrecognised format: identity, never guessed
        END AS adjusted_guide_p
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
    ) base
) ext;
