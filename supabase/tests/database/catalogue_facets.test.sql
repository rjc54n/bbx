-- facet_values_view, facet_ranges_view and format_options_view were rebuilt off
-- the base tables (20260816120000) instead of catalogue_view, for performance.
-- The contract is that they stay byte-for-byte equivalent to aggregating over
-- catalogue_view -- these tests prove that on data with the cases that matter:
-- multiple formats per product, NULL facet values, and gone (delisted) skus.

BEGIN;
SELECT plan(12);

-- P1: two live formats, fully populated facets.
INSERT INTO private.products (parent_sku, name, vintage, region, subregion, country, colour, producer, first_seen_at, last_seen_at)
VALUES ('P1', 'Ch. Test 2018', 2018, 'Bordeaux', 'Medoc', 'France', 'Red', 'Prod A', now(), now());
INSERT INTO private.skus (parent_sku, format_code, case_size, bottle_volume_ml, least_listing_price_p, first_seen_at, last_seen_at)
VALUES ('P1', '06-00750', 6, 750, 9000, now(), now()),
       ('P1', '01-01500', 1, 1500, 3200, now(), now());

-- P2: one live format, NULL subregion.
INSERT INTO private.products (parent_sku, name, vintage, region, subregion, country, colour, producer, first_seen_at, last_seen_at)
VALUES ('P2', 'Dom. Test 2019', 2019, 'Burgundy', NULL, 'France', 'White', 'Prod B', now(), now());
INSERT INTO private.skus (parent_sku, format_code, case_size, bottle_volume_ml, least_listing_price_p, first_seen_at, last_seen_at)
VALUES ('P2', '06-00750', 6, 750, 15000, now(), now());

-- P3: live sku but every facet column NULL -- must contribute to no facet.
INSERT INTO private.products (parent_sku, name, vintage, region, subregion, country, colour, producer, first_seen_at, last_seen_at)
VALUES ('P3', 'Mystery lot', NULL, NULL, NULL, NULL, NULL, NULL, now(), now());
INSERT INTO private.skus (parent_sku, format_code, case_size, bottle_volume_ml, least_listing_price_p, first_seen_at, last_seen_at)
VALUES ('P3', '06-00750', 6, 750, 500, now(), now());

-- P4: fully populated but its only sku is gone -- must be excluded everywhere.
INSERT INTO private.products (parent_sku, name, vintage, region, subregion, country, colour, producer, first_seen_at, last_seen_at)
VALUES ('P4', 'Delisted 2020', 2020, 'Rhone', 'Cornas', 'France', 'Red', 'Prod D', now(), now());
INSERT INTO private.skus (parent_sku, format_code, case_size, bottle_volume_ml, least_listing_price_p, first_seen_at, last_seen_at, gone_since)
VALUES ('P4', '12-00750', 12, 750, 8000, now(), now(), now());

-- The facet views now read materialized caches (20260820140000). Refresh them so
-- they reflect the fixtures above; the daily sweep does this in production.
-- Non-concurrent REFRESH is transaction-safe, unlike REFRESH ... CONCURRENTLY.
REFRESH MATERIALIZED VIEW public.facet_values_mv;
REFRESH MATERIALIZED VIEW public.facet_ranges_mv;
REFRESH MATERIALIZED VIEW public.format_options_mv;

-- catalogue_view reads a cache too now (20260827120000), and it is the other
-- side of every equivalence check below -- without this both sides would be
-- stale and equal for the wrong reason.
SELECT private.rebuild_catalogue_caches();

-- Equivalence: each rewritten view must equal aggregation over catalogue_view.
-- The facet caches aggregate private.skus/products directly while catalogue_view
-- now comes from catalogue_mv, so these also check the cache against an
-- independent path to the same numbers.
SELECT set_eq(
  'SELECT facet, value, n FROM public.facet_values_view',
  $$
    WITH cr AS (SELECT region, subregion, country, colour, vintage FROM public.catalogue_view)
    SELECT 'region' AS facet, region AS value, COUNT(*) AS n FROM cr WHERE region IS NOT NULL GROUP BY region
    UNION ALL SELECT 'subregion', subregion, COUNT(*) FROM cr WHERE subregion IS NOT NULL GROUP BY subregion
    UNION ALL SELECT 'country', country, COUNT(*) FROM cr WHERE country IS NOT NULL GROUP BY country
    UNION ALL SELECT 'colour', colour, COUNT(*) FROM cr WHERE colour IS NOT NULL GROUP BY colour
    UNION ALL SELECT 'vintage', vintage::TEXT, COUNT(*) FROM cr WHERE vintage IS NOT NULL GROUP BY vintage
  $$,
  'facet_values_view equals catalogue_view aggregation'
);

SELECT results_eq(
  'SELECT * FROM public.facet_ranges_view',
  $$
    SELECT MIN(vintage), MAX(vintage), MIN(ask), MAX(ask),
           MIN(case_size), MAX(case_size), MIN(bottle_volume_ml), MAX(bottle_volume_ml),
           MIN(first_seen_at), MAX(first_seen_at), MIN(last_seen_at), MAX(last_seen_at)
    FROM public.catalogue_view
  $$,
  'facet_ranges_view equals catalogue_view aggregation'
);

SELECT set_eq(
  'SELECT format_code, case_size, bottle_volume_ml, n FROM public.format_options_view',
  $$
    SELECT format_code, case_size, bottle_volume_ml, COUNT(*)
    FROM public.catalogue_view
    WHERE format_code IS NOT NULL AND case_size IS NOT NULL AND bottle_volume_ml IS NOT NULL
    GROUP BY format_code, case_size, bottle_volume_ml
  $$,
  'format_options_view equals catalogue_view aggregation'
);

-- Concrete spot-checks on the same fixture.
SELECT is(
  (SELECT n FROM public.facet_values_view WHERE facet = 'region' AND value = 'Bordeaux'),
  2::BIGINT,
  'Bordeaux counts both live P1 formats'
);
SELECT is(
  (SELECT COUNT(*) FROM public.facet_values_view WHERE value = 'Rhone'),
  0::BIGINT,
  'delisted (gone) sku is excluded from facets'
);
SELECT is(
  (SELECT COUNT(*) FROM public.facet_values_view WHERE facet = 'subregion' AND value IS NULL),
  0::BIGINT,
  'NULL facet values never appear as a bucket'
);
SELECT is(
  (SELECT ask_min FROM public.facet_ranges_view),
  500,
  'range spans every live sku including the cheapest'
);
SELECT is(
  (SELECT COUNT(*) FROM public.format_options_view WHERE format_code = '12-00750'),
  0::BIGINT,
  'gone sku format is not offered as an option'
);

-- Cache structure: the views are backed by materialized views the sweep refreshes.
SELECT is(
  (SELECT count(*)::INT FROM pg_matviews
   WHERE schemaname = 'public'
     AND matviewname IN ('facet_values_mv', 'facet_ranges_mv', 'format_options_mv')),
  3, 'the three facet caches exist as materialized views');
SELECT is(
  (SELECT count(*)::INT FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN ('facet_values_mv_key', 'facet_ranges_mv_key', 'format_options_mv_key')),
  3, 'each facet cache has the unique index REFRESH CONCURRENTLY needs');
SELECT ok(has_table_privilege('authenticated', 'public.facet_values_mv', 'SELECT'),
  'authenticated may read the facet cache the invoker view sits on');
SELECT ok(has_table_privilege('anon', 'public.format_options_mv', 'SELECT'),
  'anon retains facet access through the cache');

SELECT * FROM finish();
ROLLBACK;
