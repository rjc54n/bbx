-- CellarTracker purchase prices are stored per 75cl bottle. Convert every BBX
-- format to the same basis before choosing the lowest ask and highest bid.

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
), smallest AS (
    -- Preserve the existing descriptive case-size and listing-status fields.
    SELECT DISTINCT ON (parent_sku)
        parent_sku, case_size, is_listed
    FROM public.catalogue_view
    WHERE case_size > 0
    ORDER BY parent_sku, case_size
), normalised_market AS (
    SELECT
        parent_sku,
        min(
            round(
                ask::NUMERIC * 750
                / nullif(case_size::NUMERIC * bottle_volume_ml, 0)
            )::INT
        ) FILTER (WHERE ask IS NOT NULL) AS lowest_ask_per_bottle_p,
        max(
            round(
                highest_bid_p::NUMERIC * 750
                / nullif(case_size::NUMERIC * bottle_volume_ml, 0)
            )::INT
        ) FILTER (WHERE highest_bid_p IS NOT NULL) AS highest_bid_per_bottle_p
    FROM public.catalogue_view
    WHERE case_size > 0
      AND bottle_volume_ml > 0
    GROUP BY parent_sku
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
    smallest.case_size,
    smallest.is_listed,
    market.lowest_ask_per_bottle_p,
    market.highest_bid_per_bottle_p
FROM latest
JOIN public.cellartracker_evidence evidence ON evidence.import_id = latest.id
JOIN public.cellar_imports imports ON imports.id = latest.id
LEFT JOIN public.cellartracker_product_resolutions resolution
  ON resolution.import_id = evidence.import_id
 AND resolution.source_row_number = evidence.source_row_number
LEFT JOIN smallest ON smallest.parent_sku = resolution.parent_sku
LEFT JOIN normalised_market market ON market.parent_sku = resolution.parent_sku;

REVOKE ALL ON public.current_cellartracker_records FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.current_cellartracker_records TO authenticated;
