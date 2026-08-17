-- Surface last-transaction price on the wine card's per-format line. The card's
-- "Market now" table leads with "vs last tx" and demotes the format-adjusted
-- guide (docs/WINE-RECORD-SPEC.md step 1 follow-up), so the format view now
-- carries last_transaction_p / price_vs_last_pct straight from catalogue_view,
-- exactly as the catalogue browser reads them.
--
-- Only wine_card_format_view changes; wine_card_view is untouched. DROP..CREATE
-- (not CREATE OR REPLACE) so the new columns land in a clean, intentional order.

DROP VIEW IF EXISTS public.wine_card_format_view;

CREATE VIEW public.wine_card_format_view WITH (security_invoker = TRUE) AS
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
    a.release_price_p,
    a.anchor_status,
    a.offer_date AS release_offer_date,
    c.ask - a.release_price_p AS ask_vs_release_p,
    round(100 * (c.ask - a.release_price_p)::NUMERIC / NULLIF(a.release_price_p, 0), 1) AS ask_vs_release_pct,
    c.highest_bid_p - a.release_price_p AS bid_vs_release_p,
    round(100 * (c.highest_bid_p - a.release_price_p)::NUMERIC / NULLIF(a.release_price_p, 0), 1) AS bid_vs_release_pct
FROM public.catalogue_view c
LEFT JOIN public.release_price_anchor_view a
    ON a.parent_sku = c.parent_sku AND a.format_code = c.format_code;

REVOKE ALL ON public.wine_card_format_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wine_card_format_view TO authenticated;
