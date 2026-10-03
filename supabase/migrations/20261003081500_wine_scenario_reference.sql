-- Market-only scenario cache. Historic references remain owner-only and live.
-- The existing wine_scenario_view remains available for the two saved
-- definitions that still use release fields during their owner-led conversion.

CREATE MATERIALIZED VIEW public.wine_scenario_mv AS
SELECT
    'parent:' || c.parent_sku AS wine_ref,
    c.parent_sku,
    c.format_code,
    c.case_size,
    c.bottle_volume_ml,
    c.is_listed,
    c.ask AS lowest_ask_p,
    c.highest_bid_p,
    c.market_price_p,
    c.adjusted_guide_p,
    c.price_vs_market_pct,
    c.last_transaction_p,
    c.price_vs_last_pct,
    c.last_rest_checked_at,
    c.name,
    c.vintage,
    c.producer,
    c.country,
    c.region,
    c.subregion,
    c.colour,
    -- catalogue_mv contains only live SKU rows.
    TRUE AS is_biddable,
    round(c.ask::NUMERIC * 750
        / nullif(c.case_size::NUMERIC * c.bottle_volume_ml, 0))::INT
        AS lowest_ask_per_75cl_p,
    round(c.highest_bid_p::NUMERIC * 750
        / nullif(c.case_size::NUMERIC * c.bottle_volume_ml, 0))::INT
        AS highest_bid_per_75cl_p,
    round(c.market_price_p::NUMERIC * 750
        / nullif(c.case_size::NUMERIC * c.bottle_volume_ml, 0))::INT
        AS market_price_per_75cl_p
FROM public.catalogue_mv c;

CREATE UNIQUE INDEX wine_scenario_mv_key
    ON public.wine_scenario_mv (parent_sku, format_code);
REVOKE ALL ON public.wine_scenario_mv FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wine_scenario_mv TO authenticated;

CREATE VIEW public.wine_scenario_reference_view
WITH (security_invoker = TRUE)
AS
SELECT
    market.*,
    CASE WHEN market.bottle_volume_ml = 750
        THEN reference.price_per_75cl_p END AS reference_price_per_75cl_p,
    CASE WHEN market.bottle_volume_ml = 750
        THEN reference.resolution_kind END AS reference_resolution_kind,
    CASE WHEN market.bottle_volume_ml = 750
        THEN reference.source_kind END AS reference_source_kind,
    CASE WHEN market.bottle_volume_ml = 750
        THEN reference.reference_date END AS reference_date,
    CASE WHEN market.bottle_volume_ml = 750
        THEN reference.needs_review END AS reference_needs_review,
    CASE WHEN market.bottle_volume_ml = 750
        THEN reference.has_competing_evidence END AS reference_has_competing_evidence,
    CASE WHEN market.bottle_volume_ml = 750
        THEN round(100 * (
            market.lowest_ask_per_75cl_p - reference.price_per_75cl_p
        )::NUMERIC / nullif(reference.price_per_75cl_p, 0), 1)
    END AS ask_vs_reference_pct,
    CASE WHEN market.bottle_volume_ml = 750
        THEN round(100 * (
            market.highest_bid_per_75cl_p - reference.price_per_75cl_p
        )::NUMERIC / nullif(reference.price_per_75cl_p, 0), 1)
    END AS bid_vs_reference_pct
FROM public.wine_scenario_mv market
LEFT JOIN public.resolved_reference_price_view reference
  ON reference.parent_sku = market.parent_sku
WHERE (SELECT private.is_app_owner());

REVOKE ALL ON public.wine_scenario_reference_view
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wine_scenario_reference_view TO authenticated;

CREATE OR REPLACE FUNCTION private.rebuild_catalogue_caches()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW public.catalogue_mv;
    REFRESH MATERIALIZED VIEW public.wine_market_summary_mv;
    REFRESH MATERIALIZED VIEW public.wine_scenario_mv;
END;
$$;
