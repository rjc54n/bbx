-- Match accepted historic release offers across BBR's wider prod_product
-- catalogue while keeping BBX eligibility in the local products table.

DROP FUNCTION IF EXISTS public.run_release_offer_matching(UUID);

ALTER TABLE public.release_offer_source_rows
    ADD COLUMN match_group_key TEXT GENERATED ALWAYS AS (
        coalesce(source_vintage::TEXT, 'unknown') || '|' || source_match_key
    ) STORED;

CREATE INDEX idx_release_offer_source_rows_match_group
    ON public.release_offer_source_rows(match_group_key, import_id, source_row_number);

ALTER TABLE public.release_offer_product_resolutions
    DROP CONSTRAINT release_offer_product_resolutions_match_method_check;

UPDATE public.release_offer_product_resolutions
SET match_method = CASE match_method
    WHEN 'direct' THEN 'supplied_id'
    WHEN 'exact_name_vintage' THEN 'local_exact'
    ELSE match_method
END;

ALTER TABLE public.release_offer_product_resolutions
    ADD CONSTRAINT release_offer_product_resolutions_match_method_check
        CHECK (match_method IN (
            'supplied_id', 'local_exact', 'algolia_exact',
            'algolia_confirmed', 'manual'
        ));

CREATE TABLE public.release_offer_match_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'partial', 'failed')),
    algorithm_version TEXT NOT NULL DEFAULT 'algolia-prod-product-v1',
    catalogue_index TEXT NOT NULL DEFAULT 'prod_product',
    started_by UUID NOT NULL REFERENCES auth.users(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    finished_at TIMESTAMPTZ,
    algolia_observed_at TIMESTAMPTZ,
    total_group_count INT NOT NULL DEFAULT 0 CHECK (total_group_count >= 0),
    processed_group_count INT NOT NULL DEFAULT 0 CHECK (processed_group_count >= 0),
    remaining_group_count INT NOT NULL DEFAULT 0 CHECK (remaining_group_count >= 0),
    error_group_count INT NOT NULL DEFAULT 0 CHECK (error_group_count >= 0),
    supplied_id_link_count INT NOT NULL DEFAULT 0 CHECK (supplied_id_link_count >= 0),
    local_exact_link_count INT NOT NULL DEFAULT 0 CHECK (local_exact_link_count >= 0),
    algolia_exact_link_count INT NOT NULL DEFAULT 0 CHECK (algolia_exact_link_count >= 0),
    error_message TEXT
);

CREATE TABLE public.release_offer_match_run_groups (
    run_id UUID NOT NULL REFERENCES public.release_offer_match_runs(id) ON DELETE CASCADE,
    match_group_key TEXT NOT NULL,
    source_match_key TEXT NOT NULL,
    source_vintage INT,
    source_wine TEXT NOT NULL,
    source_row_count INT NOT NULL CHECK (source_row_count > 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processed', 'failed')),
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    PRIMARY KEY (run_id, match_group_key)
);

CREATE INDEX idx_release_offer_match_run_groups_work
    ON public.release_offer_match_run_groups(run_id, status, match_group_key);

CREATE TABLE public.release_offer_match_suggestions (
    match_group_key TEXT NOT NULL,
    parent_sku TEXT NOT NULL CHECK (parent_sku ~ '^\d{5,30}$'),
    source_run_id UUID NOT NULL REFERENCES public.release_offer_match_runs(id) ON DELETE CASCADE,
    rank INT NOT NULL CHECK (rank BETWEEN 1 AND 5),
    name TEXT NOT NULL,
    vintage INT,
    producer TEXT,
    region TEXT,
    stock_origin TEXT,
    purchase_mode TEXT,
    product_url TEXT,
    matched_words TEXT[] NOT NULL DEFAULT '{}',
    typo_count INT CHECK (typo_count IS NULL OR typo_count >= 0),
    was_biddable_at_observation BOOLEAN NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (match_group_key, parent_sku),
    UNIQUE (match_group_key, rank)
);

CREATE INDEX idx_release_offer_match_suggestions_group_rank
    ON public.release_offer_match_suggestions(match_group_key, rank);

ALTER TABLE public.release_offer_product_resolutions
    ADD COLUMN match_run_id UUID REFERENCES public.release_offer_match_runs(id);

CREATE TABLE public.release_offer_resolution_events (
    id BIGSERIAL PRIMARY KEY,
    import_id UUID NOT NULL,
    source_row_number INT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('linked', 'edited', 'suppressed', 'unlinked', 'restored')),
    previous_status TEXT,
    previous_parent_sku TEXT,
    previous_match_method TEXT,
    new_status TEXT,
    new_parent_sku TEXT,
    new_match_method TEXT,
    match_run_id UUID REFERENCES public.release_offer_match_runs(id),
    changed_by UUID REFERENCES auth.users(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_release_offer_resolution_events_source
    ON public.release_offer_resolution_events(import_id, source_row_number, changed_at DESC);

ALTER TABLE public.release_offer_match_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_offer_match_run_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_offer_match_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_offer_resolution_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.release_offer_match_runs,
    public.release_offer_match_run_groups,
    public.release_offer_match_suggestions,
    public.release_offer_resolution_events
    FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.release_offer_match_runs,
    public.release_offer_match_run_groups,
    public.release_offer_match_suggestions,
    public.release_offer_resolution_events
    TO authenticated;

CREATE POLICY "Owner can read release offer match runs"
    ON public.release_offer_match_runs FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can read release offer match run groups"
    ON public.release_offer_match_run_groups FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can read release offer match suggestions"
    ON public.release_offer_match_suggestions FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can read release offer resolution events"
    ON public.release_offer_resolution_events FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));

CREATE FUNCTION private.audit_release_offer_resolution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event_type TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_type := CASE WHEN NEW.status = 'ignored' THEN 'suppressed' ELSE 'linked' END;
        INSERT INTO public.release_offer_resolution_events (
            import_id, source_row_number, event_type,
            new_status, new_parent_sku, new_match_method,
            match_run_id, changed_by
        ) VALUES (
            NEW.import_id, NEW.source_row_number, v_event_type,
            NEW.status, NEW.parent_sku, NEW.match_method,
            NEW.match_run_id, NEW.resolved_by
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        v_event_type := CASE
            WHEN NEW.status = 'ignored' THEN 'suppressed'
            WHEN OLD.status = 'ignored' AND NEW.status = 'linked' THEN 'linked'
            ELSE 'edited'
        END;
        INSERT INTO public.release_offer_resolution_events (
            import_id, source_row_number, event_type,
            previous_status, previous_parent_sku, previous_match_method,
            new_status, new_parent_sku, new_match_method,
            match_run_id, changed_by
        ) VALUES (
            NEW.import_id, NEW.source_row_number, v_event_type,
            OLD.status, OLD.parent_sku, OLD.match_method,
            NEW.status, NEW.parent_sku, NEW.match_method,
            NEW.match_run_id, NEW.resolved_by
        );
        RETURN NEW;
    END IF;

    v_event_type := CASE WHEN OLD.status = 'ignored' THEN 'restored' ELSE 'unlinked' END;
    INSERT INTO public.release_offer_resolution_events (
        import_id, source_row_number, event_type,
        previous_status, previous_parent_sku, previous_match_method,
        match_run_id, changed_by
    ) VALUES (
        OLD.import_id, OLD.source_row_number, v_event_type,
        OLD.status, OLD.parent_sku, OLD.match_method,
        OLD.match_run_id, (SELECT auth.uid())
    );
    RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.audit_release_offer_resolution() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_release_offer_resolution
AFTER INSERT OR UPDATE OR DELETE ON public.release_offer_product_resolutions
FOR EACH ROW EXECUTE FUNCTION private.audit_release_offer_resolution();

CREATE FUNCTION private.refresh_release_offer_match_run(p_run_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_processed INT;
    v_pending INT;
    v_failed INT;
BEGIN
    SELECT
        count(*) FILTER (WHERE status = 'processed')::INT,
        count(*) FILTER (WHERE status = 'pending')::INT,
        count(*) FILTER (WHERE status = 'failed')::INT
    INTO v_processed, v_pending, v_failed
    FROM public.release_offer_match_run_groups
    WHERE run_id = p_run_id;

    UPDATE public.release_offer_match_runs
    SET processed_group_count = v_processed,
        remaining_group_count = v_pending,
        error_group_count = v_failed,
        status = CASE
            WHEN v_pending > 0 THEN 'running'
            WHEN v_failed > 0 THEN 'partial'
            ELSE 'completed'
        END,
        finished_at = CASE WHEN v_pending = 0 THEN now() ELSE NULL END
    WHERE id = p_run_id;
END;
$$;

REVOKE ALL ON FUNCTION private.refresh_release_offer_match_run(UUID) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.begin_release_offer_match_run()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_run_id UUID;
    v_supplied INT := 0;
    v_local_exact INT := 0;
    v_groups INT := 0;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_run_id
    FROM public.release_offer_match_runs
    WHERE status IN ('running', 'partial')
    ORDER BY started_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        UPDATE public.release_offer_match_run_groups
        SET status = 'pending', error_message = NULL, processed_at = NULL
        WHERE run_id = v_run_id AND status = 'failed';
        UPDATE public.release_offer_match_runs
        SET status = 'running', finished_at = NULL, error_message = NULL
        WHERE id = v_run_id;
        PERFORM private.refresh_release_offer_match_run(v_run_id);
        RETURN jsonb_build_object('run_id', v_run_id, 'resumed', TRUE);
    END IF;

    INSERT INTO public.release_offer_match_runs (started_by)
    VALUES ((SELECT auth.uid()))
    RETURNING id INTO v_run_id;

    INSERT INTO public.release_offer_product_resolutions (
        import_id, source_row_number, status, parent_sku,
        match_method, match_run_id, resolved_by
    )
    SELECT row.import_id, row.source_row_number, 'linked', row.source_product_id,
        'supplied_id', v_run_id, (SELECT auth.uid())
    FROM public.release_offer_source_rows row
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    LEFT JOIN public.release_offer_product_resolutions resolution
      ON resolution.import_id = row.import_id
     AND resolution.source_row_number = row.source_row_number
    WHERE imports.status = 'accepted'
      AND resolution.import_id IS NULL
      AND row.source_product_id IS NOT NULL;
    GET DIAGNOSTICS v_supplied = ROW_COUNT;

    WITH unresolved_groups AS (
        SELECT DISTINCT row.match_group_key, row.source_match_key, row.source_vintage
        FROM public.release_offer_source_rows row
        JOIN public.release_offer_imports imports ON imports.id = row.import_id
        LEFT JOIN public.release_offer_product_resolutions resolution
          ON resolution.import_id = row.import_id
         AND resolution.source_row_number = row.source_row_number
        WHERE imports.status = 'accepted'
          AND resolution.import_id IS NULL
          AND row.source_vintage IS NOT NULL
    ), unique_matches AS (
        SELECT group_row.match_group_key, min(product.parent_sku) AS parent_sku
        FROM unresolved_groups group_row
        JOIN public.products product ON product.vintage = group_row.source_vintage
          AND private.release_wine_match_key(product.name, product.vintage) = group_row.source_match_key
        GROUP BY group_row.match_group_key
        HAVING count(DISTINCT product.parent_sku) = 1
    )
    INSERT INTO public.release_offer_product_resolutions (
        import_id, source_row_number, status, parent_sku,
        match_method, match_run_id, resolved_by
    )
    SELECT row.import_id, row.source_row_number, 'linked', match.parent_sku,
        'local_exact', v_run_id, (SELECT auth.uid())
    FROM public.release_offer_source_rows row
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    JOIN unique_matches match ON match.match_group_key = row.match_group_key
    LEFT JOIN public.release_offer_product_resolutions resolution
      ON resolution.import_id = row.import_id
     AND resolution.source_row_number = row.source_row_number
    WHERE imports.status = 'accepted' AND resolution.import_id IS NULL;
    GET DIAGNOSTICS v_local_exact = ROW_COUNT;

    INSERT INTO public.release_offer_match_run_groups (
        run_id, match_group_key, source_match_key, source_vintage,
        source_wine, source_row_count
    )
    SELECT v_run_id, row.match_group_key, min(row.source_match_key),
        min(row.source_vintage), min(row.source_wine), count(*)::INT
    FROM public.release_offer_source_rows row
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    LEFT JOIN public.release_offer_product_resolutions resolution
      ON resolution.import_id = row.import_id
     AND resolution.source_row_number = row.source_row_number
    WHERE imports.status = 'accepted' AND resolution.import_id IS NULL
    GROUP BY row.match_group_key;
    GET DIAGNOSTICS v_groups = ROW_COUNT;

    UPDATE public.release_offer_match_runs
    SET supplied_id_link_count = v_supplied,
        local_exact_link_count = v_local_exact,
        total_group_count = v_groups,
        remaining_group_count = v_groups,
        status = CASE WHEN v_groups = 0 THEN 'completed' ELSE 'running' END,
        finished_at = CASE WHEN v_groups = 0 THEN now() END
    WHERE id = v_run_id;

    RETURN jsonb_build_object(
        'run_id', v_run_id,
        'resumed', FALSE,
        'supplied_id_link_count', v_supplied,
        'local_exact_link_count', v_local_exact,
        'remaining_group_count', v_groups
    );
END;
$$;

CREATE FUNCTION public.record_release_offer_algolia_result(
    p_run_id UUID,
    p_match_group_key TEXT,
    p_candidates JSONB,
    p_exact_parent_skus TEXT[],
    p_exhaustive BOOLEAN,
    p_observed_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_group public.release_offer_match_run_groups%ROWTYPE;
    v_exact_parent_skus TEXT[];
    v_exact_parent_sku TEXT;
    v_linked INT := 0;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(p_candidates) <> 'array' OR jsonb_array_length(p_candidates) > 5 THEN
        RAISE EXCEPTION 'p_candidates must be an array of at most five results' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_group
    FROM public.release_offer_match_run_groups
    WHERE run_id = p_run_id AND match_group_key = p_match_group_key
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'match group not found' USING ERRCODE = 'P0002'; END IF;
    IF v_group.status = 'processed' THEN
        RETURN jsonb_build_object('status', 'processed', 'already_processed', TRUE);
    END IF;

    SELECT coalesce(array_agg(DISTINCT value), '{}') INTO v_exact_parent_skus
    FROM unnest(coalesce(p_exact_parent_skus, '{}')) value
    WHERE value ~ '^\d{5,30}$';

    DELETE FROM public.release_offer_match_suggestions
    WHERE match_group_key = p_match_group_key;

    WITH candidates AS (
        SELECT * FROM jsonb_to_recordset(p_candidates) AS candidate(
            rank INT, parent_sku TEXT, name TEXT, vintage INT, producer TEXT,
            region TEXT, stock_origin TEXT, purchase_mode TEXT, product_url TEXT,
            matched_words TEXT[], typo_count INT
        )
    )
    INSERT INTO public.release_offer_match_suggestions (
        match_group_key, parent_sku, source_run_id, rank, name, vintage,
        producer, region, stock_origin, purchase_mode, product_url,
        matched_words, typo_count, was_biddable_at_observation, observed_at
    )
    SELECT p_match_group_key, candidate.parent_sku, p_run_id, candidate.rank,
        candidate.name, candidate.vintage, candidate.producer, candidate.region,
        candidate.stock_origin, candidate.purchase_mode, candidate.product_url,
        coalesce(candidate.matched_words, '{}'), candidate.typo_count,
        EXISTS (
            SELECT 1 FROM public.products product
            WHERE product.parent_sku = candidate.parent_sku AND product.gone_since IS NULL
        ),
        p_observed_at
    FROM candidates candidate
    WHERE candidate.rank BETWEEN 1 AND 5
      AND candidate.parent_sku ~ '^\d{5,30}$'
      AND nullif(btrim(candidate.name), '') IS NOT NULL;

    IF p_exhaustive
       AND v_group.source_vintage IS NOT NULL
       AND cardinality(v_exact_parent_skus) = 1 THEN
        v_exact_parent_sku := v_exact_parent_skus[1];
        INSERT INTO public.release_offer_product_resolutions (
            import_id, source_row_number, status, parent_sku,
            match_method, match_run_id, resolved_by
        )
        SELECT row.import_id, row.source_row_number, 'linked', v_exact_parent_sku,
            'algolia_exact', p_run_id, (SELECT auth.uid())
        FROM public.release_offer_source_rows row
        JOIN public.release_offer_imports imports ON imports.id = row.import_id
        LEFT JOIN public.release_offer_product_resolutions resolution
          ON resolution.import_id = row.import_id
         AND resolution.source_row_number = row.source_row_number
        WHERE imports.status = 'accepted'
          AND row.match_group_key = p_match_group_key
          AND resolution.import_id IS NULL;
        GET DIAGNOSTICS v_linked = ROW_COUNT;
    END IF;

    UPDATE public.release_offer_match_run_groups
    SET status = 'processed', processed_at = now(), error_message = NULL
    WHERE run_id = p_run_id AND match_group_key = p_match_group_key;

    UPDATE public.release_offer_match_runs
    SET algolia_observed_at = greatest(algolia_observed_at, p_observed_at),
        algolia_exact_link_count = algolia_exact_link_count + v_linked
    WHERE id = p_run_id;

    PERFORM private.refresh_release_offer_match_run(p_run_id);
    RETURN jsonb_build_object('status', 'processed', 'linked_row_count', v_linked, 'already_processed', FALSE);
END;
$$;

CREATE FUNCTION public.record_release_offer_algolia_error(
    p_run_id UUID,
    p_match_group_key TEXT,
    p_error_message TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    UPDATE public.release_offer_match_run_groups
    SET status = 'failed', processed_at = now(), error_message = left(p_error_message, 1000)
    WHERE run_id = p_run_id AND match_group_key = p_match_group_key
      AND status <> 'processed';
    IF NOT FOUND THEN RAISE EXCEPTION 'match group not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM private.refresh_release_offer_match_run(p_run_id);
    RETURN jsonb_build_object('status', 'failed');
END;
$$;

CREATE FUNCTION public.confirm_release_offer_match_group(
    p_match_group_key TEXT,
    p_parent_sku TEXT,
    p_method TEXT DEFAULT 'algolia_confirmed'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    IF p_parent_sku !~ '^\d{5,30}$' OR p_method NOT IN ('algolia_confirmed', 'manual') THEN
        RAISE EXCEPTION 'invalid group resolution' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.release_offer_product_resolutions (
        import_id, source_row_number, status, parent_sku, match_method, resolved_by
    )
    SELECT row.import_id, row.source_row_number, 'linked', p_parent_sku, p_method, (SELECT auth.uid())
    FROM public.release_offer_source_rows row
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    LEFT JOIN public.release_offer_product_resolutions resolution
      ON resolution.import_id = row.import_id AND resolution.source_row_number = row.source_row_number
    WHERE imports.status = 'accepted'
      AND row.match_group_key = p_match_group_key
      AND resolution.import_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('status', 'linked', 'linked_row_count', v_count, 'parent_sku', p_parent_sku);
END;
$$;

CREATE FUNCTION public.suppress_release_offer_match_group(p_match_group_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    INSERT INTO public.release_offer_product_resolutions (
        import_id, source_row_number, status, resolved_by
    )
    SELECT row.import_id, row.source_row_number, 'ignored', (SELECT auth.uid())
    FROM public.release_offer_source_rows row
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    LEFT JOIN public.release_offer_product_resolutions resolution
      ON resolution.import_id = row.import_id AND resolution.source_row_number = row.source_row_number
    WHERE imports.status = 'accepted'
      AND row.match_group_key = p_match_group_key
      AND resolution.import_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('status', 'suppressed', 'suppressed_row_count', v_count);
END;
$$;

CREATE FUNCTION public.unlink_release_offer_match_group(p_match_group_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    DELETE FROM public.release_offer_product_resolutions resolution
    USING public.release_offer_source_rows row, public.release_offer_imports imports
    WHERE row.import_id = resolution.import_id
      AND row.source_row_number = resolution.source_row_number
      AND imports.id = row.import_id
      AND imports.status = 'accepted'
      AND row.match_group_key = p_match_group_key
      AND resolution.status = 'linked';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('status', 'unresolved', 'unlinked_row_count', v_count);
END;
$$;

CREATE FUNCTION public.restore_release_offer_match_group(p_match_group_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    DELETE FROM public.release_offer_product_resolutions resolution
    USING public.release_offer_source_rows row, public.release_offer_imports imports
    WHERE row.import_id = resolution.import_id
      AND row.source_row_number = resolution.source_row_number
      AND imports.id = row.import_id
      AND imports.status = 'accepted'
      AND row.match_group_key = p_match_group_key
      AND resolution.status = 'ignored';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('status', 'unresolved', 'restored_row_count', v_count);
END;
$$;

CREATE FUNCTION public.edit_release_offer_match_group(p_match_group_key TEXT, p_parent_sku TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    IF p_parent_sku !~ '^\d{5,30}$' THEN RAISE EXCEPTION 'invalid parent SKU' USING ERRCODE = '22023'; END IF;
    UPDATE public.release_offer_product_resolutions resolution
    SET parent_sku = p_parent_sku, match_method = 'manual', match_run_id = NULL,
        resolved_by = (SELECT auth.uid()), resolved_at = now()
    FROM public.release_offer_source_rows row, public.release_offer_imports imports
    WHERE row.import_id = resolution.import_id
      AND row.source_row_number = resolution.source_row_number
      AND imports.id = row.import_id
      AND imports.status = 'accepted'
      AND row.match_group_key = p_match_group_key
      AND resolution.status = 'linked';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('status', 'linked', 'edited_row_count', v_count, 'parent_sku', p_parent_sku);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_release_offer_product_resolution(
    p_import_id UUID,
    p_source_row_number INT,
    p_parent_sku TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    IF p_parent_sku !~ '^\d{5,30}$' THEN RAISE EXCEPTION 'invalid parent SKU' USING ERRCODE = '22023'; END IF;
    PERFORM 1 FROM public.release_offer_source_rows WHERE import_id = p_import_id AND source_row_number = p_source_row_number;
    IF NOT FOUND THEN RAISE EXCEPTION 'source row not found' USING ERRCODE = 'P0002'; END IF;
    INSERT INTO public.release_offer_product_resolutions (import_id, source_row_number, status, parent_sku, match_method, match_run_id, resolved_by)
    VALUES (p_import_id, p_source_row_number, 'linked', p_parent_sku, 'manual', NULL, (SELECT auth.uid()))
    ON CONFLICT (import_id, source_row_number) DO UPDATE
    SET status = EXCLUDED.status, parent_sku = EXCLUDED.parent_sku,
        match_method = EXCLUDED.match_method, match_run_id = NULL,
        resolved_by = EXCLUDED.resolved_by, resolved_at = now();
    RETURN jsonb_build_object('status', 'linked', 'parent_sku', p_parent_sku, 'match_method', 'manual');
END;
$$;

CREATE VIEW public.release_offer_match_review_view
WITH (security_invoker = TRUE)
AS
WITH grouped AS (
    SELECT
        row.match_group_key,
        min(row.source_wine) AS source_wine,
        min(row.source_vintage) AS source_vintage,
        min(row.offer_date) AS earliest_offer_date,
        max(row.offer_date) AS latest_offer_date,
        count(*)::INT AS source_row_count,
        count(*) FILTER (WHERE resolution.import_id IS NULL)::INT AS unresolved_row_count,
        count(*) FILTER (WHERE resolution.status = 'linked')::INT AS linked_row_count,
        count(*) FILTER (WHERE resolution.status = 'ignored')::INT AS suppressed_row_count,
        CASE WHEN count(DISTINCT resolution.parent_sku) FILTER (WHERE resolution.status = 'linked') = 1
            THEN min(resolution.parent_sku) FILTER (WHERE resolution.status = 'linked') END AS parent_sku,
        CASE WHEN count(DISTINCT resolution.match_method) FILTER (WHERE resolution.status = 'linked') = 1
            THEN min(resolution.match_method) FILTER (WHERE resolution.status = 'linked') END AS match_method
    FROM public.release_offer_source_rows row
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    LEFT JOIN public.release_offer_product_resolutions resolution
      ON resolution.import_id = row.import_id AND resolution.source_row_number = row.source_row_number
    WHERE imports.status = 'accepted'
    GROUP BY row.match_group_key
), suggestion_stats AS (
    SELECT match_group_key, count(*)::INT AS suggestion_count, max(observed_at) AS suggestions_observed_at
    FROM public.release_offer_match_suggestions
    GROUP BY match_group_key
)
SELECT grouped.*,
    EXISTS (
        SELECT 1 FROM public.catalogue_view catalogue
        WHERE catalogue.parent_sku = grouped.parent_sku
    ) AS is_biddable,
    coalesce(suggestion_stats.suggestion_count, 0) AS suggestion_count,
    suggestion_stats.suggestions_observed_at
FROM grouped
LEFT JOIN suggestion_stats USING (match_group_key);

CREATE VIEW public.release_offer_match_suggestion_view
WITH (security_invoker = TRUE)
AS
SELECT suggestion.match_group_key, suggestion.parent_sku, suggestion.source_run_id,
    suggestion.rank, suggestion.name, suggestion.vintage, suggestion.producer,
    suggestion.region, suggestion.stock_origin, suggestion.purchase_mode,
    suggestion.product_url, suggestion.matched_words, suggestion.typo_count,
    EXISTS (
        SELECT 1 FROM public.catalogue_view catalogue
        WHERE catalogue.parent_sku = suggestion.parent_sku
    ) AS is_biddable,
    suggestion.observed_at
FROM public.release_offer_match_suggestions suggestion;

REVOKE ALL ON public.release_offer_match_review_view,
    public.release_offer_match_suggestion_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.release_offer_match_review_view,
    public.release_offer_match_suggestion_view TO authenticated;

REVOKE ALL ON FUNCTION
    public.begin_release_offer_match_run(),
    public.record_release_offer_algolia_result(UUID, TEXT, JSONB, TEXT[], BOOLEAN, TIMESTAMPTZ),
    public.record_release_offer_algolia_error(UUID, TEXT, TEXT),
    public.confirm_release_offer_match_group(TEXT, TEXT, TEXT),
    public.suppress_release_offer_match_group(TEXT),
    public.unlink_release_offer_match_group(TEXT),
    public.restore_release_offer_match_group(TEXT),
    public.edit_release_offer_match_group(TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.begin_release_offer_match_run(),
    public.record_release_offer_algolia_result(UUID, TEXT, JSONB, TEXT[], BOOLEAN, TIMESTAMPTZ),
    public.record_release_offer_algolia_error(UUID, TEXT, TEXT),
    public.confirm_release_offer_match_group(TEXT, TEXT, TEXT),
    public.suppress_release_offer_match_group(TEXT),
    public.unlink_release_offer_match_group(TEXT),
    public.restore_release_offer_match_group(TEXT),
    public.edit_release_offer_match_group(TEXT, TEXT)
    TO authenticated;
