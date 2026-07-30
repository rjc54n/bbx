-- Favourites become a wine-level property rather than a release-prices one.
--
-- The old release_price_favourites table already had the right grain
-- (user_id, parent_sku) -- the wine, not the offer row. What it lacked was a
-- name that let other sources read it, and any way to star a wine before it
-- had been resolved to a Parent ID. Both are fixed here.
--
-- Two tables, because a favourite is set at two different states of knowledge:
--   wine_favourites     -- we know the Parent ID
--   pending_favourites  -- we don't yet, so hold the star against the source's
--                          match group and promote it when the link lands
--
-- Pending favourites key on match_group_key, not (import_id, source_row_number):
-- record coordinates are snapshot-scoped, so the next accepted CellarTracker
-- import would strand every pending star. match_group_key is import-independent
-- and is the grain the match-review screens already work at.

-- 1. wine_favourites, carrying the existing release-price favourites over.

CREATE TABLE public.wine_favourites (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    parent_sku TEXT NOT NULL CHECK (parent_sku ~ '^\d{5,30}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, parent_sku)
);

COMMENT ON TABLE public.wine_favourites IS
    'Owner favourites at Parent ID grain. Propagates to every source record that resolves to the wine.';

CREATE INDEX wine_favourites_user_created_idx
    ON public.wine_favourites (user_id, created_at DESC);

INSERT INTO public.wine_favourites (user_id, parent_sku, created_at)
SELECT user_id, parent_sku, created_at
FROM public.release_price_favourites;

DROP TABLE public.release_price_favourites;

ALTER TABLE public.wine_favourites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wine_favourites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.wine_favourites TO authenticated;

CREATE POLICY "Owners manage their own wine favourites"
    ON public.wine_favourites
    TO authenticated
    USING (
        (SELECT auth.uid()) = user_id
        AND (SELECT private.is_app_owner())
    )
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        AND (SELECT private.is_app_owner())
    );

-- 2. pending_favourites: starred source records with no Parent ID yet.

CREATE TABLE public.pending_favourites (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('cellartracker', 'release_offer')),
    match_group_key TEXT NOT NULL CHECK (char_length(match_group_key) BETWEEN 1 AND 1100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, source, match_group_key)
);

COMMENT ON TABLE public.pending_favourites IS
    'Favourites held against a source match group until it resolves to a Parent ID, then promoted to wine_favourites.';

CREATE INDEX pending_favourites_user_created_idx
    ON public.pending_favourites (user_id, created_at DESC);

CREATE INDEX pending_favourites_group_idx
    ON public.pending_favourites (source, match_group_key);

ALTER TABLE public.pending_favourites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pending_favourites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.pending_favourites TO authenticated;

CREATE POLICY "Owners manage their own pending favourites"
    ON public.pending_favourites
    TO authenticated
    USING (
        (SELECT auth.uid()) = user_id
        AND (SELECT private.is_app_owner())
    )
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        AND (SELECT private.is_app_owner())
    );

-- 3. Propagation.
--
-- On the resolution tables rather than in application code, so every link path
-- gets it: single-row manual link, match-group confirm, an auto-linked matching
-- run, and the exact-match backfill inside run_cellartracker_matching.
--
-- Rules:
--   link            promote pending -> wine, and drop the pending row
--   edit A -> B     favourite B if A was favourited; leave A alone, because
--                   un-favouriting on the owner's behalf is worse than a stray
--                   star, and the Favourites tab shows A with no linked records
--   unlink/suppress write the star back to pending so it stays on the row;
--                   never delete the wine favourite -- that is an explicit act
--
-- Every lookup is NULL-guarded and every write is ON CONFLICT DO NOTHING: a
-- favourite must never be able to fail a link, or a record deletion. Record
-- deletion cascades to the resolution, and the FK cascade runs after the
-- evidence row is gone, so match_group_key is legitimately NULL here.

CREATE FUNCTION private.sync_favourite_on_resolution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_source TEXT;
    v_key TEXT;
    v_import_id UUID;
    v_row_number INT;
BEGIN
    v_source := CASE TG_TABLE_NAME
        WHEN 'cellartracker_product_resolutions' THEN 'cellartracker'
        ELSE 'release_offer'
    END;

    IF TG_OP = 'DELETE' THEN
        v_import_id := OLD.import_id;
        v_row_number := OLD.source_row_number;
    ELSE
        v_import_id := NEW.import_id;
        v_row_number := NEW.source_row_number;
    END IF;

    IF v_source = 'cellartracker' THEN
        SELECT match_group_key INTO v_key
        FROM public.cellartracker_evidence
        WHERE import_id = v_import_id AND source_row_number = v_row_number;
    ELSE
        SELECT match_group_key INTO v_key
        FROM public.release_offer_source_rows
        WHERE import_id = v_import_id AND source_row_number = v_row_number;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.status = 'linked' AND NEW.parent_sku IS NOT NULL THEN
        IF v_key IS NOT NULL THEN
            INSERT INTO public.wine_favourites (user_id, parent_sku)
            SELECT user_id, NEW.parent_sku
            FROM public.pending_favourites
            WHERE source = v_source AND match_group_key = v_key
            ON CONFLICT DO NOTHING;

            DELETE FROM public.pending_favourites
            WHERE source = v_source AND match_group_key = v_key;
        END IF;

        IF TG_OP = 'UPDATE' THEN
            IF OLD.status = 'linked'
               AND OLD.parent_sku IS NOT NULL
               AND OLD.parent_sku <> NEW.parent_sku THEN
                INSERT INTO public.wine_favourites (user_id, parent_sku)
                SELECT user_id, NEW.parent_sku
                FROM public.wine_favourites
                WHERE parent_sku = OLD.parent_sku
                ON CONFLICT DO NOTHING;
            END IF;
        END IF;

        RETURN NULL;
    END IF;

    -- Anything that is not a live link: an ignored/suppressed insert has no
    -- previous wine to demote from, so it stops here.
    IF TG_OP = 'INSERT' THEN
        RETURN NULL;
    END IF;

    IF v_key IS NOT NULL AND OLD.status = 'linked' AND OLD.parent_sku IS NOT NULL THEN
        INSERT INTO public.pending_favourites (user_id, source, match_group_key)
        SELECT user_id, v_source, v_key
        FROM public.wine_favourites
        WHERE parent_sku = OLD.parent_sku
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_favourite_on_resolution()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_favourite_on_cellartracker_resolution
AFTER INSERT OR UPDATE OR DELETE ON public.cellartracker_product_resolutions
FOR EACH ROW EXECUTE FUNCTION private.sync_favourite_on_resolution();

CREATE TRIGGER sync_favourite_on_release_offer_resolution
AFTER INSERT OR UPDATE OR DELETE ON public.release_offer_product_resolutions
FOR EACH ROW EXECUTE FUNCTION private.sync_favourite_on_resolution();

-- 4. Expose match_group_key on the two review views, so a star can be set from
--    the record tables before a link exists. Appended, so existing column
--    positions are unchanged.

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
    market.highest_bid_per_bottle_p,
    evidence.match_group_key
FROM latest
JOIN public.cellartracker_evidence evidence ON evidence.import_id = latest.id
JOIN public.cellar_imports imports ON imports.id = latest.id
LEFT JOIN public.cellartracker_product_resolutions resolution
  ON resolution.import_id = evidence.import_id
 AND resolution.source_row_number = evidence.source_row_number
LEFT JOIN smallest ON smallest.parent_sku = resolution.parent_sku
LEFT JOIN normalised_market market ON market.parent_sku = resolution.parent_sku;

CREATE OR REPLACE VIEW public.release_offer_review_view
WITH (security_invoker = TRUE)
AS
SELECT
    row.import_id,
    row.source_row_number,
    row.offer_date,
    row.source_wine,
    row.source_vintage,
    row.source_price_text,
    row.source_product_id,
    row.source_product_url,
    resolution.status AS link_status,
    resolution.parent_sku,
    resolution.match_method,
    count(price.id) FILTER (WHERE price.parse_status = 'valid' AND price.tax_basis = 'in_bond')::INT AS valid_in_bond_fragment_count,
    count(price.id)::INT AS price_fragment_count,
    row.match_group_key
FROM public.release_offer_source_rows row
JOIN public.release_offer_imports imports ON imports.id = row.import_id
LEFT JOIN public.release_offer_product_resolutions resolution
  ON resolution.import_id = row.import_id AND resolution.source_row_number = row.source_row_number
LEFT JOIN public.release_offer_prices price
  ON price.import_id = row.import_id AND price.source_row_number = row.source_row_number
WHERE imports.status = 'accepted'
GROUP BY row.import_id, row.source_row_number, row.offer_date, row.source_wine,
    row.source_vintage, row.source_price_text, row.source_product_id,
    row.source_product_url, resolution.status, resolution.parent_sku, resolution.match_method,
    row.match_group_key;

-- 5. The Favourites tab: one row per favourited wine, everything we hold.
--
-- Money is 75cl-equivalent throughout, consistent with the CellarTracker page.
-- The guide is deliberately normalised the same way, which is what exposes it:
-- it is a constant £/litre per wine, so guide-per-bottle is flat across formats
-- while asks are not (see docs/ROADMAP-2026-07.md, finding 2).
--
-- Identity falls back through catalogue -> CellarTracker -> release offer,
-- because release offers match against BBR's wider prod_product catalogue: a
-- favourited Parent ID need not exist in the tracked book at all.

CREATE VIEW public.favourite_wine_view
WITH (security_invoker = TRUE)
AS
WITH smallest_format AS (
    SELECT DISTINCT ON (parent_sku)
        parent_sku, name, vintage, producer, country, region, subregion,
        colour, product_url, case_size, bottle_volume_ml, last_rest_checked_at
    FROM public.catalogue_view
    WHERE case_size > 0
    ORDER BY parent_sku, case_size
), market AS (
    SELECT
        parent_sku,
        count(*)::INT AS format_count,
        count(*) FILTER (WHERE is_listed)::INT AS listed_format_count,
        min(
            round(ask::NUMERIC * 750 / nullif(case_size::NUMERIC * bottle_volume_ml, 0))::INT
        ) FILTER (WHERE ask IS NOT NULL) AS lowest_ask_per_bottle_p,
        max(
            round(highest_bid_p::NUMERIC * 750 / nullif(case_size::NUMERIC * bottle_volume_ml, 0))::INT
        ) FILTER (WHERE highest_bid_p IS NOT NULL) AS highest_bid_per_bottle_p,
        max(
            round(market_price_p::NUMERIC * 750 / nullif(case_size::NUMERIC * bottle_volume_ml, 0))::INT
        ) FILTER (WHERE market_price_p IS NOT NULL) AS guide_per_bottle_p,
        -- catalogue_view already corrects the guide for format premium; carry
        -- both so the tab can show the raw guide's flatness against it.
        max(
            round(adjusted_guide_p::NUMERIC * 750 / nullif(case_size::NUMERIC * bottle_volume_ml, 0))::INT
        ) FILTER (WHERE adjusted_guide_p IS NOT NULL) AS adjusted_guide_per_bottle_p
    FROM public.catalogue_view
    WHERE case_size > 0 AND bottle_volume_ml > 0
    GROUP BY parent_sku
), latest_release AS (
    SELECT DISTINCT ON (parent_sku)
        parent_sku,
        offer_date AS latest_release_offer_date,
        anchor_status,
        round(
            release_price_p::NUMERIC * 750
            / nullif(case_size::NUMERIC * bottle_volume_ml, 0)
        )::INT AS latest_release_price_per_bottle_p,
        ask_vs_release_pct,
        bid_vs_release_pct
    FROM public.release_price_market_view
    ORDER BY parent_sku, offer_date DESC, release_offer_price_id DESC
), cellartracker AS (
    SELECT
        parent_sku,
        count(*)::INT AS cellartracker_record_count,
        sum(quantity_home)::INT AS cellartracker_bottles_home,
        sum(quantity_bbr)::INT AS cellartracker_bottles_bbr,
        round(avg(purchase_price_per_bottle_p) FILTER (WHERE purchase_price_per_bottle_p IS NOT NULL))::INT
            AS cellartracker_paid_per_bottle_p,
        min(source_wine) AS source_wine,
        min(vintage) AS vintage,
        min(producer) AS producer
    FROM public.current_cellartracker_records
    WHERE parent_sku IS NOT NULL
    GROUP BY parent_sku
), bbr_cellar AS (
    SELECT
        parent_sku,
        count(*)::INT AS bbr_cellar_holding_count,
        sum(quantity_bottles)::INT AS bbr_cellar_bottles,
        min(description) AS description
    FROM public.current_bbr_holdings
    GROUP BY parent_sku
), offers AS (
    SELECT
        resolution.parent_sku,
        count(*)::INT AS release_offer_record_count,
        min(row.source_wine) AS source_wine,
        min(row.source_vintage) AS vintage
    FROM public.release_offer_product_resolutions resolution
    JOIN public.release_offer_source_rows row
      ON row.import_id = resolution.import_id
     AND row.source_row_number = resolution.source_row_number
    WHERE resolution.status = 'linked' AND resolution.parent_sku IS NOT NULL
    GROUP BY resolution.parent_sku
)
SELECT
    favourite.user_id,
    favourite.parent_sku,
    favourite.created_at AS favourited_at,
    coalesce(
        catalogue.name,
        cellartracker.source_wine,
        offers.source_wine,
        bbr_cellar.description
    ) AS wine_name,
    coalesce(catalogue.vintage, cellartracker.vintage, offers.vintage) AS vintage,
    coalesce(catalogue.producer, cellartracker.producer) AS producer,
    catalogue.country,
    catalogue.region,
    catalogue.subregion,
    catalogue.colour,
    catalogue.product_url,
    catalogue.parent_sku IS NOT NULL AS in_tracked_catalogue,
    coalesce(market.format_count, 0) AS format_count,
    coalesce(market.listed_format_count, 0) AS listed_format_count,
    market.lowest_ask_per_bottle_p,
    market.highest_bid_per_bottle_p,
    market.guide_per_bottle_p,
    market.adjusted_guide_per_bottle_p,
    latest_release.latest_release_offer_date,
    latest_release.latest_release_price_per_bottle_p,
    latest_release.anchor_status,
    latest_release.ask_vs_release_pct,
    latest_release.bid_vs_release_pct,
    -- Kept separate on purpose: CellarTracker's BBR quantity and the BBR
    -- cellar holdings describe the same bottles from two sources. Summing them
    -- would double count.
    coalesce(cellartracker.cellartracker_bottles_home, 0) AS cellartracker_bottles_home,
    coalesce(cellartracker.cellartracker_bottles_bbr, 0) AS cellartracker_bottles_bbr,
    cellartracker.cellartracker_paid_per_bottle_p,
    coalesce(cellartracker.cellartracker_record_count, 0) AS cellartracker_record_count,
    coalesce(bbr_cellar.bbr_cellar_bottles, 0) AS bbr_cellar_bottles,
    coalesce(bbr_cellar.bbr_cellar_holding_count, 0) AS bbr_cellar_holding_count,
    coalesce(offers.release_offer_record_count, 0) AS release_offer_record_count
FROM public.wine_favourites favourite
LEFT JOIN smallest_format catalogue ON catalogue.parent_sku = favourite.parent_sku
LEFT JOIN market ON market.parent_sku = favourite.parent_sku
LEFT JOIN latest_release ON latest_release.parent_sku = favourite.parent_sku
LEFT JOIN cellartracker ON cellartracker.parent_sku = favourite.parent_sku
LEFT JOIN bbr_cellar ON bbr_cellar.parent_sku = favourite.parent_sku
LEFT JOIN offers ON offers.parent_sku = favourite.parent_sku;

COMMENT ON VIEW public.favourite_wine_view IS
    'One row per favourited wine with 75cl-normalised market, release and holding figures.';

REVOKE ALL ON public.favourite_wine_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.favourite_wine_view TO authenticated;

-- 6. Pending favourites, resolved to what the source knows about them: a work
--    queue of wines we care about that the pipeline has not identified yet.

CREATE VIEW public.pending_favourite_view
WITH (security_invoker = TRUE)
AS
WITH cellartracker AS (
    SELECT
        record.match_group_key,
        count(*)::INT AS record_count,
        min(record.source_wine) AS source_wine,
        min(record.vintage) AS vintage,
        min(record.producer) AS producer,
        sum(record.quantity_home + record.quantity_bbr)::INT AS bottles
    FROM public.current_cellartracker_records record
    WHERE record.link_status IS NULL
    GROUP BY record.match_group_key
), release_offers AS (
    SELECT
        review.match_group_key,
        count(*)::INT AS record_count,
        min(review.source_wine) AS source_wine,
        min(review.source_vintage) AS vintage,
        max(review.offer_date) AS latest_offer_date
    FROM public.release_offer_review_view review
    WHERE review.link_status IS NULL
    GROUP BY review.match_group_key
), cellartracker_suggestions AS (
    SELECT match_group_key, count(*)::INT AS suggestion_count
    FROM public.cellartracker_match_suggestions
    GROUP BY match_group_key
), release_offer_suggestions AS (
    SELECT match_group_key, count(*)::INT AS suggestion_count
    FROM public.release_offer_match_suggestions
    GROUP BY match_group_key
)
SELECT
    favourite.user_id,
    favourite.source,
    favourite.match_group_key,
    favourite.created_at AS favourited_at,
    coalesce(cellartracker.source_wine, release_offers.source_wine) AS source_wine,
    coalesce(cellartracker.vintage, release_offers.vintage) AS vintage,
    cellartracker.producer,
    coalesce(cellartracker.record_count, release_offers.record_count, 0) AS record_count,
    cellartracker.bottles,
    release_offers.latest_offer_date,
    coalesce(
        cellartracker_suggestions.suggestion_count,
        release_offer_suggestions.suggestion_count,
        0
    ) AS suggestion_count,
    -- A pending favourite whose group no longer appears unlinked in the current
    -- snapshot is stale: the rows were deleted, or a newer import dropped them.
    coalesce(cellartracker.record_count, release_offers.record_count) IS NULL AS is_stale
FROM public.pending_favourites favourite
LEFT JOIN cellartracker
  ON favourite.source = 'cellartracker'
 AND cellartracker.match_group_key = favourite.match_group_key
LEFT JOIN release_offers
  ON favourite.source = 'release_offer'
 AND release_offers.match_group_key = favourite.match_group_key
LEFT JOIN cellartracker_suggestions
  ON favourite.source = 'cellartracker'
 AND cellartracker_suggestions.match_group_key = favourite.match_group_key
LEFT JOIN release_offer_suggestions
  ON favourite.source = 'release_offer'
 AND release_offer_suggestions.match_group_key = favourite.match_group_key;

COMMENT ON VIEW public.pending_favourite_view IS
    'Favourited source match groups awaiting a Parent ID, with what the source knows and whether candidates exist.';

REVOKE ALL ON public.pending_favourite_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pending_favourite_view TO authenticated;
