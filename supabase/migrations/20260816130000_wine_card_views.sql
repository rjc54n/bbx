-- Step 1 of the canonical wine record (docs/WINE-RECORD-SPEC.md): the two
-- virtual card views behind /wine/parent/[parentSku]. Biddable-only for now --
-- every row's wine_ref is 'parent:' || parent_sku. Off-catalogue (local:) wines
-- and owner-fact precedence arrive in later steps.
--
-- Both stay security_invoker to match catalogue_view's access: the authenticated
-- owner already reads private.products / private.skus through it. DROP..CREATE
-- (not CREATE OR REPLACE) so a re-run gets the exact column order below.

DROP VIEW IF EXISTS public.wine_card_format_view;
DROP VIEW IF EXISTS public.wine_card_view;

CREATE VIEW public.wine_card_view WITH (security_invoker = TRUE) AS
SELECT
    'parent:' || p.parent_sku AS wine_ref,
    p.parent_sku,
    p.name,
    p.vintage,
    p.producer,
    p.country,
    p.region,
    p.subregion,
    p.colour,
    p.product_url,
    EXISTS (
        SELECT 1 FROM private.skus s
        WHERE s.parent_sku = p.parent_sku AND s.gone_since IS NULL
    ) AS is_biddable
FROM private.products p;

-- Catalogue-driven so every live format appears even with no release anchor.
-- The ask_vs_release_* / bid_vs_release_* metrics are computed exactly as
-- release_price_market_view does, so the card and the arbitrage view agree.
--
-- Step-3 seam: swap release_price_anchor_view for a resolved anchor view that
-- puts owner_release_anchors ahead of imported anchors. Only the JOIN target
-- below changes; the projected columns and metrics stay identical.
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

REVOKE ALL ON public.wine_card_view, public.wine_card_format_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wine_card_view, public.wine_card_format_view TO authenticated;
