-- The catalogue home screen fires facet_values_view, facet_ranges_view and
-- format_options_view alongside the catalogue grid on every load. All three
-- were defined `FROM catalogue_view`, which recomputes a per-row LATERAL over
-- the offers order book and re-joins products/skus -- work these aggregates
-- never read. facet_values_view alone scanned catalogue_view five times (one
-- per UNION ALL branch), so a single home load evaluated the heavy view about
-- eight times and tipped facet_values_view into statement timeouts as the
-- catalogue grew.
--
-- Rebuild the three directly on the base tables. Every column they expose is a
-- plain skus/products field, and catalogue_view's row set is exactly
--   {skus with gone_since IS NULL that have a matching products row}
-- (its base is `FROM skus JOIN products`, and its two outer re-joins are 1:1 on
-- the primary keys), so the counts and ranges are identical -- only the cost
-- changes. skus/products moved to the private schema (20260729065629), so they
-- are referenced schema-qualified here; the views stay security_invoker, which
-- matches catalogue_view's existing access for the authenticated owner.

CREATE OR REPLACE VIEW public.facet_values_view
WITH (security_invoker = TRUE) AS
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
FROM catalogue_rows WHERE vintage IS NOT NULL GROUP BY vintage;

CREATE OR REPLACE VIEW public.facet_ranges_view
WITH (security_invoker = TRUE) AS
SELECT
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
WHERE s.gone_since IS NULL;

CREATE OR REPLACE VIEW public.format_options_view
WITH (security_invoker = TRUE) AS
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
GROUP BY s.format_code, s.case_size, s.bottle_volume_ml;
