-- Carry the offer's tasting note through to the wine card. The note lives on
-- release_offer_source_rows.tasting_notes; the evidence view is the one place
-- that already filters excluded/unlinked offers, so the card should read the
-- note from here rather than querying the raw source rows.
--
-- CREATE OR REPLACE only permits appending columns, so tasting_notes is added
-- as the LAST column of the ranked CTE (after duplicate_rank). Everything above
-- it is an exact copy of the current definition
-- (20260730090000_import_owner_decisions.sql).

CREATE OR REPLACE VIEW public.release_offer_evidence_view
WITH (security_invoker = TRUE)
AS
WITH ranked AS (
    SELECT price.id AS release_offer_price_id, row.import_id, row.source_row_number,
        resolution.parent_sku, price.format_code, row.offer_date, row.source_wine,
        row.source_product_url, price.amount_p AS release_price_p, price.case_size,
        price.bottle_volume_ml, price.tax_basis, resolution.match_method, row.source_message_id,
        row.content_fingerprint,
        row_number() OVER (PARTITION BY resolution.parent_sku, price.format_code, row.offer_date, price.amount_p ORDER BY imports.accepted_at, row.import_id, row.source_row_number, price.fragment_index) AS duplicate_rank,
        row.tasting_notes
    FROM public.release_offer_prices price
    JOIN public.release_offer_source_rows row ON row.import_id = price.import_id AND row.source_row_number = price.source_row_number
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    JOIN public.release_offer_product_resolutions resolution ON resolution.import_id = row.import_id AND resolution.source_row_number = row.source_row_number
    WHERE imports.status = 'accepted' AND resolution.status = 'linked'
      AND price.parse_status = 'valid' AND price.tax_basis = 'in_bond'
      AND NOT EXISTS (
        SELECT 1
        FROM public.release_offer_record_exclusions exclusions
        WHERE exclusions.content_fingerprint = row.content_fingerprint
      )
) SELECT * FROM ranked WHERE duplicate_rank = 1;
