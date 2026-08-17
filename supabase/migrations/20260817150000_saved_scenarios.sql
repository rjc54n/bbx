-- Step 5a of the canonical wine record (docs/WINE-RECORD-SPEC.md §12): saved
-- scenarios. wine_scenario_view is the single evaluate/display/agent surface --
-- the card's per-format metrics plus wine identity, one row per (parent_sku,
-- format_code). saved_scenarios stores a named {filters, sort} definition; it is
-- pure user data with no cross-table effects, so CRUD is RLS-gated direct rather
-- than through SECURITY DEFINER functions.

-- 1. Evaluation + display surface --------------------------------------------

CREATE VIEW public.wine_scenario_view WITH (security_invoker = TRUE) AS
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
    w.is_biddable
FROM public.wine_card_format_view f
LEFT JOIN public.wine_card_view w ON w.parent_sku = f.parent_sku;

REVOKE ALL ON public.wine_scenario_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wine_scenario_view TO authenticated;

-- 2. Saved scenarios ----------------------------------------------------------

CREATE TABLE public.saved_scenarios (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id),
    name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    -- The typed {filters, sort} definition. The app validates it against the
    -- filter registry on read and before write; the DB keeps only a shape guard.
    definition  JSONB NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX saved_scenarios_user_idx ON public.saved_scenarios (user_id, updated_at DESC);

-- Keep updated_at honest regardless of who writes (app now, agent later).
CREATE FUNCTION private.touch_saved_scenarios_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER touch_saved_scenarios_updated_at
BEFORE UPDATE ON public.saved_scenarios
FOR EACH ROW EXECUTE FUNCTION private.touch_saved_scenarios_updated_at();

ALTER TABLE public.saved_scenarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saved_scenarios FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_scenarios TO authenticated;

-- Owner-only, and every row is scoped to the owner's own user id.
CREATE POLICY "Owner reads own scenarios"
    ON public.saved_scenarios FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()) AND user_id = (SELECT auth.uid()));
CREATE POLICY "Owner inserts own scenarios"
    ON public.saved_scenarios FOR INSERT TO authenticated
    WITH CHECK ((SELECT private.is_app_owner()) AND user_id = (SELECT auth.uid()));
CREATE POLICY "Owner updates own scenarios"
    ON public.saved_scenarios FOR UPDATE TO authenticated
    USING ((SELECT private.is_app_owner()) AND user_id = (SELECT auth.uid()))
    WITH CHECK ((SELECT private.is_app_owner()) AND user_id = (SELECT auth.uid()));
CREATE POLICY "Owner deletes own scenarios"
    ON public.saved_scenarios FOR DELETE TO authenticated
    USING ((SELECT private.is_app_owner()) AND user_id = (SELECT auth.uid()));
