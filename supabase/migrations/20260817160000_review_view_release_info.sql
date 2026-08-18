-- Surface the offer's release context on the match-review screen. The match
-- card grouped only source_wine/vintage/counts, so a terse row like "2012 Tinto"
-- hid the tasting note and price text that actually disambiguate the candidates.
-- Both already live on release_offer_source_rows and are exclusion-filtered here,
-- so the per-record review view is the right place to carry them.
--
-- CREATE OR REPLACE only permits appending columns, so tasting_notes and
-- description are added as the LAST two columns; everything above is an exact
-- copy of the current definition (20260730090000_import_owner_decisions.sql).

CREATE OR REPLACE VIEW public.release_offer_review_view
WITH (security_invoker = TRUE)
AS
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
    count(price.id) FILTER (WHERE price.parse_status = 'valid' AND price.tax_basis = 'in_bond')::INT AS valid_in_bond_fragment_count,
    count(price.id)::INT AS price_fragment_count,
    row.match_group_key,
    row.tasting_notes,
    row.description
FROM public.release_offer_source_rows row
JOIN public.release_offer_imports imports ON imports.id = row.import_id
LEFT JOIN public.release_offer_product_resolutions resolution
  ON resolution.import_id = row.import_id AND resolution.source_row_number = row.source_row_number
LEFT JOIN public.release_offer_prices price
  ON price.import_id = row.import_id AND price.source_row_number = row.source_row_number
WHERE imports.status = 'accepted'
  AND NOT EXISTS (
    SELECT 1
    FROM public.release_offer_record_exclusions exclusions
    WHERE exclusions.content_fingerprint = row.content_fingerprint
  )
GROUP BY row.import_id, row.source_row_number, row.offer_date, row.source_wine,
    row.source_vintage, row.source_price_text, row.source_product_id,
    row.source_product_url, resolution.status, resolution.parent_sku,
    resolution.match_method, row.match_group_key, row.tasting_notes, row.description;
