-- v1 owner release prices are in-bond only.
--
-- 20260817140000_owner_release_anchors accepted 'in_bond', 'duty_paid' and
-- 'unknown', but resolved_release_anchor_view drops tax_basis, so every
-- downstream ask/bid-vs-release metric compares a duty-paid or unknown owner
-- price against in-bond market prices as if they were equivalent (independent
-- review P1-2, docs/REVIEW-RESPONSE-2026-08-20.md). Until a real duty-paid
-- workflow and tax-aware comparison metrics exist, the smallest safe fix is to
-- accept in-bond owner prices only.
--
-- The tax_basis column and its three-value CHECK are kept so a later migration
-- can relax this without a schema change. The current live owner row is already
-- in bond, so the added constraint validates without touching data.

-- 1. Database layer: reject non-in-bond rows outright.
ALTER TABLE public.owner_release_anchors
    ADD CONSTRAINT owner_release_anchors_in_bond_only
    CHECK (tax_basis = 'in_bond');

-- 2. RPC layer: reject non-in-bond input before the write, and pin the stored
-- value to 'in_bond'. Body is identical to 20260817140000 except the tax-basis
-- validation and the pinned insert/update value; the signature is unchanged so
-- the existing grants carry over.
CREATE OR REPLACE FUNCTION public.set_owner_release_anchor(
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
    -- v1 accepts in-bond owner prices only. NULL defaults to in-bond; any other
    -- explicit value is rejected.
    IF coalesce(p_tax_basis, 'in_bond') <> 'in_bond' THEN
        RAISE EXCEPTION 'only in-bond owner release prices are accepted'
            USING ERRCODE = '22023';
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
        'parent:' || p_parent_sku, p_format_code, p_release_price_p, 'in_bond',
        p_offer_date, p_source_note, v_superseded, (SELECT auth.uid())
    )
    ON CONFLICT (wine_ref, format_code) DO UPDATE
    SET release_price_p = excluded.release_price_p,
        tax_basis = 'in_bond',
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
