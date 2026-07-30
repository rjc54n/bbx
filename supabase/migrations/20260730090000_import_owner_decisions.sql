-- Owner decisions survive the next upload.
--
-- Every source in this application is import-scoped: links, price corrections
-- and deletions are all keyed to (import_id, source_row_number). That is right
-- for evidence -- a row belongs to the file it came from -- but wrong for a
-- decision the owner made about a wine. CellarTracker is a full-snapshot
-- source, so the next accepted file previously arrived with no links, no price
-- corrections and every deleted record restored. Release offers accumulate
-- rather than replace, but a later file repeating a deleted row reintroduced
-- it just the same.
--
-- This migration adds a durable decision layer keyed on identifiers that
-- survive re-import: match_group_key plus the source wine text for
-- CellarTracker, and the content fingerprint for release offers. Exclusions
-- are enforced by filtering the read views rather than by deleting rows, so
-- an exclusion is reversible and a future import that contains the record
-- again is filtered without any accept-time work.

-- 1. CellarTracker owner decisions -------------------------------------------

CREATE TABLE public.cellartracker_record_decisions (
    match_group_key TEXT NOT NULL,
    source_wine TEXT NOT NULL,
    link_status TEXT CHECK (link_status IN ('linked', 'suppressed')),
    parent_sku TEXT,
    match_method TEXT,
    -- The owner's corrected price, and the file value it replaced. Keeping the
    -- source value lets a later import tell "CellarTracker still reports the
    -- number I corrected" from "CellarTracker has changed this row", and only
    -- the first is safe to override silently.
    purchase_price_per_bottle_p INT CHECK (purchase_price_per_bottle_p >= 0),
    source_price_per_bottle_p INT CHECK (source_price_per_bottle_p >= 0),
    is_excluded BOOLEAN NOT NULL DEFAULT FALSE,
    excluded_at TIMESTAMPTZ,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by UUID REFERENCES auth.users(id),
    PRIMARY KEY (match_group_key, source_wine),
    CHECK (
        link_status IS NULL
        OR (link_status = 'linked' AND parent_sku IS NOT NULL)
        OR (link_status = 'suppressed' AND parent_sku IS NULL)
    ),
    CHECK (is_excluded = (excluded_at IS NOT NULL))
);

CREATE INDEX cellartracker_record_decisions_excluded_idx
    ON public.cellartracker_record_decisions (excluded_at DESC)
    WHERE is_excluded;

ALTER TABLE public.cellartracker_record_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cellartracker_record_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cellartracker_record_decisions TO authenticated;
CREATE POLICY "Owner reads CellarTracker decisions"
    ON public.cellartracker_record_decisions
    FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));

-- 2. Release-offer exclusions -------------------------------------------------

-- The content fingerprint is derived from the row itself, so the same offer in
-- a later file carries the same fingerprint and stays excluded without any
-- import-time bookkeeping.
CREATE TABLE public.release_offer_record_exclusions (
    content_fingerprint TEXT PRIMARY KEY
        CHECK (content_fingerprint ~ '^[0-9a-f]{64}$'),
    match_group_key TEXT,
    source_wine TEXT,
    offer_date DATE,
    excluded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    excluded_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.release_offer_record_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.release_offer_record_exclusions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.release_offer_record_exclusions TO authenticated;
CREATE POLICY "Owner reads release-offer exclusions"
    ON public.release_offer_record_exclusions
    FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));

-- 3. Links become decisions as they are made ----------------------------------

-- Eight functions write cellartracker_product_resolutions (auto-link, group
-- confirm, group edit, suppress, restore, per-record manual link, unlink and
-- the Algolia exact backfill). A trigger records the decision once for all of
-- them, in the same shape as the existing audit trigger on this table.
CREATE FUNCTION private.record_cellartracker_link_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_import_id UUID;
    v_row_number INT;
    v_key TEXT;
    v_wine TEXT;
BEGIN
    -- Carry-forward re-applies stored decisions to a new snapshot. Recording
    -- them again would only rewrite each row with its own values and move
    -- decided_at, hiding when the owner actually decided.
    IF current_setting('app.cellartracker_carry_forward', TRUE) = 'on' THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_import_id := OLD.import_id;
        v_row_number := OLD.source_row_number;
    ELSE
        v_import_id := NEW.import_id;
        v_row_number := NEW.source_row_number;
    END IF;

    SELECT evidence.match_group_key, evidence.source_wine
    INTO v_key, v_wine
    FROM public.cellartracker_evidence evidence
    WHERE evidence.import_id = v_import_id
      AND evidence.source_row_number = v_row_number;

    -- A cascade from a deleted evidence row leaves nothing to key against.
    IF v_key IS NULL THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'DELETE' THEN
        UPDATE public.cellartracker_record_decisions
        SET link_status = NULL, parent_sku = NULL, match_method = NULL,
            decided_at = now(), decided_by = (SELECT auth.uid())
        WHERE match_group_key = v_key AND source_wine = v_wine;
        RETURN NULL;
    END IF;

    INSERT INTO public.cellartracker_record_decisions AS decisions (
        match_group_key, source_wine, link_status, parent_sku, match_method, decided_by
    ) VALUES (
        v_key, v_wine, NEW.status, NEW.parent_sku, NEW.match_method, NEW.resolved_by
    )
    ON CONFLICT (match_group_key, source_wine) DO UPDATE
    SET link_status = excluded.link_status,
        parent_sku = excluded.parent_sku,
        match_method = excluded.match_method,
        decided_at = now(),
        decided_by = excluded.decided_by;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.record_cellartracker_link_decision()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER record_cellartracker_link_decision
AFTER INSERT OR UPDATE OR DELETE ON public.cellartracker_product_resolutions
FOR EACH ROW EXECUTE FUNCTION private.record_cellartracker_link_decision();

-- 4. Price corrections become decisions ---------------------------------------

CREATE OR REPLACE FUNCTION public.update_cellartracker_record_price(
    p_import_id UUID,
    p_source_row_number INT,
    p_price_p INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_raw_row JSONB;
    v_match_group_key TEXT;
    v_source_wine TEXT;
    v_previous_price INT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF p_import_id IS NULL OR p_source_row_number IS NULL
       OR p_source_row_number <= 0 OR p_price_p IS NULL OR p_price_p < 0 THEN
        RAISE EXCEPTION 'valid record identifiers and a non-negative price are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT rows.raw_row, evidence.match_group_key, evidence.source_wine,
        evidence.purchase_price_per_bottle_p
    INTO v_raw_row, v_match_group_key, v_source_wine, v_previous_price
    FROM public.cellar_import_rows rows
    JOIN public.cellar_imports imports ON imports.id = rows.import_id
    JOIN public.cellartracker_evidence evidence
      ON evidence.import_id = rows.import_id
     AND evidence.source_row_number = rows.source_row_number
    WHERE rows.import_id = p_import_id
      AND rows.source_row_number = p_source_row_number
      AND imports.source_type = 'cellartracker_inventory'
      AND imports.status = 'accepted'
    FOR UPDATE OF rows, evidence;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'accepted CellarTracker record not found' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.cellartracker_evidence
    SET purchase_price_per_bottle_p = p_price_p
    WHERE import_id = p_import_id
      AND source_row_number = p_source_row_number;

    UPDATE public.cellar_import_rows
    SET raw_row = jsonb_set(
        v_raw_row,
        '{Price}',
        to_jsonb(to_char(p_price_p::NUMERIC / 100, 'FM999999999999990.00'))
    )
    WHERE import_id = p_import_id
      AND source_row_number = p_source_row_number;

    -- The correction outlives this snapshot. Record the file value it replaced
    -- so a later import can tell an unchanged source from a corrected one. A
    -- second correction keeps the original source value: it is still the
    -- number CellarTracker supplies.
    INSERT INTO public.cellartracker_record_decisions AS decisions (
        match_group_key, source_wine, purchase_price_per_bottle_p,
        source_price_per_bottle_p, decided_by
    ) VALUES (
        v_match_group_key, v_source_wine, p_price_p,
        v_previous_price, (SELECT auth.uid())
    )
    ON CONFLICT (match_group_key, source_wine) DO UPDATE
    SET purchase_price_per_bottle_p = excluded.purchase_price_per_bottle_p,
        source_price_per_bottle_p = coalesce(
            decisions.source_price_per_bottle_p, excluded.source_price_per_bottle_p
        ),
        decided_at = now(),
        decided_by = excluded.decided_by;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'source_row_number', p_source_row_number,
        'purchase_price_per_bottle_p', p_price_p
    );
END;
$$;

-- 5. Exclusion replaces deletion for CellarTracker ----------------------------

DROP FUNCTION public.delete_cellartracker_record(UUID, INT);
DROP FUNCTION public.delete_cellartracker_match_group(TEXT);

CREATE FUNCTION public.exclude_cellartracker_record(
    p_import_id UUID,
    p_source_row_number INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_match_group_key TEXT;
    v_source_wine TEXT;
    v_parent_sku TEXT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF p_import_id IS NULL OR p_source_row_number IS NULL OR p_source_row_number <= 0 THEN
        RAISE EXCEPTION 'valid record identifiers are required' USING ERRCODE = '22023';
    END IF;

    SELECT evidence.match_group_key, evidence.source_wine, resolution.parent_sku
    INTO v_match_group_key, v_source_wine, v_parent_sku
    FROM public.cellartracker_evidence evidence
    JOIN public.cellar_imports imports ON imports.id = evidence.import_id
    LEFT JOIN public.cellartracker_product_resolutions resolution
      ON resolution.import_id = evidence.import_id
     AND resolution.source_row_number = evidence.source_row_number
    WHERE evidence.import_id = p_import_id
      AND evidence.source_row_number = p_source_row_number
      AND imports.source_type = 'cellartracker_inventory'
      AND imports.status = 'accepted'
    FOR UPDATE OF evidence;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'accepted CellarTracker record not found' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.cellartracker_resolution_events (
        import_id, source_row_number, event_type, previous_parent_sku, changed_by
    ) VALUES (
        p_import_id, p_source_row_number, 'deleted', v_parent_sku, (SELECT auth.uid())
    );

    -- The evidence row stays. Excluding it hides it from every read surface
    -- and from future snapshots, and restoring it is one statement.
    INSERT INTO public.cellartracker_record_decisions AS decisions (
        match_group_key, source_wine, is_excluded, excluded_at, decided_by
    ) VALUES (
        v_match_group_key, v_source_wine, TRUE, now(), (SELECT auth.uid())
    )
    ON CONFLICT (match_group_key, source_wine) DO UPDATE
    SET is_excluded = TRUE,
        excluded_at = now(),
        decided_at = now(),
        decided_by = excluded.decided_by;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'source_row_number', p_source_row_number,
        'match_group_key', v_match_group_key,
        'excluded_row_count', 1
    );
END;
$$;

CREATE FUNCTION public.exclude_cellartracker_match_group(p_match_group_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_snapshot_id UUID;
    v_excluded INT;
    v_run_id UUID;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF p_match_group_key IS NULL OR char_length(trim(p_match_group_key)) = 0 THEN
        RAISE EXCEPTION 'match group key is required' USING ERRCODE = '22023';
    END IF;

    SELECT id INTO v_snapshot_id
    FROM public.cellar_imports
    WHERE source_type = 'cellartracker_inventory' AND status = 'accepted'
    ORDER BY accepted_at DESC, id DESC LIMIT 1;

    INSERT INTO public.cellartracker_resolution_events (
        import_id, source_row_number, event_type, previous_parent_sku, changed_by
    )
    SELECT evidence.import_id, evidence.source_row_number, 'deleted',
        resolution.parent_sku, (SELECT auth.uid())
    FROM public.cellartracker_evidence evidence
    LEFT JOIN public.cellartracker_product_resolutions resolution
      ON resolution.import_id = evidence.import_id
     AND resolution.source_row_number = evidence.source_row_number
    WHERE evidence.import_id = v_snapshot_id
      AND evidence.match_group_key = p_match_group_key;

    INSERT INTO public.cellartracker_record_decisions AS decisions (
        match_group_key, source_wine, is_excluded, excluded_at, decided_by
    )
    SELECT DISTINCT evidence.match_group_key, evidence.source_wine,
        TRUE, now(), (SELECT auth.uid())
    FROM public.cellartracker_evidence evidence
    WHERE evidence.import_id = v_snapshot_id
      AND evidence.match_group_key = p_match_group_key
    ON CONFLICT (match_group_key, source_wine) DO UPDATE
    SET is_excluded = TRUE,
        excluded_at = now(),
        decided_at = now(),
        decided_by = excluded.decided_by;
    GET DIAGNOSTICS v_excluded = ROW_COUNT;

    IF v_excluded = 0 THEN
        RAISE EXCEPTION 'match group not found' USING ERRCODE = 'P0002';
    END IF;

    -- Suggestions and pending match-run work describe a group that is no
    -- longer under review. Restoring the group puts it back in the queue for
    -- the next match run.
    DELETE FROM public.cellartracker_match_suggestions
    WHERE match_group_key = p_match_group_key;

    FOR v_run_id IN
        DELETE FROM public.cellartracker_match_run_groups
        WHERE match_group_key = p_match_group_key AND status <> 'processed'
        RETURNING run_id
    LOOP
        PERFORM private.refresh_cellartracker_match_run(v_run_id);
    END LOOP;

    RETURN jsonb_build_object(
        'match_group_key', p_match_group_key,
        'excluded_row_count', v_excluded
    );
END;
$$;

CREATE FUNCTION public.restore_cellartracker_record(
    p_match_group_key TEXT,
    p_source_wine TEXT
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
    IF p_match_group_key IS NULL OR p_source_wine IS NULL THEN
        RAISE EXCEPTION 'match group key and source wine are required' USING ERRCODE = '22023';
    END IF;

    UPDATE public.cellartracker_record_decisions
    SET is_excluded = FALSE, excluded_at = NULL,
        decided_at = now(), decided_by = (SELECT auth.uid())
    WHERE match_group_key = p_match_group_key
      AND source_wine = p_source_wine
      AND is_excluded;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN jsonb_build_object('restored', v_count > 0);
END;
$$;

REVOKE ALL ON FUNCTION
    public.exclude_cellartracker_record(UUID, INT),
    public.exclude_cellartracker_match_group(TEXT),
    public.restore_cellartracker_record(TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.exclude_cellartracker_record(UUID, INT),
    public.exclude_cellartracker_match_group(TEXT),
    public.restore_cellartracker_record(TEXT, TEXT)
    TO authenticated;

-- 6. Exclusion replaces deletion for release offers ---------------------------

DROP FUNCTION public.delete_release_offer_record(UUID, INT);
DROP FUNCTION public.delete_release_offer_match_group(TEXT);

CREATE FUNCTION public.exclude_release_offer_record(
    p_import_id UUID,
    p_source_row_number INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_fingerprint TEXT;
    v_match_group_key TEXT;
    v_source_wine TEXT;
    v_offer_date DATE;
    v_status TEXT;
    v_parent_sku TEXT;
    v_match_method TEXT;
    v_match_run_id UUID;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF p_import_id IS NULL OR p_source_row_number IS NULL OR p_source_row_number <= 0 THEN
        RAISE EXCEPTION 'valid import and source row identifiers are required' USING ERRCODE = '22023';
    END IF;

    SELECT row.content_fingerprint, row.match_group_key, row.source_wine, row.offer_date,
        resolution.status, resolution.parent_sku, resolution.match_method, resolution.match_run_id
    INTO v_fingerprint, v_match_group_key, v_source_wine, v_offer_date,
        v_status, v_parent_sku, v_match_method, v_match_run_id
    FROM public.release_offer_source_rows row
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    LEFT JOIN public.release_offer_product_resolutions resolution
      ON resolution.import_id = row.import_id
     AND resolution.source_row_number = row.source_row_number
    WHERE row.import_id = p_import_id
      AND row.source_row_number = p_source_row_number
      AND imports.status = 'accepted'
    FOR UPDATE OF row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'accepted release-offer record not found' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.release_offer_resolution_events (
        import_id, source_row_number, event_type,
        previous_status, previous_parent_sku, previous_match_method,
        match_run_id, changed_by
    ) VALUES (
        p_import_id, p_source_row_number, 'deleted',
        v_status, v_parent_sku, v_match_method,
        v_match_run_id, (SELECT auth.uid())
    );

    INSERT INTO public.release_offer_record_exclusions (
        content_fingerprint, match_group_key, source_wine, offer_date, excluded_by
    ) VALUES (
        v_fingerprint, v_match_group_key, v_source_wine, v_offer_date, (SELECT auth.uid())
    )
    ON CONFLICT (content_fingerprint) DO UPDATE
    SET excluded_at = now(), excluded_by = (SELECT auth.uid());

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'source_row_number', p_source_row_number,
        'content_fingerprint', v_fingerprint,
        'match_group_key', v_match_group_key,
        'excluded_row_count', 1
    );
END;
$$;

CREATE FUNCTION public.exclude_release_offer_match_group(p_match_group_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_excluded INT;
    v_run_id UUID;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF p_match_group_key IS NULL OR char_length(trim(p_match_group_key)) = 0 THEN
        RAISE EXCEPTION 'match group key is required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.release_offer_resolution_events (
        import_id, source_row_number, event_type,
        previous_status, previous_parent_sku, previous_match_method, changed_by
    )
    SELECT row.import_id, row.source_row_number, 'deleted',
        resolution.status, resolution.parent_sku, resolution.match_method,
        (SELECT auth.uid())
    FROM public.release_offer_source_rows row
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    LEFT JOIN public.release_offer_product_resolutions resolution
      ON resolution.import_id = row.import_id
     AND resolution.source_row_number = row.source_row_number
    WHERE imports.status = 'accepted'
      AND row.match_group_key = p_match_group_key;

    INSERT INTO public.release_offer_record_exclusions (
        content_fingerprint, match_group_key, source_wine, offer_date, excluded_by
    )
    SELECT DISTINCT ON (row.content_fingerprint)
        row.content_fingerprint, row.match_group_key, row.source_wine, row.offer_date,
        (SELECT auth.uid())
    FROM public.release_offer_source_rows row
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    WHERE imports.status = 'accepted'
      AND row.match_group_key = p_match_group_key
    ON CONFLICT (content_fingerprint) DO UPDATE
    SET excluded_at = now(), excluded_by = (SELECT auth.uid());
    GET DIAGNOSTICS v_excluded = ROW_COUNT;

    IF v_excluded = 0 THEN
        RAISE EXCEPTION 'match group not found' USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM public.release_offer_match_suggestions
    WHERE match_group_key = p_match_group_key;

    FOR v_run_id IN
        DELETE FROM public.release_offer_match_run_groups
        WHERE match_group_key = p_match_group_key AND status <> 'processed'
        RETURNING run_id
    LOOP
        PERFORM private.refresh_release_offer_match_run(v_run_id);
    END LOOP;

    RETURN jsonb_build_object(
        'match_group_key', p_match_group_key,
        'excluded_row_count', v_excluded
    );
END;
$$;

CREATE FUNCTION public.restore_release_offer_record(p_content_fingerprint TEXT)
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
    IF p_content_fingerprint IS NULL THEN
        RAISE EXCEPTION 'content fingerprint is required' USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.release_offer_record_exclusions
    WHERE content_fingerprint = p_content_fingerprint;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN jsonb_build_object('restored', v_count > 0);
END;
$$;

REVOKE ALL ON FUNCTION
    public.exclude_release_offer_record(UUID, INT),
    public.exclude_release_offer_match_group(TEXT),
    public.restore_release_offer_record(TEXT)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.exclude_release_offer_record(UUID, INT),
    public.exclude_release_offer_match_group(TEXT),
    public.restore_release_offer_record(TEXT)
    TO authenticated;

-- 7. Read views hide excluded records -----------------------------------------

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
LEFT JOIN normalised_market market ON market.parent_sku = resolution.parent_sku
WHERE NOT EXISTS (
    SELECT 1
    FROM public.cellartracker_record_decisions decisions
    WHERE decisions.match_group_key = evidence.match_group_key
      AND decisions.source_wine = evidence.source_wine
      AND decisions.is_excluded
);

CREATE OR REPLACE VIEW public.cellartracker_match_review_view
WITH (security_invoker = TRUE)
AS
WITH latest AS (
    SELECT id FROM public.cellar_imports
    WHERE source_type = 'cellartracker_inventory' AND status = 'accepted'
    ORDER BY accepted_at DESC, id DESC LIMIT 1
), grouped AS (
    SELECT evidence.match_group_key,
        min(evidence.source_wine) AS source_wine,
        min(evidence.vintage) AS source_vintage,
        min(evidence.producer) AS source_producer,
        min(evidence.region) AS source_region,
        count(*)::INT AS source_row_count,
        count(*) FILTER (WHERE resolution.import_id IS NULL)::INT AS unresolved_row_count,
        count(*) FILTER (WHERE resolution.status = 'linked')::INT AS linked_row_count,
        count(*) FILTER (WHERE resolution.status = 'suppressed')::INT AS suppressed_row_count,
        CASE WHEN count(DISTINCT resolution.parent_sku) FILTER (WHERE resolution.status = 'linked') = 1
            THEN min(resolution.parent_sku) FILTER (WHERE resolution.status = 'linked') END AS parent_sku,
        CASE WHEN count(DISTINCT resolution.match_method) FILTER (WHERE resolution.status = 'linked') = 1
            THEN min(resolution.match_method) FILTER (WHERE resolution.status = 'linked') END AS match_method
    FROM latest
    JOIN public.cellartracker_evidence evidence ON evidence.import_id = latest.id
    LEFT JOIN public.cellartracker_product_resolutions resolution
      ON resolution.import_id = evidence.import_id
     AND resolution.source_row_number = evidence.source_row_number
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.cellartracker_record_decisions decisions
        WHERE decisions.match_group_key = evidence.match_group_key
          AND decisions.source_wine = evidence.source_wine
          AND decisions.is_excluded
    )
    GROUP BY evidence.match_group_key
), suggestion_stats AS (
    SELECT match_group_key, count(*)::INT AS suggestion_count,
        max(observed_at) AS suggestions_observed_at
    FROM public.cellartracker_match_suggestions GROUP BY match_group_key
)
SELECT grouped.*,
    EXISTS (SELECT 1 FROM public.catalogue_view catalogue
        WHERE catalogue.parent_sku = grouped.parent_sku) AS is_biddable,
    coalesce(suggestion_stats.suggestion_count, 0) AS suggestion_count,
    suggestion_stats.suggestions_observed_at
FROM grouped LEFT JOIN suggestion_stats USING (match_group_key);

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
  AND NOT EXISTS (
    SELECT 1
    FROM public.release_offer_record_exclusions exclusions
    WHERE exclusions.content_fingerprint = row.content_fingerprint
  )
GROUP BY row.import_id, row.source_row_number, row.offer_date, row.source_wine,
    row.source_vintage, row.source_price_text, row.source_product_id,
    row.source_product_url, resolution.status, resolution.parent_sku,
    resolution.match_method, row.match_group_key;

-- Every release price in the application flows through this view, so the
-- exclusion filter here also removes an excluded offer from the anchor, the
-- market comparison and the favourites surfaces.
CREATE OR REPLACE VIEW public.release_offer_evidence_view
WITH (security_invoker = TRUE)
AS
WITH ranked AS (
    SELECT price.id AS release_offer_price_id, row.import_id, row.source_row_number,
        resolution.parent_sku, price.format_code, row.offer_date, row.source_wine,
        row.source_product_url, price.amount_p AS release_price_p, price.case_size,
        price.bottle_volume_ml, price.tax_basis, resolution.match_method, row.source_message_id,
        row.content_fingerprint,
        row_number() OVER (PARTITION BY resolution.parent_sku, price.format_code, row.offer_date, price.amount_p ORDER BY imports.accepted_at, row.import_id, row.source_row_number, price.fragment_index) AS duplicate_rank
    FROM public.release_offer_prices price
    JOIN public.release_offer_source_rows row ON row.import_id = price.import_id AND row.source_row_number = price.source_row_number
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    JOIN public.release_offer_product_resolutions resolution ON resolution.import_id = row.import_id AND resolution.source_row_number = row.source_row_number
    WHERE imports.status = 'accepted' AND resolution.status = 'linked'
      AND price.parse_status = 'valid' AND price.tax_basis = 'in_bond'
      AND NOT EXISTS (
        SELECT 1
        FROM public.release_offer_record_exclusions exclusions
        WHERE exclusions.content_fingerprint = row.content_fingerprint
      )
) SELECT * FROM ranked WHERE duplicate_rank = 1;

-- Excluding an offer that had been confirmed as the anchor leaves the override
-- row in place, so restoring the offer restores the confirmation. Until then
-- the anchor falls back to the provisional pick, and this view now says so
-- rather than labelling a provisional anchor "confirmed".
CREATE OR REPLACE VIEW public.release_price_anchor_view
WITH (security_invoker = TRUE)
AS
WITH provisional AS (
    SELECT DISTINCT ON (parent_sku, format_code)
        parent_sku, format_code, release_offer_price_id, offer_date,
        release_price_p, source_wine, source_product_url
    FROM public.release_offer_evidence_view
    ORDER BY parent_sku, format_code, offer_date, release_offer_price_id
), selected AS (
    SELECT p.parent_sku, p.format_code,
        coalesce(confirmed.release_offer_price_id, p.release_offer_price_id) AS release_offer_price_id,
        CASE WHEN confirmed.release_offer_price_id IS NULL THEN 'provisional' ELSE 'confirmed' END AS anchor_status
    FROM provisional p
    LEFT JOIN public.release_price_anchor_overrides override
      ON override.parent_sku = p.parent_sku AND override.format_code = p.format_code
    LEFT JOIN public.release_offer_evidence_view confirmed
      ON confirmed.release_offer_price_id = override.release_offer_price_id
)
SELECT selected.parent_sku, selected.format_code, selected.anchor_status,
    evidence.release_offer_price_id, evidence.offer_date, evidence.release_price_p,
    evidence.source_wine, evidence.source_product_url
FROM selected
JOIN public.release_offer_evidence_view evidence
  ON evidence.release_offer_price_id = selected.release_offer_price_id;

-- 8. Excluded-record listings --------------------------------------------------

CREATE VIEW public.cellartracker_excluded_record_view
WITH (security_invoker = TRUE)
AS
WITH latest AS (
    SELECT id FROM public.cellar_imports
    WHERE source_type = 'cellartracker_inventory' AND status = 'accepted'
    ORDER BY accepted_at DESC, id DESC LIMIT 1
)
SELECT
    decisions.match_group_key,
    decisions.source_wine,
    decisions.excluded_at,
    decisions.parent_sku,
    decisions.link_status,
    -- Whether the current snapshot still carries the record. FALSE means the
    -- exclusion is dormant: CellarTracker is no longer reporting it, and the
    -- decision is only holding the door shut for a future file.
    EXISTS (
        SELECT 1
        FROM latest
        JOIN public.cellartracker_evidence evidence ON evidence.import_id = latest.id
        WHERE evidence.match_group_key = decisions.match_group_key
          AND evidence.source_wine = decisions.source_wine
    ) AS in_current_snapshot,
    (
        SELECT min(evidence.vintage)
        FROM latest
        JOIN public.cellartracker_evidence evidence ON evidence.import_id = latest.id
        WHERE evidence.match_group_key = decisions.match_group_key
          AND evidence.source_wine = decisions.source_wine
    ) AS vintage
FROM public.cellartracker_record_decisions decisions
WHERE decisions.is_excluded;

CREATE VIEW public.release_offer_excluded_record_view
WITH (security_invoker = TRUE)
AS
SELECT
    exclusions.content_fingerprint,
    exclusions.match_group_key,
    exclusions.source_wine,
    exclusions.offer_date,
    exclusions.excluded_at,
    EXISTS (
        SELECT 1
        FROM public.release_offer_source_rows row
        JOIN public.release_offer_imports imports ON imports.id = row.import_id
        WHERE imports.status = 'accepted'
          AND row.content_fingerprint = exclusions.content_fingerprint
    ) AS in_accepted_evidence
FROM public.release_offer_record_exclusions exclusions;

REVOKE ALL ON public.cellartracker_excluded_record_view,
    public.release_offer_excluded_record_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cellartracker_excluded_record_view,
    public.release_offer_excluded_record_view TO authenticated;

-- 9. Accepting a snapshot re-applies the decisions ----------------------------

CREATE FUNCTION private.cellartracker_import_decisions(p_import_id UUID)
RETURNS TABLE (
    source_row_number INT,
    match_group_key TEXT,
    source_wine TEXT,
    link_status TEXT,
    parent_sku TEXT,
    match_method TEXT,
    decided_price_p INT,
    source_price_p INT,
    file_price_p INT,
    is_excluded BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT evidence.source_row_number, evidence.match_group_key, evidence.source_wine,
        decisions.link_status, decisions.parent_sku, decisions.match_method,
        decisions.purchase_price_per_bottle_p, decisions.source_price_per_bottle_p,
        evidence.purchase_price_per_bottle_p, decisions.is_excluded
    FROM public.cellartracker_evidence evidence
    JOIN public.cellartracker_record_decisions decisions
      ON decisions.match_group_key = evidence.match_group_key
     AND decisions.source_wine = evidence.source_wine
    WHERE evidence.import_id = p_import_id;
$$;

REVOKE ALL ON FUNCTION private.cellartracker_import_decisions(UUID)
    FROM PUBLIC, anon, authenticated;

-- What accepting this import would carry over from decisions already made.
-- The accept screen shows this before the owner commits.
CREATE FUNCTION public.preview_cellartracker_import(p_import_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    SELECT jsonb_build_object(
        'record_count', (
            SELECT count(*) FROM public.cellartracker_evidence WHERE import_id = p_import_id
        ),
        'link_count', count(*) FILTER (
            WHERE NOT is_excluded AND link_status IS NOT NULL
        ),
        'price_count', count(*) FILTER (
            WHERE NOT is_excluded AND decided_price_p IS NOT NULL
              AND file_price_p IS NOT DISTINCT FROM source_price_p
              AND file_price_p IS DISTINCT FROM decided_price_p
        ),
        -- CellarTracker has changed a row the owner had corrected. Overriding
        -- would discard the new source value, so the correction is held back
        -- and reported instead.
        'price_conflict_count', count(*) FILTER (
            WHERE NOT is_excluded AND decided_price_p IS NOT NULL
              AND file_price_p IS DISTINCT FROM source_price_p
              AND file_price_p IS DISTINCT FROM decided_price_p
        ),
        'excluded_count', count(*) FILTER (WHERE is_excluded),
        'new_record_count', (
            SELECT count(*)
            FROM public.cellartracker_evidence evidence
            WHERE evidence.import_id = p_import_id
              AND NOT EXISTS (
                SELECT 1 FROM public.cellartracker_record_decisions decisions
                WHERE decisions.match_group_key = evidence.match_group_key
                  AND decisions.source_wine = evidence.source_wine
              )
        )
    )
    INTO v_result
    FROM private.cellartracker_import_decisions(p_import_id);

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_cellartracker_import(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_cellartracker_import(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_cellartracker_import(p_import_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_preview JSONB;
    v_links INT;
    v_prices INT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    v_preview := public.preview_cellartracker_import(p_import_id);

    UPDATE public.cellar_imports
    SET status = 'accepted', accepted_at = now(), accepted_by = (SELECT auth.uid())
    WHERE id = p_import_id
      AND source_type = 'cellartracker_inventory'
      AND status = 'validated'
      AND error_row_count = 0;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'import cannot be accepted' USING ERRCODE = '22023';
    END IF;

    -- Carry-forward writes resolutions that were already decided. Suppress the
    -- decision trigger so re-applying a decision does not restamp it.
    PERFORM set_config('app.cellartracker_carry_forward', 'on', TRUE);

    INSERT INTO public.cellartracker_product_resolutions (
        import_id, source_row_number, status, parent_sku, match_method, resolved_by
    )
    SELECT p_import_id, decision.source_row_number, decision.link_status,
        decision.parent_sku, decision.match_method, (SELECT auth.uid())
    FROM private.cellartracker_import_decisions(p_import_id) decision
    WHERE NOT decision.is_excluded
      AND decision.link_status IS NOT NULL
    ON CONFLICT (import_id, source_row_number) DO NOTHING;
    GET DIAGNOSTICS v_links = ROW_COUNT;

    UPDATE public.cellartracker_evidence evidence
    SET purchase_price_per_bottle_p = decision.decided_price_p
    FROM private.cellartracker_import_decisions(p_import_id) decision
    WHERE evidence.import_id = p_import_id
      AND evidence.source_row_number = decision.source_row_number
      AND NOT decision.is_excluded
      AND decision.decided_price_p IS NOT NULL
      -- Only where CellarTracker still reports the value that was corrected.
      AND decision.file_price_p IS NOT DISTINCT FROM decision.source_price_p
      AND decision.file_price_p IS DISTINCT FROM decision.decided_price_p;
    GET DIAGNOSTICS v_prices = ROW_COUNT;

    PERFORM set_config('app.cellartracker_carry_forward', 'off', TRUE);

    RETURN v_preview || jsonb_build_object(
        'import_id', p_import_id,
        'status', 'accepted',
        'links_applied', v_links,
        'prices_applied', v_prices
    );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_cellartracker_import(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_cellartracker_import(UUID) TO authenticated;

-- 10. Seed decisions from the current snapshot --------------------------------

-- Links already made against the accepted snapshot become decisions, so the
-- next upload carries them. Without this the layer would only start protecting
-- work done from now on.
INSERT INTO public.cellartracker_record_decisions (
    match_group_key, source_wine, link_status, parent_sku, match_method, decided_by
)
SELECT DISTINCT ON (evidence.match_group_key, evidence.source_wine)
    evidence.match_group_key, evidence.source_wine,
    resolution.status, resolution.parent_sku, resolution.match_method,
    resolution.resolved_by
FROM public.cellartracker_evidence evidence
JOIN public.cellartracker_product_resolutions resolution
  ON resolution.import_id = evidence.import_id
 AND resolution.source_row_number = evidence.source_row_number
WHERE evidence.import_id = (
    SELECT id FROM public.cellar_imports
    WHERE source_type = 'cellartracker_inventory' AND status = 'accepted'
    ORDER BY accepted_at DESC, id DESC LIMIT 1
)
ORDER BY evidence.match_group_key, evidence.source_wine, resolution.resolved_at DESC
ON CONFLICT (match_group_key, source_wine) DO NOTHING;
