-- Response-time fix: cache the catalogue read model, and stop the anchor view
-- rebuilding its evidence set three times per query.
--
-- Measured symptoms (owner, 27 August 2026): Favourites ~6s and intermittently
-- past the authenticated role's 8s statement timeout; Scenarios multi-second;
-- My CellarTracker and My BBR Cellar the same. One cause explains all of them.
--
-- public.catalogue_view (20260724200000) is a four-level nested subquery over
-- private.skus JOIN private.products with a LEFT JOIN LATERAL aggregate over
-- private.offers per SKU -- roughly 52k SKUs, rebuilt from scratch on every
-- request. Three views then aggregate the *whole* of it before the caller's
-- filter can apply, because the filter sits on the outer side of a LEFT JOIN
-- and cannot be pushed into a grouped subquery:
--
--   favourite_wine_view          smallest_format + market CTEs
--   current_cellartracker_records  smallest + normalised_market CTEs
--                                  -- the same two aggregates, duplicated
--   bbr_cellar_market_view       joins unfiltered catalogue_view
--
-- The CellarTracker page compounds it further by issuing four separate queries
-- against current_cellartracker_records, each re-running both aggregates.
--
-- private.skus / products / offers have exactly one writer -- core/store.py
-- commit_sweep, once daily at 02:00 UTC (.github/workflows/daily_sweep.yml).
-- Nothing writes them intra-day. A cache refreshed after the sweep is therefore
-- exactly as fresh as the data itself. This is the same reasoning, the same
-- mechanism and the same refresh hook as the facet caches in 20260820140000.
--
-- The release anchor is deliberately NOT cached here. Its inputs are owner-
-- editable intra-day, so a cache would need a refresh hook on ~25 write paths
-- and a stale anchor is a wrong release price. Section 5 fixes it structurally
-- instead, by scanning the evidence set once rather than three times.

-- 1. catalogue_mv: the catalogue read model, precomputed ----------------------
--
-- The SELECT is 20260724200000's, with one change: last_rest_checked_at and
-- is_listed are folded into the innermost `base` subquery and the two outer
-- self-joins back to products/skus are dropped. Those joins existed only so
-- CREATE OR REPLACE VIEW could append columns without shifting ordinal
-- positions -- a materialized view has no such constraint. They could never
-- eliminate a row (products is joined in base already, and skus' primary key is
-- the (parent_sku, format_code) pair the row is built from), so removing them
-- is row-for-row identical and saves two joins over the whole catalogue.

CREATE MATERIALIZED VIEW public.catalogue_mv AS
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

COMMENT ON MATERIALIZED VIEW public.catalogue_mv IS
    'Precomputed catalogue read model. Rebuilt after each daily sweep by core/store.py refresh_catalogue_caches; the sweep is the only writer to private.skus/products/offers, so this is never staler than the data.';

-- Required for REFRESH ... CONCURRENTLY, and the key every per-format join
-- uses: wine_card_format_view, bbr_cellar_market_view and release_price_market_view
-- all join on (parent_sku, format_code). Its parent_sku prefix also serves the
-- per-wine lookups (the wine card, favourites, wine_market_summary_mv), so no
-- separate parent_sku index is needed.
CREATE UNIQUE INDEX catalogue_mv_key
    ON public.catalogue_mv (parent_sku, format_code);

-- The free-text search box is or(name.ilike, producer.ilike), and the producer
-- typeahead is a prefix match -- the one access pattern a scan of 52k rows does
-- badly. pg_trgm is already installed (20260719081754); the equivalent indexes
-- on private.products cannot serve a scan of this view.
CREATE INDEX catalogue_mv_name_trgm
    ON public.catalogue_mv USING gin (name gin_trgm_ops);
CREATE INDEX catalogue_mv_producer_trgm
    ON public.catalogue_mv USING gin (producer gin_trgm_ops);

-- Deliberately no b-tree indexes on the enum filters (region, colour, vintage,
-- ...) or the range/sort fields. They would not pay for themselves here: the
-- expense this migration removes was the LATERAL over private.offers, not the
-- scan, and a scan of ~52k precomputed rows is already cheap. The sorts cannot
-- use a single-column index anyway -- every catalogue and scenario query appends
-- (parent_sku, format_code) as a pagination tiebreaker, so only a composite
-- index per field *and direction* would avoid the sort.
--
-- Each index also has to be maintained by REFRESH ... CONCURRENTLY after every
-- sweep, so adding them speculatively is a real, nightly cost. Add them from
-- measured plans instead -- index_advisor, or EXPLAIN (ANALYZE, BUFFERS) on the
-- filter combinations that turn out to be slow:
-- https://supabase.com/docs/guides/database/extensions/index_advisor

-- 2. Repoint catalogue_view onto the cache ------------------------------------
--
-- Columns are listed explicitly in their current ordinal order so CREATE OR
-- REPLACE keeps the view's grants and every dependent view. The access boundary
-- is unchanged: catalogue_view is granted to anon and authenticated today, and
-- both already hold SELECT on private.skus/products/offers (20260729065629), so
-- granting the cache to the same roles exposes nothing new.

CREATE OR REPLACE VIEW public.catalogue_view
WITH (security_invoker = TRUE) AS
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
FROM public.catalogue_mv;

REVOKE ALL ON public.catalogue_mv FROM PUBLIC;
GRANT SELECT ON public.catalogue_mv TO anon, authenticated, service_role;

-- 3. wine_market_summary_mv: the per-wine aggregate, computed once ------------
--
-- favourite_wine_view and current_cellartracker_records each build the same two
-- aggregates over the entire catalogue on every request. This is that work,
-- done once per sweep. Column definitions are copied verbatim from
-- 20260729203000 so the two views' output is unchanged.
--
-- FULL OUTER JOIN, not LEFT: `smallest` requires case_size > 0 while `market`
-- also requires bottle_volume_ml > 0, so a wine can qualify for one and not the
-- other. in_tracked_catalogue records which side produced the row, preserving
-- favourite_wine_view's `catalogue.parent_sku IS NOT NULL` exactly.

CREATE MATERIALIZED VIEW public.wine_market_summary_mv AS
WITH smallest AS (
    SELECT DISTINCT ON (parent_sku)
        parent_sku, name, vintage, producer, country, region, subregion,
        colour, product_url, case_size, bottle_volume_ml, is_listed,
        last_rest_checked_at
    FROM public.catalogue_mv
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
    FROM public.catalogue_mv
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

COMMENT ON MATERIALIZED VIEW public.wine_market_summary_mv IS
    'One row per wine: smallest-format identity plus 75cl-normalised market figures. Shared by favourite_wine_view and current_cellartracker_records, which each computed it per request.';

CREATE UNIQUE INDEX wine_market_summary_mv_key
    ON public.wine_market_summary_mv (parent_sku);

REVOKE ALL ON public.wine_market_summary_mv FROM PUBLIC;
GRANT SELECT ON public.wine_market_summary_mv TO anon, authenticated, service_role;

-- 3b. Rebuilding the caches inside a transaction -----------------------------
--
-- The production refresh is CONCURRENT and runs in autocommit from
-- core/store.py refresh_catalogue_caches, so a sweep never blocks readers.
-- CONCURRENTLY cannot run inside a transaction block, which the pgTAP suite
-- needs: those tests insert fixture rows into private.skus / private.products
-- and then read catalogue_view, which no longer sees an uncommitted write --
-- it reads the cache.
--
-- This is the blocking, in-transaction form for exactly that case. It takes an
-- ACCESS EXCLUSIVE lock on each cache, so it must not be used on a live
-- database; core/store.py remains the production path.
CREATE FUNCTION private.rebuild_catalogue_caches()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Order matters: wine_market_summary_mv is built from catalogue_mv.
    REFRESH MATERIALIZED VIEW public.catalogue_mv;
    REFRESH MATERIALIZED VIEW public.wine_market_summary_mv;
END;
$$;

REVOKE ALL ON FUNCTION private.rebuild_catalogue_caches()
    FROM PUBLIC, anon, authenticated;

-- 4. current_cellartracker_records: read the summary instead of rebuilding it -
--
-- Identical to 20260729203000 except that the `smallest` and `normalised_market`
-- CTEs -- two aggregates over the whole catalogue -- become one indexed lookup
-- per row against wine_market_summary_mv. Columns, order and types unchanged.

CREATE OR REPLACE VIEW public.current_cellartracker_records
WITH (security_invoker = TRUE)
AS
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
LEFT JOIN public.wine_market_summary_mv summary
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

-- 5. Stop the anchor view rebuilding its evidence set three times -------------
--
-- release_price_anchor_view referenced release_offer_evidence_view three times
-- -- once for `provisional`, once for `confirmed`, and once more at the end
-- purely to re-fetch the columns of the id it had just selected. A view is
-- always inlined, so that is three builds of a windowed de-duplication over
-- every accepted offer price, per query.
--
-- The third reference is redundant: `provisional` and `confirmed` between them
-- already carry every projected column. Dropping it leaves two.
--
-- Deliberately NOT solved with a MATERIALIZED CTE. That would build the
-- evidence set once for a whole-catalogue scan, but it is also an optimisation
-- fence, and it would stop a `parent_sku` qual pushing down into the window's
-- PARTITION BY -- which is what makes the wine card, the catalogue's anchor
-- enrichment and favourites fast. The point lookups are the common case.
--
-- The CASE branches on `confirmed.release_offer_price_id IS NULL` per column
-- rather than coalescing each one: a confirmed anchor with a NULL
-- source_product_url must keep its own NULL, not inherit the provisional row's
-- value. Semantics are otherwise identical to 20260730090000.

CREATE OR REPLACE VIEW public.release_price_anchor_view
WITH (security_invoker = TRUE)
AS
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

-- 6. favourite_wine_view: look up per favourite instead of aggregating all ----
--
-- Every CTE in 20260729203000's definition aggregated a whole table and was
-- then LEFT JOINed to a handful of wine_favourites rows. The favourite's
-- parent_sku cannot be pushed into a grouped subquery on the inner side of a
-- LEFT JOIN, so all of that work happened on every page load -- which is what
-- put this view past the authenticated role's 8s statement timeout.
--
-- Each becomes a correlated LATERAL keyed on the favourite. An aggregate with
-- no GROUP BY returns exactly one row even when it matches nothing, so
-- LEFT JOIN LATERAL ... ON TRUE yields count 0 and NULL sums -- the same values
-- the outer coalesces already handled. latest_release's DISTINCT ON (parent_sku)
-- ORDER BY parent_sku, offer_date DESC, release_offer_price_id DESC is exactly
-- a per-parent top-1, so it becomes ORDER BY ... LIMIT 1.
--
-- Columns, order and types are unchanged.

CREATE OR REPLACE VIEW public.favourite_wine_view
WITH (security_invoker = TRUE)
AS
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
LEFT JOIN public.wine_market_summary_mv summary
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

-- 7. CellarTracker snapshot totals --------------------------------------------
--
-- The page read every row of current_cellartracker_records to sum two integer
-- columns in JavaScript, and separately asked for an exact head count -- two
-- full evaluations of the view for three numbers. One row, computed here.

CREATE VIEW public.cellartracker_snapshot_totals_view
WITH (security_invoker = TRUE)
AS
SELECT
    count(*)::INT AS record_count,
    coalesce(sum(quantity_home), 0)::INT AS bottles_home,
    coalesce(sum(quantity_bbr), 0)::INT AS bottles_bbr
FROM public.current_cellartracker_records;

COMMENT ON VIEW public.cellartracker_snapshot_totals_view IS
    'Whole-snapshot CellarTracker totals for the page header, independent of search and paging.';

REVOKE ALL ON public.cellartracker_snapshot_totals_view
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cellartracker_snapshot_totals_view TO authenticated;
