-- Phase 5E: owner-only current BBR holdings joined to the latest BBX
-- product-format market state. Imported BBX prices remain immutable source
-- evidence; this view deliberately exposes the scanner values instead.

CREATE VIEW public.bbr_cellar_market_view
WITH (security_invoker = TRUE)
AS
SELECT
    h.import_id,
    h.confirmed_at,
    h.source_row_number,
    h.parent_sku,
    h.format_code,
    h.product_code,
    h.description,
    h.country,
    h.region,
    h.vintage,
    h.colour,
    h.maturity,
    h.drinking_window_from,
    h.drinking_window_to,
    h.bottle_volume_ml,
    h.quantity_bottles,
    h.eligible_for_bbx,
    h.purchase_price_per_case_p,
    h.case_size,
    h.current_status,
    c.name AS catalogue_name,
    c.producer,
    c.product_url,
    c.is_listed,
    c.highest_bid_p,
    c.ask AS lowest_ask_p,
    c.market_price_p,
    c.last_rest_checked_at
FROM public.current_bbr_holdings h
LEFT JOIN public.catalogue_view c
    ON c.parent_sku = h.parent_sku
   AND c.format_code = h.format_code;

COMMENT ON VIEW public.bbr_cellar_market_view IS
    'Latest accepted owner BBR holdings with current scanner market values at exact product-format grain.';

REVOKE ALL ON public.bbr_cellar_market_view
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bbr_cellar_market_view TO authenticated;
