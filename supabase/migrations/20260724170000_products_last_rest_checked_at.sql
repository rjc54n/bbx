-- Phase 4: record per-parent REST freshness and expose it to catalogue
-- consumers. Existing rows intentionally remain NULL so the first
-- biddable_full_book baseline can find every parent that has not yet had a
-- successful REST check.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS last_rest_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN products.last_rest_checked_at IS
    'Time this parent was included in a successful REST batch. NULL means no successful check has been recorded.';

-- CREATE OR REPLACE VIEW requires existing output columns to retain their
-- names, types and ordinal positions. last_rest_checked_at is therefore
-- appended after price_vs_adjusted_guide_pct.
CREATE OR REPLACE VIEW catalogue_view AS
SELECT
    priced.*,
    p.last_rest_checked_at
FROM (
    SELECT
        ext.*,
        CASE
            WHEN ext.adjusted_guide_p IS NOT NULL
                AND ext.adjusted_guide_p > 0
            THEN ROUND(
                (
                    (ext.ask - ext.adjusted_guide_p)::NUMERIC
                    / ext.adjusted_guide_p
                ) * 100,
                1
            )
        END AS price_vs_adjusted_guide_pct
    FROM (
        SELECT
            base.*,
            CASE
                WHEN base.next_lowest_price_p IS NOT NULL
                    AND base.next_lowest_price_p > 0
                THEN ROUND(
                    (
                        (base.ask - base.next_lowest_price_p)::NUMERIC
                        / base.next_lowest_price_p
                    ) * 100,
                    1
                )
            END AS price_vs_next_pct,
            ROUND(
                base.ask::NUMERIC / NULLIF(base.case_size, 0),
                0
            ) AS price_per_bottle_p,
            ROUND(
                base.ask::NUMERIC
                    / NULLIF(
                        base.case_size * base.bottle_volume_ml / 1000.0,
                        0
                    ),
                1
            ) AS price_per_litre_p,
            CASE
                WHEN base.market_price_p IS NULL THEN NULL
                WHEN base.bottle_volume_ml = 375
                    THEN ROUND(base.market_price_p * 1.031)
                WHEN base.bottle_volume_ml = 750
                    THEN base.market_price_p
                WHEN base.bottle_volume_ml = 1500
                    THEN ROUND(base.market_price_p * 1.031)
                WHEN base.bottle_volume_ml = 3000
                    THEN ROUND(base.market_price_p * 1.178)
                WHEN base.bottle_volume_ml = 6000
                    THEN ROUND(base.market_price_p * 1.109)
                WHEN base.bottle_volume_ml = 9000
                    THEN ROUND(base.market_price_p * 1.143)
                ELSE base.market_price_p
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
                    WHEN ob.floor_count >= 2
                        THEN s.least_listing_price_p
                    ELSE ob.next_higher_p
                END AS next_lowest_price_p,
                s.qty_available,
                s.source_agreement,
                s.first_seen_at,
                s.last_seen_at,
                'stored_estimate'::TEXT AS signal_type,
                CASE
                    WHEN s.market_price_p IS NOT NULL
                        AND s.market_price_p > 0
                    THEN ROUND(
                        (
                            (s.least_listing_price_p - s.market_price_p)::NUMERIC
                            / s.market_price_p
                        ) * 100,
                        1
                    )
                END AS price_vs_market_pct,
                CASE
                    WHEN s.last_transaction_p IS NOT NULL
                        AND s.last_transaction_p > 0
                    THEN ROUND(
                        (
                            (s.least_listing_price_p - s.last_transaction_p)::NUMERIC
                            / s.last_transaction_p
                        ) * 100,
                        1
                    )
                END AS price_vs_last_pct
            FROM skus s
            JOIN products p ON p.parent_sku = s.parent_sku
            LEFT JOIN LATERAL (
                SELECT
                    MIN(o.price_per_case_p) FILTER (
                        WHERE o.price_per_case_p
                            > s.least_listing_price_p
                                + GREATEST(
                                    0.005 * s.least_listing_price_p,
                                    1
                                )
                    ) AS next_higher_p,
                    COUNT(*) FILTER (
                        WHERE ABS(
                            o.price_per_case_p - s.least_listing_price_p
                        ) <= GREATEST(
                            0.005 * s.least_listing_price_p,
                            1
                        )
                    ) AS floor_count
                FROM offers o
                WHERE o.parent_sku = s.parent_sku
                    AND o.format_code = s.format_code
                    AND o.match_confidence = 'inferred'
                    AND o.gone_since IS NULL
            ) ob ON TRUE
            WHERE s.gone_since IS NULL
        ) base
    ) ext
) priced
JOIN products p ON p.parent_sku = priced.parent_sku;
