CREATE VIEW public.release_offer_review_view
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
    count(price.id)::INT AS price_fragment_count
FROM public.release_offer_source_rows row
JOIN public.release_offer_imports imports ON imports.id = row.import_id
LEFT JOIN public.release_offer_product_resolutions resolution
  ON resolution.import_id = row.import_id AND resolution.source_row_number = row.source_row_number
LEFT JOIN public.release_offer_prices price
  ON price.import_id = row.import_id AND price.source_row_number = row.source_row_number
WHERE imports.status = 'accepted'
GROUP BY row.import_id, row.source_row_number, row.offer_date, row.source_wine,
    row.source_vintage, row.source_price_text, row.source_product_id,
    row.source_product_url, resolution.status, resolution.parent_sku, resolution.match_method;

REVOKE ALL ON public.release_offer_review_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.release_offer_review_view TO authenticated;
