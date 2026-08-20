-- Cache the three global catalogue facet aggregates.
--
-- facet_values_view, facet_ranges_view and format_options_view are global (no
-- filter parameters) and aggregate only private.skus JOIN private.products,
-- which changes solely via the daily scan. Yet they are recomputed on every
-- catalogue load, and under signed-in load each spikes to 7-11s against the
-- authenticated role's 8s statement_timeout -- the intermittent catalogue
-- failure seen in UAT (independent performance review; 20260816120000 already
-- noted these tipping into timeouts).
--
-- Precompute each into a materialized view, refreshed after each daily sweep
-- (core/sweep.py). The existing public views are repointed to read the
-- materialized views, so the web app and generated types are unchanged -- the
-- views keep their names, columns and grants and simply become fast.
--
-- The materialized views hold non-sensitive global catalogue metadata (region /
-- colour / producer / vintage counts, price ranges, format options) and are
-- granted directly to the same roles that already read the facet views. They own
-- their data, so they cannot be security_invoker; the repointed public views
-- stay security_invoker and are the access surface the app uses.

-- 1. Materialized views: the exact SELECTs from 20260816120000 -----------------

CREATE MATERIALIZED VIEW public.facet_values_mv AS
WITH catalogue_rows AS (
    SELECT p.region, p.subregion, p.country, p.colour, p.vintage
    FROM private.skus s
    JOIN private.products p ON p.parent_sku = s.parent_sku
    WHERE s.gone_since IS NULL
)
SELECT 'region' AS facet, region AS value, COUNT(*) AS n
FROM catalogue_rows WHERE region IS NOT NULL GROUP BY region
UNION ALL
SELECT 'subregion', subregion, COUNT(*)
FROM catalogue_rows WHERE subregion IS NOT NULL GROUP BY subregion
UNION ALL
SELECT 'country', country, COUNT(*)
FROM catalogue_rows WHERE country IS NOT NULL GROUP BY country
UNION ALL
SELECT 'colour', colour, COUNT(*)
FROM catalogue_rows WHERE colour IS NOT NULL GROUP BY colour
UNION ALL
SELECT 'vintage', vintage::TEXT, COUNT(*)
FROM catalogue_rows WHERE vintage IS NOT NULL GROUP BY vintage
WITH DATA;

-- Every branch filters its value NOT NULL and groups by it, and the facet label
-- disambiguates the same string across facets, so (facet, value) is unique.
-- The unique index is also what REFRESH ... CONCURRENTLY requires.
CREATE UNIQUE INDEX facet_values_mv_key ON public.facet_values_mv (facet, value);

CREATE MATERIALIZED VIEW public.facet_ranges_mv AS
SELECT
    1 AS singleton,  -- the aggregate returns exactly one row; keys CONCURRENTLY refresh
    MIN(p.vintage) AS vintage_min,
    MAX(p.vintage) AS vintage_max,
    MIN(s.least_listing_price_p) AS ask_min,
    MAX(s.least_listing_price_p) AS ask_max,
    MIN(s.case_size) AS case_size_min,
    MAX(s.case_size) AS case_size_max,
    MIN(s.bottle_volume_ml) AS bottle_volume_ml_min,
    MAX(s.bottle_volume_ml) AS bottle_volume_ml_max,
    MIN(s.first_seen_at) AS first_seen_at_min,
    MAX(s.first_seen_at) AS first_seen_at_max,
    MIN(s.last_seen_at) AS last_seen_at_min,
    MAX(s.last_seen_at) AS last_seen_at_max
FROM private.skus s
JOIN private.products p ON p.parent_sku = s.parent_sku
WHERE s.gone_since IS NULL
WITH DATA;

CREATE UNIQUE INDEX facet_ranges_mv_key ON public.facet_ranges_mv (singleton);

CREATE MATERIALIZED VIEW public.format_options_mv AS
SELECT
    s.format_code,
    s.case_size,
    s.bottle_volume_ml,
    COUNT(*) AS n
FROM private.skus s
JOIN private.products p ON p.parent_sku = s.parent_sku
WHERE s.gone_since IS NULL
  AND s.format_code IS NOT NULL
  AND s.case_size IS NOT NULL
  AND s.bottle_volume_ml IS NOT NULL
GROUP BY s.format_code, s.case_size, s.bottle_volume_ml
WITH DATA;

CREATE UNIQUE INDEX format_options_mv_key
    ON public.format_options_mv (format_code, case_size, bottle_volume_ml);

-- 2. Grants: match the facet views the app already reads ----------------------

REVOKE ALL ON
    public.facet_values_mv, public.facet_ranges_mv, public.format_options_mv
    FROM PUBLIC;
GRANT SELECT ON
    public.facet_values_mv, public.facet_ranges_mv, public.format_options_mv
    TO anon, authenticated, service_role;

-- 3. Repoint the public views onto the caches ---------------------------------
-- Same column list, order and types as 20260816120000, so CREATE OR REPLACE
-- keeps the views' grants and the app/types unchanged. security_invoker stays,
-- reading the granted materialized views.

CREATE OR REPLACE VIEW public.facet_values_view
WITH (security_invoker = TRUE) AS
SELECT facet, value, n FROM public.facet_values_mv;

CREATE OR REPLACE VIEW public.facet_ranges_view
WITH (security_invoker = TRUE) AS
SELECT
    vintage_min, vintage_max, ask_min, ask_max,
    case_size_min, case_size_max, bottle_volume_ml_min, bottle_volume_ml_max,
    first_seen_at_min, first_seen_at_max, last_seen_at_min, last_seen_at_max
FROM public.facet_ranges_mv;

CREATE OR REPLACE VIEW public.format_options_view
WITH (security_invoker = TRUE) AS
SELECT format_code, case_size, bottle_volume_ml, n FROM public.format_options_mv;
