-- ============================================================================
-- Pre-flight equivalence and timing check for
--   20260827120000_catalogue_materialised_read_model.sql
--   20260827130000_release_offer_review_view_performance.sql
--
-- WHAT THIS DOES
--   Builds the *candidate* view definitions in a throwaway `perfcheck` schema,
--   against real production data, and diffs them row-for-row against the views
--   the application is reading right now. Then times both.
--
-- WHY
--   CI replays the migrations on a clean database with synthetic fixtures. That
--   proves they apply and behave; it cannot prove they return the same rows on
--   52k real SKUs. This closes that gap before anything the app reads changes.
--
-- SAFETY
--   Creates nothing outside the `perfcheck` schema. Touches no application
--   object. Reads only. Undo is one statement -- see the cleanup script.
--   It does hold read locks and burn CPU for a few minutes; run it when a sweep
--   is not in progress.
--
-- HOW TO READ THE RESULT
--   The final SELECT returns one row per view. `verdict` must be PASS for all
--   of them. Any FAIL means the candidate returns different rows from the live
--   view, and the migration must not be merged until it is understood.
--   `live_rows`/`new_rows` are shown so a "0 rows vs 0 rows" vacuous pass is
--   visible rather than looking like success.
--
--   Each candidate view reads the LIVE definitions of its dependencies, except
--   the two new caches. That is deliberate: it isolates each view's own logic,
--   so a failure points at one definition instead of the whole stack.
-- ============================================================================

-- The candidate build reads the old, slow views repeatedly. Give it room.
-- Expect a few minutes end to end. If the Supabase SQL editor cuts the request
-- off with its own limit, run sections 1-3 in separate pastes -- the perfcheck
-- schema persists between them.
SET statement_timeout = '30min';

DROP SCHEMA IF EXISTS perfcheck CASCADE;
CREATE SCHEMA perfcheck;

-- ---------------------------------------------------------------------------
-- 1. Build the candidate stack
-- ---------------------------------------------------------------------------

CREATE MATERIALIZED VIEW perfcheck.catalogue_mv AS
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
        -- Format premium. Kept in the exact
        -- "WHEN base.bottle_volume_ml = N THEN ROUND(base.market_price_p * X)"
        -- shape that tests/test_format_premium_migration_sync.py matches, so the
        -- guard against core/format_premium.py drifting still covers the
        -- definition that actually serves traffic.
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
            END AS price_vs_last_pct,
            -- Folded in from the dropped outer joins.
            p.last_rest_checked_at,
            s.is_listed
        FROM private.skus s
        JOIN private.products p ON p.parent_sku = s.parent_sku
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
            FROM private.offers o
            WHERE o.parent_sku = s.parent_sku
                AND o.format_code = s.format_code
                AND o.match_confidence = 'inferred'
                AND o.gone_since IS NULL
        ) ob ON TRUE
        WHERE s.gone_since IS NULL
    ) base
) ext
WITH DATA;

CREATE VIEW perfcheck.catalogue_view AS
SELECT
    parent_sku,
    format_code,
    name,
    vintage,
    country,
    region,
    subregion,
    colour,
    producer,
    product_url,
    case_size,
    bottle_volume_ml,
    ask,
    market_price_p,
    last_transaction_p,
    highest_bid_p,
    next_lowest_price_p,
    qty_available,
    source_agreement,
    first_seen_at,
    last_seen_at,
    signal_type,
    price_vs_market_pct,
    price_vs_last_pct,
    price_vs_next_pct,
    price_per_bottle_p,
    price_per_litre_p,
    adjusted_guide_p,
    price_vs_adjusted_guide_pct,
    last_rest_checked_at,
    is_listed
FROM perfcheck.catalogue_mv;

CREATE MATERIALIZED VIEW perfcheck.wine_market_summary_mv AS
WITH smallest AS (
    SELECT DISTINCT ON (parent_sku)
        parent_sku, name, vintage, producer, country, region, subregion,
        colour, product_url, case_size, bottle_volume_ml, is_listed,
        last_rest_checked_at
    FROM perfcheck.catalogue_mv
    WHERE case_size > 0
    ORDER BY parent_sku, case_size
), market AS (
    SELECT
        parent_sku,
        count(*)::INT AS format_count,
        count(*) FILTER (WHERE is_listed)::INT AS listed_format_count,
        min(
            round(ask::NUMERIC * 750 / nullif(case_size::NUMERIC * bottle_volume_ml, 0))::INT
        ) FILTER (WHERE ask IS NOT NULL) AS lowest_ask_per_bottle_p,
        max(
            round(highest_bid_p::NUMERIC * 750 / nullif(case_size::NUMERIC * bottle_volume_ml, 0))::INT
        ) FILTER (WHERE highest_bid_p IS NOT NULL) AS highest_bid_per_bottle_p,
        max(
            round(market_price_p::NUMERIC * 750 / nullif(case_size::NUMERIC * bottle_volume_ml, 0))::INT
        ) FILTER (WHERE market_price_p IS NOT NULL) AS guide_per_bottle_p,
        max(
            round(adjusted_guide_p::NUMERIC * 750 / nullif(case_size::NUMERIC * bottle_volume_ml, 0))::INT
        ) FILTER (WHERE adjusted_guide_p IS NOT NULL) AS adjusted_guide_per_bottle_p
    FROM perfcheck.catalogue_mv
    WHERE case_size > 0 AND bottle_volume_ml > 0
    GROUP BY parent_sku
)
SELECT
    parent_sku,
    smallest.parent_sku IS NOT NULL AS in_tracked_catalogue,
    smallest.name,
    smallest.vintage,
    smallest.producer,
    smallest.country,
    smallest.region,
    smallest.subregion,
    smallest.colour,
    smallest.product_url,
    smallest.case_size,
    smallest.bottle_volume_ml,
    smallest.is_listed,
    smallest.last_rest_checked_at,
    coalesce(market.format_count, 0) AS format_count,
    coalesce(market.listed_format_count, 0) AS listed_format_count,
    market.lowest_ask_per_bottle_p,
    market.highest_bid_per_bottle_p,
    market.guide_per_bottle_p,
    market.adjusted_guide_per_bottle_p
FROM smallest
FULL OUTER JOIN market USING (parent_sku)
WITH DATA;

CREATE VIEW perfcheck.current_cellartracker_records AS
WITH latest AS (
    SELECT id
    FROM public.cellar_imports
    WHERE source_type = 'cellartracker_inventory'
      AND status = 'accepted'
    ORDER BY accepted_at DESC, id DESC
    LIMIT 1
)
SELECT
    evidence.import_id,
    evidence.source_row_number,
    evidence.source_wine,
    evidence.source_match_key,
    evidence.vintage,
    evidence.bottle_volume_ml,
    evidence.purchase_price_per_bottle_p,
    evidence.quantity_home,
    evidence.quantity_bbr,
    evidence.total_quantity,
    evidence.fully_consumed,
    evidence.colour,
    evidence.producer,
    evidence.country,
    evidence.region,
    evidence.appellation,
    evidence.varietal,
    evidence.begin_consume,
    evidence.end_consume,
    imports.accepted_at,
    resolution.parent_sku,
    resolution.status AS link_status,
    resolution.match_method,
    summary.case_size,
    summary.is_listed,
    summary.lowest_ask_per_bottle_p,
    summary.highest_bid_per_bottle_p,
    evidence.match_group_key
FROM latest
JOIN public.cellartracker_evidence evidence ON evidence.import_id = latest.id
JOIN public.cellar_imports imports ON imports.id = latest.id
LEFT JOIN public.cellartracker_product_resolutions resolution
  ON resolution.import_id = evidence.import_id
 AND resolution.source_row_number = evidence.source_row_number
-- The summary's identity columns come from the smallest format with case_size
-- > 0, and its market columns from formats with case_size > 0 AND
-- bottle_volume_ml > 0 -- the same two predicates the replaced CTEs used.
LEFT JOIN perfcheck.wine_market_summary_mv summary
  ON summary.parent_sku = resolution.parent_sku
-- Record exclusions (20260730090000). Carried over verbatim: dropping it would
-- resurrect every record the owner has excluded, and because the column list is
-- unchanged CREATE OR REPLACE would have accepted that silently.
WHERE NOT EXISTS (
    SELECT 1
    FROM public.cellartracker_record_decisions decisions
    WHERE decisions.match_group_key = evidence.match_group_key
      AND decisions.source_wine = evidence.source_wine
      AND decisions.is_excluded
);

CREATE VIEW perfcheck.release_price_anchor_view AS
WITH provisional AS (
    SELECT DISTINCT ON (parent_sku, format_code)
        parent_sku, format_code, release_offer_price_id, offer_date,
        release_price_p, source_wine, source_product_url
    FROM public.release_offer_evidence_view
    ORDER BY parent_sku, format_code, offer_date, release_offer_price_id
)
SELECT
    provisional.parent_sku,
    provisional.format_code,
    CASE WHEN confirmed.release_offer_price_id IS NULL
        THEN 'provisional'::TEXT ELSE 'confirmed'::TEXT END AS anchor_status,
    CASE WHEN confirmed.release_offer_price_id IS NULL
        THEN provisional.release_offer_price_id
        ELSE confirmed.release_offer_price_id END AS release_offer_price_id,
    CASE WHEN confirmed.release_offer_price_id IS NULL
        THEN provisional.offer_date ELSE confirmed.offer_date END AS offer_date,
    CASE WHEN confirmed.release_offer_price_id IS NULL
        THEN provisional.release_price_p
        ELSE confirmed.release_price_p END AS release_price_p,
    CASE WHEN confirmed.release_offer_price_id IS NULL
        THEN provisional.source_wine ELSE confirmed.source_wine END AS source_wine,
    CASE WHEN confirmed.release_offer_price_id IS NULL
        THEN provisional.source_product_url
        ELSE confirmed.source_product_url END AS source_product_url
FROM provisional
LEFT JOIN public.release_price_anchor_overrides override
  ON override.parent_sku = provisional.parent_sku
 AND override.format_code = provisional.format_code
LEFT JOIN public.release_offer_evidence_view confirmed
  ON confirmed.release_offer_price_id = override.release_offer_price_id;

CREATE VIEW perfcheck.favourite_wine_view AS
SELECT
    favourite.user_id,
    favourite.parent_sku,
    favourite.created_at AS favourited_at,
    coalesce(
        summary.name,
        cellartracker.source_wine,
        offers.source_wine,
        bbr_cellar.description
    ) AS wine_name,
    coalesce(summary.vintage, cellartracker.vintage, offers.vintage) AS vintage,
    coalesce(summary.producer, cellartracker.producer) AS producer,
    summary.country,
    summary.region,
    summary.subregion,
    summary.colour,
    summary.product_url,
    coalesce(summary.in_tracked_catalogue, FALSE) AS in_tracked_catalogue,
    coalesce(summary.format_count, 0) AS format_count,
    coalesce(summary.listed_format_count, 0) AS listed_format_count,
    summary.lowest_ask_per_bottle_p,
    summary.highest_bid_per_bottle_p,
    summary.guide_per_bottle_p,
    summary.adjusted_guide_per_bottle_p,
    latest_release.latest_release_offer_date,
    latest_release.latest_release_price_per_bottle_p,
    latest_release.anchor_status,
    latest_release.ask_vs_release_pct,
    latest_release.bid_vs_release_pct,
    -- Kept separate on purpose: CellarTracker's BBR quantity and the BBR
    -- cellar holdings describe the same bottles from two sources. Summing them
    -- would double count.
    coalesce(cellartracker.cellartracker_bottles_home, 0) AS cellartracker_bottles_home,
    coalesce(cellartracker.cellartracker_bottles_bbr, 0) AS cellartracker_bottles_bbr,
    cellartracker.cellartracker_paid_per_bottle_p,
    coalesce(cellartracker.cellartracker_record_count, 0) AS cellartracker_record_count,
    coalesce(bbr_cellar.bbr_cellar_bottles, 0) AS bbr_cellar_bottles,
    coalesce(bbr_cellar.bbr_cellar_holding_count, 0) AS bbr_cellar_holding_count,
    coalesce(offers.release_offer_record_count, 0) AS release_offer_record_count
FROM public.wine_favourites favourite
-- Identity and market figures, precomputed once per sweep.
LEFT JOIN perfcheck.wine_market_summary_mv summary
  ON summary.parent_sku = favourite.parent_sku
LEFT JOIN LATERAL (
    SELECT
        market.offer_date AS latest_release_offer_date,
        market.anchor_status,
        round(
            market.release_price_p::NUMERIC * 750
            / nullif(market.case_size::NUMERIC * market.bottle_volume_ml, 0)
        )::INT AS latest_release_price_per_bottle_p,
        market.ask_vs_release_pct,
        market.bid_vs_release_pct
    FROM public.release_price_market_view market
    WHERE market.parent_sku = favourite.parent_sku
    ORDER BY market.offer_date DESC, market.release_offer_price_id DESC
    LIMIT 1
) latest_release ON TRUE
LEFT JOIN LATERAL (
    SELECT
        count(*)::INT AS cellartracker_record_count,
        sum(record.quantity_home)::INT AS cellartracker_bottles_home,
        sum(record.quantity_bbr)::INT AS cellartracker_bottles_bbr,
        round(avg(record.purchase_price_per_bottle_p)
            FILTER (WHERE record.purchase_price_per_bottle_p IS NOT NULL))::INT
            AS cellartracker_paid_per_bottle_p,
        min(record.source_wine) AS source_wine,
        min(record.vintage) AS vintage,
        min(record.producer) AS producer
    FROM public.current_cellartracker_records record
    WHERE record.parent_sku = favourite.parent_sku
) cellartracker ON TRUE
LEFT JOIN LATERAL (
    SELECT
        count(*)::INT AS bbr_cellar_holding_count,
        sum(holding.quantity_bottles)::INT AS bbr_cellar_bottles,
        min(holding.description) AS description
    FROM public.current_bbr_holdings holding
    WHERE holding.parent_sku = favourite.parent_sku
) bbr_cellar ON TRUE
LEFT JOIN LATERAL (
    SELECT
        count(*)::INT AS release_offer_record_count,
        min(row.source_wine) AS source_wine,
        min(row.source_vintage) AS vintage
    FROM public.release_offer_product_resolutions resolution
    JOIN public.release_offer_source_rows row
      ON row.import_id = resolution.import_id
     AND row.source_row_number = resolution.source_row_number
    WHERE resolution.status = 'linked'
      AND resolution.parent_sku = favourite.parent_sku
) offers ON TRUE;

CREATE VIEW perfcheck.release_offer_review_view AS
SELECT
    row.import_id,
    row.source_row_number,
    row.offer_date,
    row.source_wine,
    row.source_vintage,
    row.source_price_text,
    row.source_product_id,
    row.source_product_url,
    resolution.status AS link_status,
    resolution.parent_sku,
    resolution.match_method,
    fragments.valid_in_bond_fragment_count,
    fragments.price_fragment_count,
    row.match_group_key,
    -- Appended by 20260817160000 for the match-review card.
    row.tasting_notes,
    row.description
FROM public.release_offer_source_rows row
JOIN public.release_offer_imports imports ON imports.id = row.import_id
LEFT JOIN public.release_offer_product_resolutions resolution
  ON resolution.import_id = row.import_id
 AND resolution.source_row_number = row.source_row_number
LEFT JOIN LATERAL (
    SELECT
        count(*) FILTER (
            WHERE price.parse_status = 'valid' AND price.tax_basis = 'in_bond'
        )::INT AS valid_in_bond_fragment_count,
        count(*)::INT AS price_fragment_count
    FROM public.release_offer_prices price
    WHERE price.import_id = row.import_id
      AND price.source_row_number = row.source_row_number
) fragments ON TRUE
WHERE imports.status = 'accepted'
  AND NOT EXISTS (
    SELECT 1
    FROM public.release_offer_record_exclusions exclusions
    WHERE exclusions.content_fingerprint = row.content_fingerprint
  );

-- Mirrors the unique index the migration creates, so the planner sees the same
-- shape it will see in production.
CREATE UNIQUE INDEX ON perfcheck.catalogue_mv (parent_sku, format_code);
CREATE UNIQUE INDEX ON perfcheck.wine_market_summary_mv (parent_sku);
ANALYZE perfcheck.catalogue_mv;
ANALYZE perfcheck.wine_market_summary_mv;

-- ---------------------------------------------------------------------------
-- 2. Row-for-row equivalence
--
-- EXCEPT ALL, not EXCEPT: it preserves multiplicity, so a duplicated or dropped
-- row is caught, not just a changed set of distinct values. It also treats NULL
-- as equal to NULL, which is what row equivalence means here.
-- ---------------------------------------------------------------------------

CREATE TABLE perfcheck.results (
    view_name        TEXT PRIMARY KEY,
    covers           TEXT,
    live_rows        BIGINT,
    new_rows         BIGINT,
    new_not_in_live  BIGINT,
    live_not_in_new  BIGINT,
    verdict          TEXT
);

INSERT INTO perfcheck.results
SELECT 'catalogue_view', 'the catalogue read model itself',
    (SELECT count(*) FROM public.catalogue_view),
    (SELECT count(*) FROM perfcheck.catalogue_view),
    (SELECT count(*) FROM (TABLE perfcheck.catalogue_view EXCEPT ALL TABLE public.catalogue_view) d),
    (SELECT count(*) FROM (TABLE public.catalogue_view EXCEPT ALL TABLE perfcheck.catalogue_view) d),
    NULL;

INSERT INTO perfcheck.results
SELECT 'current_cellartracker_records', 'My CellarTracker, and the favourites holdings figures',
    (SELECT count(*) FROM public.current_cellartracker_records),
    (SELECT count(*) FROM perfcheck.current_cellartracker_records),
    (SELECT count(*) FROM (TABLE perfcheck.current_cellartracker_records EXCEPT ALL TABLE public.current_cellartracker_records) d),
    (SELECT count(*) FROM (TABLE public.current_cellartracker_records EXCEPT ALL TABLE perfcheck.current_cellartracker_records) d),
    NULL;

INSERT INTO perfcheck.results
SELECT 'release_price_anchor_view', 'every release price in the application',
    (SELECT count(*) FROM public.release_price_anchor_view),
    (SELECT count(*) FROM perfcheck.release_price_anchor_view),
    (SELECT count(*) FROM (TABLE perfcheck.release_price_anchor_view EXCEPT ALL TABLE public.release_price_anchor_view) d),
    (SELECT count(*) FROM (TABLE public.release_price_anchor_view EXCEPT ALL TABLE perfcheck.release_price_anchor_view) d),
    NULL;

INSERT INTO perfcheck.results
SELECT 'favourite_wine_view', 'Favourites',
    (SELECT count(*) FROM public.favourite_wine_view),
    (SELECT count(*) FROM perfcheck.favourite_wine_view),
    (SELECT count(*) FROM (TABLE perfcheck.favourite_wine_view EXCEPT ALL TABLE public.favourite_wine_view) d),
    (SELECT count(*) FROM (TABLE public.favourite_wine_view EXCEPT ALL TABLE perfcheck.favourite_wine_view) d),
    NULL;

INSERT INTO perfcheck.results
SELECT 'release_offer_review_view', 'Release Prices, and the pending-favourites queue',
    (SELECT count(*) FROM public.release_offer_review_view),
    (SELECT count(*) FROM perfcheck.release_offer_review_view),
    (SELECT count(*) FROM (TABLE perfcheck.release_offer_review_view EXCEPT ALL TABLE public.release_offer_review_view) d),
    (SELECT count(*) FROM (TABLE public.release_offer_review_view EXCEPT ALL TABLE perfcheck.release_offer_review_view) d),
    NULL;

UPDATE perfcheck.results
SET verdict = CASE
    WHEN new_not_in_live = 0 AND live_not_in_new = 0 AND live_rows > 0 THEN 'PASS'
    WHEN new_not_in_live = 0 AND live_not_in_new = 0 THEN 'PASS (both empty -- proves nothing)'
    ELSE 'FAIL'
END;

-- ---------------------------------------------------------------------------
-- 3. Timings
--
-- Wall clock for the shape each page actually issues, live definition versus
-- candidate. Both are run twice and the second run recorded, so the comparison
-- is warm-cache against warm-cache rather than measuring disk reads once.
-- ---------------------------------------------------------------------------

CREATE TABLE perfcheck.timings (
    id       SERIAL PRIMARY KEY,
    query    TEXT,
    live_ms  NUMERIC,
    new_ms   NUMERIC,
    speedup  TEXT
);

DO $checks$
DECLARE
    t0   TIMESTAMPTZ;
    live NUMERIC;
    cand NUMERIC;
    q    TEXT;
    r    RECORD;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('catalogue_view', 'first page',
             'SELECT * FROM %s ORDER BY price_vs_market_pct ASC NULLS LAST, parent_sku, format_code LIMIT 25'),
            ('catalogue_view', 'exact count',
             'SELECT count(*) FROM %s'),
            ('favourite_wine_view', 'whole page',
             'SELECT * FROM %s'),
            ('current_cellartracker_records', 'exact count',
             'SELECT count(*) FROM %s'),
            ('release_offer_review_view', 'first page',
             'SELECT * FROM %s ORDER BY offer_date DESC, source_row_number, import_id LIMIT 100')
        ) AS v(view_name, shape, template)
    LOOP
        -- Live definition: one warm-up run, then the measured one.
        q := replace(r.template, '%s', 'public.' || r.view_name);
        EXECUTE 'SELECT count(*) FROM (' || q || ') x';
        t0 := clock_timestamp();
        EXECUTE 'SELECT count(*) FROM (' || q || ') x';
        live := round(extract(epoch FROM clock_timestamp() - t0)::NUMERIC * 1000, 1);

        -- Candidate definition, same treatment.
        q := replace(r.template, '%s', 'perfcheck.' || r.view_name);
        EXECUTE 'SELECT count(*) FROM (' || q || ') x';
        t0 := clock_timestamp();
        EXECUTE 'SELECT count(*) FROM (' || q || ') x';
        cand := round(extract(epoch FROM clock_timestamp() - t0)::NUMERIC * 1000, 1);

        INSERT INTO perfcheck.timings (query, live_ms, new_ms, speedup)
        VALUES (r.view_name || ' -- ' || r.shape, live, cand,
            CASE WHEN cand > 0 THEN round(live / cand, 1)::TEXT || ' x' ELSE 'n/a' END);
    END LOOP;
END
$checks$;

-- ---------------------------------------------------------------------------
-- 4. Read the answer
-- ---------------------------------------------------------------------------

SELECT view_name, verdict, live_rows, new_rows, new_not_in_live, live_not_in_new, covers
FROM perfcheck.results
ORDER BY (verdict <> 'PASS') DESC, view_name;

-- Then run this separately for the timings:
--   SELECT query, live_ms, new_ms, speedup FROM perfcheck.timings ORDER BY id;
--
-- And when you are done, this to remove every trace:
--   DROP SCHEMA perfcheck CASCADE;
