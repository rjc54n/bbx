CREATE TABLE public.release_price_favourites (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    parent_sku TEXT NOT NULL CHECK (parent_sku ~ '^\\d{5,30}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, parent_sku)
);

CREATE INDEX release_price_favourites_user_created_idx
    ON public.release_price_favourites (user_id, created_at DESC);

ALTER TABLE public.release_price_favourites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.release_price_favourites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.release_price_favourites TO authenticated;

CREATE POLICY "Owners manage their own release price favourites"
    ON public.release_price_favourites
    TO authenticated
    USING (
        (SELECT auth.uid()) = user_id
        AND (SELECT private.is_app_owner())
    )
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        AND (SELECT private.is_app_owner())
    );
