-- Phase 2 revision, Phase D follow-up: add Vintage to the generic enum
-- facets, and expose format choices through their own typed view. A format is
-- the stored format_code, not a case-size/bottle-size pair assembled in the
-- browser: multi-selecting format codes can never create false combinations.

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
SELECT 'vintage', vintage::TEXT, COUNT(*)
FROM catalogue_view WHERE vintage IS NOT NULL GROUP BY vintage;

CREATE OR REPLACE VIEW format_options_view AS
SELECT
    format_code,
    case_size,
    bottle_volume_ml,
    COUNT(*) AS n
FROM catalogue_view
WHERE format_code IS NOT NULL
  AND case_size IS NOT NULL
  AND bottle_volume_ml IS NOT NULL
GROUP BY format_code, case_size, bottle_volume_ml;

REVOKE ALL ON format_options_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON format_options_view TO anon, authenticated;
