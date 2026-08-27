-- Response-time fix for /release-prices, measured at ~4s by the owner on
-- 27 August 2026. Separate from 20260827120000: that migration caches the
-- catalogue read model, which this page does not touch. This is a different
-- cause with a different fix.
--
-- release_offer_review_view (20260730090000) GROUP BYs twelve columns across
-- every accepted source row joined to release_offer_prices. The page then asks
-- for ORDER BY offer_date DESC ... LIMIT 100. A GROUP BY cannot be served by an
-- ordered index scan, so PostgreSQL aggregated the entire accepted corpus and
-- discarded all but one page of it -- and there was no index on
-- release_offer_source_rows(offer_date) for it to have used either way.

-- 1. Replace the GROUP BY with a correlated count ------------------------------
--
-- The aggregate existed only to count price fragments per row. As a LATERAL the
-- outer query keeps one row per source row, so ORDER BY ... LIMIT can stop after
-- 100 index entries instead of aggregating first.
--
-- count(*) inside the LATERAL is equivalent to the previous count(price.id) over
-- a LEFT JOIN: with no matching price rows the subquery counts zero rows, where
-- the LEFT JOIN produced one all-NULL row that count(price.id) did not count.
-- Both give 0. With matching rows, price.id is the primary key and never NULL,
-- so the two counts agree.
--
-- Columns, order and types are unchanged from the current definition
-- (20260817160000, which appended tasting_notes and description), so CREATE OR
-- REPLACE keeps the view's grants and its dependants (pending_favourite_view).

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

-- 2. Indexes -------------------------------------------------------------------

-- Matches the page's sort exactly -- offer_date DESC, then source_row_number and
-- import_id ascending -- so the first page is an index scan that stops at 100
-- rows. A prefix-only index would still have to sort within each offer_date.
CREATE INDEX idx_release_offer_rows_offer_date
    ON public.release_offer_source_rows (offer_date DESC, source_row_number, import_id);

-- release_offer_excluded_record_view drives from the exclusions table and probes
-- source rows by fingerprint; without this that is a sequential scan per
-- exclusion. The same page awaits an exact count over that view.
-- (The reverse direction, this view's own NOT EXISTS, is already served by
-- release_offer_record_exclusions' primary key.)
CREATE INDEX idx_release_offer_rows_content_fingerprint
    ON public.release_offer_source_rows (content_fingerprint);

-- The LATERAL probes prices by (import_id, source_row_number); the existing
-- UNIQUE (import_id, source_row_number, fragment_index) constraint already
-- indexes that prefix, so no further index is needed here.
