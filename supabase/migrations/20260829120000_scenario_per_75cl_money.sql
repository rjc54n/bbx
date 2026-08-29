-- Phase 1 of docs/PHASE8-scenario-query-engine.md: the typed unit boundary for
-- scenario filters. Money is stored as integer pence per case, but the owner
-- thinks and reads in pounds per 75cl-equivalent bottle -- that is the grain the
-- results table already shows, and the pack size (3/6/12) is not something the
-- owner tracks. A per-bottle threshold cannot be applied to a per-case column
-- without the per-row format, so the scenario surface has to expose the
-- per-75cl values as real columns for PostgREST to filter and sort on.
--
-- Same arithmetic as apps/web perBottleP and catalogue_mv's *_per_bottle_p:
--   round(value_p * 750 / (case_size * bottle_volume_ml)).
--
-- Appended to the end of wine_scenario_view so CREATE OR REPLACE keeps the
-- grants and the column order of everything else. The per-case columns stay --
-- the wine card and other consumers still read them; scenarios just stop
-- filtering on them.

CREATE OR REPLACE VIEW public.wine_scenario_view WITH (security_invoker = TRUE) AS
SELECT
    f.wine_ref,
    f.parent_sku,
    f.format_code,
    f.case_size,
    f.bottle_volume_ml,
    f.is_listed,
    f.lowest_ask_p,
    f.highest_bid_p,
    f.market_price_p,
    f.adjusted_guide_p,
    f.price_vs_market_pct,
    f.last_transaction_p,
    f.price_vs_last_pct,
    f.last_rest_checked_at,
    f.release_price_p,
    f.anchor_status,
    f.release_offer_date,
    f.ask_vs_release_p,
    f.ask_vs_release_pct,
    f.bid_vs_release_p,
    f.bid_vs_release_pct,
    -- Identity from the wine-level card view, for filtering and display.
    w.name,
    w.vintage,
    w.producer,
    w.country,
    w.region,
    w.subregion,
    w.colour,
    w.is_biddable,
    -- Per 75cl-equivalent bottle, in pence. NULL when the source value or the
    -- format dimensions are missing.
    round(f.lowest_ask_p::NUMERIC   * 750 / nullif(f.case_size::NUMERIC * f.bottle_volume_ml, 0))::INT AS lowest_ask_per_75cl_p,
    round(f.highest_bid_p::NUMERIC  * 750 / nullif(f.case_size::NUMERIC * f.bottle_volume_ml, 0))::INT AS highest_bid_per_75cl_p,
    round(f.market_price_p::NUMERIC * 750 / nullif(f.case_size::NUMERIC * f.bottle_volume_ml, 0))::INT AS market_price_per_75cl_p,
    round(f.release_price_p::NUMERIC * 750 / nullif(f.case_size::NUMERIC * f.bottle_volume_ml, 0))::INT AS release_price_per_75cl_p
FROM public.wine_card_format_view f
LEFT JOIN public.wine_card_view w ON w.parent_sku = f.parent_sku;
