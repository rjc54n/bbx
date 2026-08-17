-- Step 3 of the canonical wine record (docs/WINE-RECORD-SPEC.md §11): the first
-- owner-fact write. owner_release_anchors lets the owner supply or override a
-- release price per (parent_sku, format_code); resolved_release_anchor_view
-- ranks that owner price above the imported anchor; and the two metric consumers
-- (release_price_market_view, wine_card_format_view) repoint onto it so the
-- catalogue arbitrage, favourites and the wine card all reflect the owner price.
--
-- release_price_anchor_view is left untouched: it stays the pure imported
-- resolution the confirm/reset UI drives. Owner precedence is a wrapper on top.

-- 1. Owner release anchors ----------------------------------------------------

CREATE TABLE public.owner_release_anchors (
    -- Canonical wine reference. Step 3 is biddable-only, so it is always
    -- 'parent:' || parent_sku; the CHECK documents that until step 4 relaxes it.
    wine_ref                  TEXT NOT NULL CHECK (wine_ref LIKE 'parent:%'),
    format_code               TEXT NOT NULL,
    release_price_p           INT  NOT NULL CHECK (release_price_p > 0),  -- per case, GBP pence
    tax_basis                 TEXT NOT NULL DEFAULT 'in_bond'
                                CHECK (tax_basis IN ('in_bond', 'duty_paid', 'unknown')),
    offer_date                DATE,
    source_note               TEXT CHECK (char_length(source_note) <= 1000),
    -- The imported anchor value this owner price overrode, captured at write
    -- time (NULL when the import had missed the price entirely). Same
    -- source-value retention idea as cellartracker_record_decisions: it lets a
    -- later import tell "the feed now agrees with me" from "the feed changed".
    superseded_source_price_p INT CHECK (superseded_source_price_p > 0),
    decided_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by                UUID REFERENCES auth.users(id),
    PRIMARY KEY (wine_ref, format_code)
);

ALTER TABLE public.owner_release_anchors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_release_anchors FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.owner_release_anchors TO authenticated;
CREATE POLICY "Owner reads release anchors"
    ON public.owner_release_anchors
    FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));

-- 2. Resolved anchor: owner ahead of imported --------------------------------

-- Same column shape as release_price_anchor_view, but release_offer_price_id is
-- now nullable (owner anchors have no source price row) and anchor_status gains
-- 'owner' as the top rank. security_invoker, so the owner-only RLS on
-- owner_release_anchors is what scopes the owner branch.
CREATE VIEW public.resolved_release_anchor_view WITH (security_invoker = TRUE) AS
SELECT
    split_part(oa.wine_ref, ':', 2) AS parent_sku,
    oa.format_code,
    'owner'::TEXT AS anchor_status,
    NULL::BIGINT AS release_offer_price_id,
    oa.offer_date,
    oa.release_price_p,
    NULL::TEXT AS source_wine,
    NULL::TEXT AS source_product_url
FROM public.owner_release_anchors oa
WHERE oa.wine_ref LIKE 'parent:%'
UNION ALL
SELECT
    a.parent_sku,
    a.format_code,
    a.anchor_status,
    a.release_offer_price_id,
    a.offer_date,
    a.release_price_p,
    a.source_wine,
    a.source_product_url
FROM public.release_price_anchor_view a
WHERE NOT EXISTS (
    SELECT 1 FROM public.owner_release_anchors o
    WHERE o.wine_ref = 'parent:' || a.parent_sku
      AND o.format_code = a.format_code
);

REVOKE ALL ON public.resolved_release_anchor_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.resolved_release_anchor_view TO authenticated;

-- 3. Repoint the two metric consumers onto the resolved anchor ----------------

-- release_price_market_view: identical to its current definition
-- (20260727095324) except the anchor source. Every derived metric recomputes
-- off the resolved (owner-or-imported) release price.
CREATE OR REPLACE VIEW public.release_price_market_view WITH (security_invoker = TRUE) AS
SELECT anchor.parent_sku, anchor.format_code, anchor.anchor_status, anchor.release_offer_price_id, anchor.offer_date, anchor.release_price_p, anchor.source_wine, anchor.source_product_url,
    catalogue.name, catalogue.vintage, catalogue.region, catalogue.colour, catalogue.producer, catalogue.product_url, catalogue.case_size, catalogue.bottle_volume_ml, catalogue.is_listed, catalogue.ask AS lowest_ask_p, catalogue.highest_bid_p, catalogue.market_price_p, catalogue.last_rest_checked_at,
    catalogue.ask - anchor.release_price_p AS ask_vs_release_p, round(100 * (catalogue.ask - anchor.release_price_p)::NUMERIC / NULLIF(anchor.release_price_p, 0), 1) AS ask_vs_release_pct,
    catalogue.highest_bid_p - anchor.release_price_p AS bid_vs_release_p, round(100 * (catalogue.highest_bid_p - anchor.release_price_p)::NUMERIC / NULLIF(anchor.release_price_p, 0), 1) AS bid_vs_release_pct,
    floor(catalogue.highest_bid_p * (1 - fee.seller_commission_rate))::INT AS seller_net_highest_bid_p,
    (ceil(anchor.release_price_p / ((1 - fee.seller_commission_rate) * 100)) * 100)::INT AS recoup_bid_p, fee.seller_commission_rate
FROM public.resolved_release_anchor_view anchor LEFT JOIN public.catalogue_view catalogue ON catalogue.parent_sku = anchor.parent_sku AND catalogue.format_code = anchor.format_code
CROSS JOIN LATERAL (SELECT seller_commission_rate FROM public.bbx_fee_schedule WHERE effective_from <= current_date ORDER BY effective_from DESC LIMIT 1) fee;

-- wine_card_format_view: identical to 20260817120000 except the anchor join
-- target. Columns and order unchanged, so CREATE OR REPLACE keeps its grants.
CREATE OR REPLACE VIEW public.wine_card_format_view WITH (security_invoker = TRUE) AS
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
LEFT JOIN public.resolved_release_anchor_view a
    ON a.parent_sku = c.parent_sku AND a.format_code = c.format_code;

-- 4. Write functions ----------------------------------------------------------

-- Set or overwrite the owner's release anchor for one format. Snapshots the
-- imported anchor being superseded on first write, and keeps that original value
-- across later edits (it is still the number the feed supplied).
CREATE FUNCTION public.set_owner_release_anchor(
    p_parent_sku TEXT,
    p_format_code TEXT,
    p_release_price_p INT,
    p_tax_basis TEXT DEFAULT 'in_bond',
    p_offer_date DATE DEFAULT NULL,
    p_source_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_superseded INT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF p_parent_sku IS NULL OR p_format_code IS NULL
       OR p_release_price_p IS NULL OR p_release_price_p <= 0 THEN
        RAISE EXCEPTION 'valid parent, format and a positive price are required'
            USING ERRCODE = '22023';
    END IF;
    IF p_tax_basis IS NULL OR p_tax_basis NOT IN ('in_bond', 'duty_paid', 'unknown') THEN
        RAISE EXCEPTION 'invalid tax basis' USING ERRCODE = '22023';
    END IF;
    -- The format must be a real one for this wine.
    IF NOT EXISTS (
        SELECT 1 FROM private.skus s
        WHERE s.parent_sku = p_parent_sku AND s.format_code = p_format_code
    ) THEN
        RAISE EXCEPTION 'format not found for this wine' USING ERRCODE = 'P0002';
    END IF;

    SELECT release_price_p INTO v_superseded
    FROM public.release_price_anchor_view
    WHERE parent_sku = p_parent_sku AND format_code = p_format_code;

    INSERT INTO public.owner_release_anchors AS oa (
        wine_ref, format_code, release_price_p, tax_basis, offer_date, source_note,
        superseded_source_price_p, decided_by
    ) VALUES (
        'parent:' || p_parent_sku, p_format_code, p_release_price_p, p_tax_basis,
        p_offer_date, p_source_note, v_superseded, (SELECT auth.uid())
    )
    ON CONFLICT (wine_ref, format_code) DO UPDATE
    SET release_price_p = excluded.release_price_p,
        tax_basis = excluded.tax_basis,
        offer_date = excluded.offer_date,
        source_note = excluded.source_note,
        -- Keep the first genuine imported value across re-edits.
        superseded_source_price_p = coalesce(oa.superseded_source_price_p, excluded.superseded_source_price_p),
        decided_at = now(),
        decided_by = excluded.decided_by;

    RETURN jsonb_build_object(
        'parent_sku', p_parent_sku,
        'format_code', p_format_code,
        'release_price_p', p_release_price_p,
        'superseded_source_price_p', v_superseded
    );
END;
$$;

-- Remove the owner anchor, reverting the format to its imported anchor.
CREATE FUNCTION public.clear_owner_release_anchor(
    p_parent_sku TEXT,
    p_format_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF p_parent_sku IS NULL OR p_format_code IS NULL THEN
        RAISE EXCEPTION 'valid parent and format are required' USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.owner_release_anchors
    WHERE wine_ref = 'parent:' || p_parent_sku AND format_code = p_format_code;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN jsonb_build_object('cleared', v_count > 0);
END;
$$;

REVOKE ALL ON FUNCTION
    public.set_owner_release_anchor(TEXT, TEXT, INT, TEXT, DATE, TEXT),
    public.clear_owner_release_anchor(TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.set_owner_release_anchor(TEXT, TEXT, INT, TEXT, DATE, TEXT),
    public.clear_owner_release_anchor(TEXT, TEXT)
    TO authenticated;
