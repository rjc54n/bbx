-- CellarTracker catalogue matching mirrors the historic release-offer workflow.
-- Matching is restricted to the latest accepted full snapshot and links at
-- Parent ID grain. Current BBX eligibility remains a separate, live property.

ALTER TABLE public.cellartracker_evidence
    ADD COLUMN match_group_key TEXT GENERATED ALWAYS AS (
        coalesce(vintage::TEXT, 'unknown') || '|' || source_match_key
    ) STORED;

CREATE INDEX idx_cellartracker_evidence_match_group
    ON public.cellartracker_evidence(match_group_key, import_id, source_row_number);

CREATE TABLE public.cellartracker_match_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_import_id UUID NOT NULL REFERENCES public.cellar_imports(id),
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'partial', 'failed')),
    algorithm_version TEXT NOT NULL DEFAULT 'cellartracker-prod-product-v1',
    catalogue_index TEXT NOT NULL DEFAULT 'prod_product',
    started_by UUID NOT NULL REFERENCES auth.users(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    finished_at TIMESTAMPTZ,
    algolia_observed_at TIMESTAMPTZ,
    total_group_count INT NOT NULL DEFAULT 0 CHECK (total_group_count >= 0),
    processed_group_count INT NOT NULL DEFAULT 0 CHECK (processed_group_count >= 0),
    remaining_group_count INT NOT NULL DEFAULT 0 CHECK (remaining_group_count >= 0),
    error_group_count INT NOT NULL DEFAULT 0 CHECK (error_group_count >= 0),
    local_exact_link_count INT NOT NULL DEFAULT 0 CHECK (local_exact_link_count >= 0),
    algolia_exact_link_count INT NOT NULL DEFAULT 0 CHECK (algolia_exact_link_count >= 0),
    error_message TEXT
);

CREATE TABLE public.cellartracker_match_run_groups (
    run_id UUID NOT NULL REFERENCES public.cellartracker_match_runs(id) ON DELETE CASCADE,
    match_group_key TEXT NOT NULL,
    source_match_key TEXT NOT NULL,
    source_vintage INT,
    source_wine TEXT NOT NULL,
    source_producer TEXT,
    source_region TEXT,
    source_row_count INT NOT NULL CHECK (source_row_count > 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processed', 'failed')),
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    PRIMARY KEY (run_id, match_group_key)
);

CREATE INDEX idx_cellartracker_match_run_groups_work
    ON public.cellartracker_match_run_groups(run_id, status, match_group_key);

CREATE TABLE public.cellartracker_match_suggestions (
    match_group_key TEXT NOT NULL,
    parent_sku TEXT NOT NULL CHECK (parent_sku ~ '^\d{5,30}$'),
    source_run_id UUID NOT NULL REFERENCES public.cellartracker_match_runs(id) ON DELETE CASCADE,
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

ALTER TABLE public.cellartracker_product_resolutions
    ADD COLUMN match_run_id UUID REFERENCES public.cellartracker_match_runs(id);

ALTER TABLE public.cellartracker_match_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cellartracker_match_run_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cellartracker_match_suggestions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cellartracker_match_runs,
    public.cellartracker_match_run_groups,
    public.cellartracker_match_suggestions
    FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.cellartracker_match_runs,
    public.cellartracker_match_run_groups,
    public.cellartracker_match_suggestions
    TO authenticated;

CREATE POLICY "Owner reads CellarTracker match runs"
    ON public.cellartracker_match_runs FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner reads CellarTracker match groups"
    ON public.cellartracker_match_run_groups FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner reads CellarTracker suggestions"
    ON public.cellartracker_match_suggestions FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));

CREATE OR REPLACE FUNCTION private.audit_cellartracker_resolution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_event_type TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_type := CASE WHEN NEW.status = 'suppressed' THEN 'suppressed' ELSE 'linked' END;
        INSERT INTO public.cellartracker_resolution_events (
            import_id, source_row_number, event_type, parent_sku, changed_by
        ) VALUES (
            NEW.import_id, NEW.source_row_number, v_event_type, NEW.parent_sku, NEW.resolved_by
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        v_event_type := CASE
            WHEN NEW.status = 'suppressed' THEN 'suppressed'
            WHEN OLD.status = 'suppressed' AND NEW.status = 'linked' THEN 'linked'
            ELSE 'edited'
        END;
        INSERT INTO public.cellartracker_resolution_events (
            import_id, source_row_number, event_type,
            previous_parent_sku, parent_sku, changed_by
        ) VALUES (
            NEW.import_id, NEW.source_row_number, v_event_type,
            OLD.parent_sku, NEW.parent_sku, NEW.resolved_by
        );
        RETURN NEW;
    END IF;

    IF current_setting('app.cellartracker_match_group_delete', TRUE) = 'on' THEN
        RETURN OLD;
    END IF;

    v_event_type := CASE WHEN OLD.status = 'suppressed' THEN 'restored' ELSE 'unlinked' END;
    INSERT INTO public.cellartracker_resolution_events (
        import_id, source_row_number, event_type, previous_parent_sku, changed_by
    ) VALUES (
        OLD.import_id, OLD.source_row_number, v_event_type, OLD.parent_sku, (SELECT auth.uid())
    );
    RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.audit_cellartracker_resolution()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_cellartracker_resolution
AFTER INSERT OR UPDATE OR DELETE ON public.cellartracker_product_resolutions
FOR EACH ROW EXECUTE FUNCTION private.audit_cellartracker_resolution();

CREATE FUNCTION private.refresh_cellartracker_match_run(p_run_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_processed INT; v_pending INT; v_failed INT;
BEGIN
    SELECT count(*) FILTER (WHERE status = 'processed')::INT,
        count(*) FILTER (WHERE status = 'pending')::INT,
        count(*) FILTER (WHERE status = 'failed')::INT
    INTO v_processed, v_pending, v_failed
    FROM public.cellartracker_match_run_groups
    WHERE run_id = p_run_id;

    UPDATE public.cellartracker_match_runs
    SET processed_group_count = v_processed,
        remaining_group_count = v_pending,
        error_group_count = v_failed,
        status = CASE WHEN v_pending > 0 THEN 'running'
            WHEN v_failed > 0 THEN 'partial' ELSE 'completed' END,
        finished_at = CASE WHEN v_pending = 0 THEN now() ELSE NULL END
    WHERE id = p_run_id;
END;
$$;

REVOKE ALL ON FUNCTION private.refresh_cellartracker_match_run(UUID)
    FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.begin_cellartracker_match_run()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_run_id UUID; v_snapshot_id UUID; v_local_exact INT := 0; v_groups INT := 0;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_snapshot_id
    FROM public.cellar_imports
    WHERE source_type = 'cellartracker_inventory' AND status = 'accepted'
    ORDER BY accepted_at DESC, id DESC LIMIT 1;
    IF v_snapshot_id IS NULL THEN
        RAISE EXCEPTION 'no accepted CellarTracker snapshot' USING ERRCODE = 'P0002';
    END IF;

    SELECT id INTO v_run_id
    FROM public.cellartracker_match_runs
    WHERE snapshot_import_id = v_snapshot_id AND status IN ('running', 'partial')
    ORDER BY started_at DESC LIMIT 1 FOR UPDATE;

    IF FOUND THEN
        UPDATE public.cellartracker_match_run_groups
        SET status = 'pending', error_message = NULL, processed_at = NULL
        WHERE run_id = v_run_id AND status = 'failed';
        UPDATE public.cellartracker_match_runs
        SET status = 'running', finished_at = NULL, error_message = NULL
        WHERE id = v_run_id;
        PERFORM private.refresh_cellartracker_match_run(v_run_id);
        RETURN jsonb_build_object('run_id', v_run_id, 'resumed', TRUE);
    END IF;

    INSERT INTO public.cellartracker_match_runs (snapshot_import_id, started_by)
    VALUES (v_snapshot_id, (SELECT auth.uid())) RETURNING id INTO v_run_id;

    WITH unresolved_groups AS (
        SELECT DISTINCT evidence.match_group_key, evidence.source_match_key, evidence.vintage
        FROM public.cellartracker_evidence evidence
        LEFT JOIN public.cellartracker_product_resolutions resolution
          ON resolution.import_id = evidence.import_id
         AND resolution.source_row_number = evidence.source_row_number
        WHERE evidence.import_id = v_snapshot_id
          AND resolution.import_id IS NULL
          AND evidence.vintage IS NOT NULL
    ), unique_matches AS (
        SELECT source.match_group_key, min(product.parent_sku) AS parent_sku
        FROM unresolved_groups source
        JOIN private.products product ON product.vintage = source.vintage
          AND private.release_wine_match_key(product.name, product.vintage) = source.source_match_key
        GROUP BY source.match_group_key
        HAVING count(DISTINCT product.parent_sku) = 1
    )
    INSERT INTO public.cellartracker_product_resolutions (
        import_id, source_row_number, status, parent_sku,
        match_method, match_run_id, resolved_by
    )
    SELECT evidence.import_id, evidence.source_row_number, 'linked', match.parent_sku,
        'local_exact', v_run_id, (SELECT auth.uid())
    FROM public.cellartracker_evidence evidence
    JOIN unique_matches match ON match.match_group_key = evidence.match_group_key
    LEFT JOIN public.cellartracker_product_resolutions resolution
      ON resolution.import_id = evidence.import_id
     AND resolution.source_row_number = evidence.source_row_number
    WHERE evidence.import_id = v_snapshot_id AND resolution.import_id IS NULL;
    GET DIAGNOSTICS v_local_exact = ROW_COUNT;

    INSERT INTO public.cellartracker_match_run_groups (
        run_id, match_group_key, source_match_key, source_vintage,
        source_wine, source_producer, source_region, source_row_count
    )
    SELECT v_run_id, evidence.match_group_key, min(evidence.source_match_key),
        min(evidence.vintage), min(evidence.source_wine), min(evidence.producer),
        min(evidence.region), count(*)::INT
    FROM public.cellartracker_evidence evidence
    LEFT JOIN public.cellartracker_product_resolutions resolution
      ON resolution.import_id = evidence.import_id
     AND resolution.source_row_number = evidence.source_row_number
    WHERE evidence.import_id = v_snapshot_id AND resolution.import_id IS NULL
    GROUP BY evidence.match_group_key;
    GET DIAGNOSTICS v_groups = ROW_COUNT;

    UPDATE public.cellartracker_match_runs
    SET local_exact_link_count = v_local_exact,
        total_group_count = v_groups,
        remaining_group_count = v_groups,
        status = CASE WHEN v_groups = 0 THEN 'completed' ELSE 'running' END,
        finished_at = CASE WHEN v_groups = 0 THEN now() END
    WHERE id = v_run_id;

    RETURN jsonb_build_object(
        'run_id', v_run_id, 'resumed', FALSE,
        'local_exact_link_count', v_local_exact,
        'remaining_group_count', v_groups
    );
END;
$$;

CREATE FUNCTION public.record_cellartracker_algolia_result(
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
    v_group public.cellartracker_match_run_groups%ROWTYPE;
    v_snapshot_id UUID; v_exact_parent_skus TEXT[]; v_exact_parent_sku TEXT; v_linked INT := 0;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    IF jsonb_typeof(p_candidates) <> 'array' OR jsonb_array_length(p_candidates) > 5 THEN
        RAISE EXCEPTION 'p_candidates must be an array of at most five results' USING ERRCODE = '22023';
    END IF;

    SELECT groups.* INTO v_group
    FROM public.cellartracker_match_run_groups groups
    WHERE groups.run_id = p_run_id AND groups.match_group_key = p_match_group_key
    FOR UPDATE OF groups;
    IF NOT FOUND THEN RAISE EXCEPTION 'match group not found' USING ERRCODE = 'P0002'; END IF;
    SELECT snapshot_import_id INTO v_snapshot_id
    FROM public.cellartracker_match_runs WHERE id = p_run_id;
    IF v_group.status = 'processed' THEN
        RETURN jsonb_build_object('status', 'processed', 'already_processed', TRUE);
    END IF;

    SELECT coalesce(array_agg(DISTINCT value), '{}') INTO v_exact_parent_skus
    FROM unnest(coalesce(p_exact_parent_skus, '{}')) value
    WHERE value ~ '^\d{5,30}$';

    DELETE FROM public.cellartracker_match_suggestions WHERE match_group_key = p_match_group_key;

    WITH candidates AS (
        SELECT * FROM jsonb_to_recordset(p_candidates) AS candidate(
            rank INT, parent_sku TEXT, name TEXT, vintage INT, producer TEXT,
            region TEXT, stock_origin TEXT, purchase_mode TEXT, product_url TEXT,
            matched_words TEXT[], typo_count INT
        )
    )
    INSERT INTO public.cellartracker_match_suggestions (
        match_group_key, parent_sku, source_run_id, rank, name, vintage,
        producer, region, stock_origin, purchase_mode, product_url,
        matched_words, typo_count, was_biddable_at_observation, observed_at
    )
    SELECT p_match_group_key, candidate.parent_sku, p_run_id, candidate.rank,
        candidate.name, candidate.vintage, candidate.producer, candidate.region,
        candidate.stock_origin, candidate.purchase_mode, candidate.product_url,
        coalesce(candidate.matched_words, '{}'), candidate.typo_count,
        EXISTS (SELECT 1 FROM private.products product
            WHERE product.parent_sku = candidate.parent_sku AND product.gone_since IS NULL),
        p_observed_at
    FROM candidates candidate
    WHERE candidate.rank BETWEEN 1 AND 5
      AND candidate.parent_sku ~ '^\d{5,30}$'
      AND nullif(btrim(candidate.name), '') IS NOT NULL;

    IF p_exhaustive AND v_group.source_vintage IS NOT NULL
       AND cardinality(v_exact_parent_skus) = 1 THEN
        v_exact_parent_sku := v_exact_parent_skus[1];
        INSERT INTO public.cellartracker_product_resolutions (
            import_id, source_row_number, status, parent_sku,
            match_method, match_run_id, resolved_by
        )
        SELECT evidence.import_id, evidence.source_row_number, 'linked', v_exact_parent_sku,
            'algolia_exact', p_run_id, (SELECT auth.uid())
        FROM public.cellartracker_evidence evidence
        LEFT JOIN public.cellartracker_product_resolutions resolution
          ON resolution.import_id = evidence.import_id
         AND resolution.source_row_number = evidence.source_row_number
        WHERE evidence.import_id = v_snapshot_id
          AND evidence.match_group_key = p_match_group_key
          AND resolution.import_id IS NULL;
        GET DIAGNOSTICS v_linked = ROW_COUNT;
    END IF;

    UPDATE public.cellartracker_match_run_groups
    SET status = 'processed', processed_at = now(), error_message = NULL
    WHERE run_id = p_run_id AND match_group_key = p_match_group_key;
    UPDATE public.cellartracker_match_runs
    SET algolia_observed_at = greatest(algolia_observed_at, p_observed_at),
        algolia_exact_link_count = algolia_exact_link_count + v_linked
    WHERE id = p_run_id;
    PERFORM private.refresh_cellartracker_match_run(p_run_id);
    RETURN jsonb_build_object('status', 'processed', 'linked_row_count', v_linked);
END;
$$;

CREATE FUNCTION public.record_cellartracker_algolia_error(
    p_run_id UUID, p_match_group_key TEXT, p_error_message TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    UPDATE public.cellartracker_match_run_groups
    SET status = 'failed', processed_at = now(), error_message = left(p_error_message, 1000)
    WHERE run_id = p_run_id AND match_group_key = p_match_group_key AND status <> 'processed';
    IF NOT FOUND THEN RAISE EXCEPTION 'match group not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM private.refresh_cellartracker_match_run(p_run_id);
    RETURN jsonb_build_object('status', 'failed');
END;
$$;

CREATE FUNCTION public.confirm_cellartracker_match_group(
    p_match_group_key TEXT, p_parent_sku TEXT, p_method TEXT DEFAULT 'algolia_confirmed'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_snapshot_id UUID; v_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    IF p_parent_sku !~ '^\d{5,30}$' OR p_method NOT IN ('algolia_confirmed', 'manual') THEN
        RAISE EXCEPTION 'invalid group resolution' USING ERRCODE = '22023';
    END IF;
    SELECT id INTO v_snapshot_id FROM public.cellar_imports
    WHERE source_type = 'cellartracker_inventory' AND status = 'accepted'
    ORDER BY accepted_at DESC, id DESC LIMIT 1;
    INSERT INTO public.cellartracker_product_resolutions (
        import_id, source_row_number, status, parent_sku, match_method, resolved_by
    )
    SELECT evidence.import_id, evidence.source_row_number, 'linked', p_parent_sku,
        p_method, (SELECT auth.uid())
    FROM public.cellartracker_evidence evidence
    LEFT JOIN public.cellartracker_product_resolutions resolution
      ON resolution.import_id = evidence.import_id
     AND resolution.source_row_number = evidence.source_row_number
    WHERE evidence.import_id = v_snapshot_id
      AND evidence.match_group_key = p_match_group_key
      AND resolution.import_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('status', 'linked', 'linked_row_count', v_count, 'parent_sku', p_parent_sku);
END;
$$;

CREATE FUNCTION public.suppress_cellartracker_match_group(p_match_group_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_snapshot_id UUID; v_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    SELECT id INTO v_snapshot_id FROM public.cellar_imports
    WHERE source_type = 'cellartracker_inventory' AND status = 'accepted'
    ORDER BY accepted_at DESC, id DESC LIMIT 1;
    INSERT INTO public.cellartracker_product_resolutions (
        import_id, source_row_number, status, match_method, resolved_by
    )
    SELECT evidence.import_id, evidence.source_row_number, 'suppressed', 'suppressed', (SELECT auth.uid())
    FROM public.cellartracker_evidence evidence
    LEFT JOIN public.cellartracker_product_resolutions resolution
      ON resolution.import_id = evidence.import_id
     AND resolution.source_row_number = evidence.source_row_number
    WHERE evidence.import_id = v_snapshot_id
      AND evidence.match_group_key = p_match_group_key
      AND resolution.import_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('status', 'suppressed', 'suppressed_row_count', v_count);
END;
$$;

CREATE FUNCTION public.unlink_cellartracker_match_group(p_match_group_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_snapshot_id UUID; v_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    SELECT id INTO v_snapshot_id FROM public.cellar_imports
    WHERE source_type = 'cellartracker_inventory' AND status = 'accepted'
    ORDER BY accepted_at DESC, id DESC LIMIT 1;
    DELETE FROM public.cellartracker_product_resolutions resolution
    USING public.cellartracker_evidence evidence
    WHERE evidence.import_id = resolution.import_id
      AND evidence.source_row_number = resolution.source_row_number
      AND evidence.import_id = v_snapshot_id
      AND evidence.match_group_key = p_match_group_key
      AND resolution.status = 'linked';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('status', 'unresolved', 'unlinked_row_count', v_count);
END;
$$;

CREATE FUNCTION public.restore_cellartracker_match_group(p_match_group_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_snapshot_id UUID; v_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    SELECT id INTO v_snapshot_id FROM public.cellar_imports
    WHERE source_type = 'cellartracker_inventory' AND status = 'accepted'
    ORDER BY accepted_at DESC, id DESC LIMIT 1;
    DELETE FROM public.cellartracker_product_resolutions resolution
    USING public.cellartracker_evidence evidence
    WHERE evidence.import_id = resolution.import_id
      AND evidence.source_row_number = resolution.source_row_number
      AND evidence.import_id = v_snapshot_id
      AND evidence.match_group_key = p_match_group_key
      AND resolution.status = 'suppressed';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('status', 'unresolved', 'restored_row_count', v_count);
END;
$$;

CREATE FUNCTION public.edit_cellartracker_match_group(p_match_group_key TEXT, p_parent_sku TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_snapshot_id UUID; v_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    IF p_parent_sku !~ '^\d{5,30}$' THEN RAISE EXCEPTION 'invalid parent SKU' USING ERRCODE = '22023'; END IF;
    SELECT id INTO v_snapshot_id FROM public.cellar_imports
    WHERE source_type = 'cellartracker_inventory' AND status = 'accepted'
    ORDER BY accepted_at DESC, id DESC LIMIT 1;
    UPDATE public.cellartracker_product_resolutions resolution
    SET parent_sku = p_parent_sku, match_method = 'manual', match_run_id = NULL,
        resolved_by = (SELECT auth.uid()), resolved_at = now()
    FROM public.cellartracker_evidence evidence
    WHERE evidence.import_id = resolution.import_id
      AND evidence.source_row_number = resolution.source_row_number
      AND evidence.import_id = v_snapshot_id
      AND evidence.match_group_key = p_match_group_key
      AND resolution.status = 'linked';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('status', 'linked', 'edited_row_count', v_count, 'parent_sku', p_parent_sku);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_cellartracker_product_resolution(
    p_import_id UUID, p_source_row_number INT, p_parent_sku TEXT, p_method TEXT DEFAULT 'manual'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    IF p_parent_sku !~ '^\d{5,30}$' OR p_method NOT IN ('manual', 'algolia_confirmed') THEN
        RAISE EXCEPTION 'invalid resolution' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public.cellartracker_evidence
    WHERE import_id = p_import_id AND source_row_number = p_source_row_number;
    IF NOT FOUND THEN RAISE EXCEPTION 'source row not found' USING ERRCODE = 'P0002'; END IF;
    INSERT INTO public.cellartracker_product_resolutions (
        import_id, source_row_number, status, parent_sku, match_method, match_run_id, resolved_by
    ) VALUES (
        p_import_id, p_source_row_number, 'linked', p_parent_sku, p_method, NULL, (SELECT auth.uid())
    ) ON CONFLICT (import_id, source_row_number) DO UPDATE
      SET status = EXCLUDED.status, parent_sku = EXCLUDED.parent_sku,
          match_method = EXCLUDED.match_method, match_run_id = NULL,
          resolved_by = EXCLUDED.resolved_by, resolved_at = now();
    RETURN jsonb_build_object('status', 'linked', 'parent_sku', p_parent_sku);
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_cellartracker_product_resolution(
    p_import_id UUID, p_source_row_number INT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    DELETE FROM public.cellartracker_product_resolutions
    WHERE import_id = p_import_id AND source_row_number = p_source_row_number;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('changed', v_count > 0);
END;
$$;

CREATE FUNCTION public.delete_cellartracker_match_group(p_match_group_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_snapshot_id UUID; v_deleted INT; v_run_id UUID;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    IF p_match_group_key IS NULL OR char_length(trim(p_match_group_key)) = 0 THEN
        RAISE EXCEPTION 'match group key is required' USING ERRCODE = '22023';
    END IF;
    SELECT id INTO v_snapshot_id FROM public.cellar_imports
    WHERE source_type = 'cellartracker_inventory' AND status = 'accepted'
    ORDER BY accepted_at DESC, id DESC LIMIT 1;

    INSERT INTO public.cellartracker_resolution_events (
        import_id, source_row_number, event_type, previous_parent_sku, changed_by
    )
    SELECT evidence.import_id, evidence.source_row_number, 'deleted', resolution.parent_sku,
        (SELECT auth.uid())
    FROM public.cellartracker_evidence evidence
    LEFT JOIN public.cellartracker_product_resolutions resolution
      ON resolution.import_id = evidence.import_id
     AND resolution.source_row_number = evidence.source_row_number
    WHERE evidence.import_id = v_snapshot_id AND evidence.match_group_key = p_match_group_key;

    DELETE FROM public.cellartracker_match_suggestions WHERE match_group_key = p_match_group_key;
    FOR v_run_id IN
        DELETE FROM public.cellartracker_match_run_groups
        WHERE match_group_key = p_match_group_key AND status <> 'processed'
        RETURNING run_id
    LOOP
        PERFORM private.refresh_cellartracker_match_run(v_run_id);
    END LOOP;

    PERFORM set_config('app.cellartracker_match_group_delete', 'on', TRUE);
    DELETE FROM public.cellar_import_rows rows
    USING public.cellartracker_evidence evidence
    WHERE rows.import_id = evidence.import_id
      AND rows.source_row_number = evidence.source_row_number
      AND evidence.import_id = v_snapshot_id
      AND evidence.match_group_key = p_match_group_key;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted = 0 THEN RAISE EXCEPTION 'match group not found' USING ERRCODE = 'P0002'; END IF;

    UPDATE public.cellar_imports imports
    SET source_row_count = source_row_count - v_deleted,
        parsed_row_count = parsed_row_count - v_deleted,
        unmatched_row_count = greatest(0, unmatched_row_count - v_deleted)
    WHERE imports.id = v_snapshot_id;
    RETURN jsonb_build_object('match_group_key', p_match_group_key, 'deleted_row_count', v_deleted);
END;
$$;

CREATE VIEW public.cellartracker_match_review_view
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

CREATE VIEW public.cellartracker_match_suggestion_view
WITH (security_invoker = TRUE)
AS
SELECT suggestion.match_group_key, suggestion.parent_sku, suggestion.source_run_id,
    suggestion.rank, suggestion.name, suggestion.vintage, suggestion.producer,
    suggestion.region, suggestion.stock_origin, suggestion.purchase_mode,
    suggestion.product_url, suggestion.matched_words, suggestion.typo_count,
    EXISTS (SELECT 1 FROM public.catalogue_view catalogue
        WHERE catalogue.parent_sku = suggestion.parent_sku) AS is_biddable,
    suggestion.observed_at
FROM public.cellartracker_match_suggestions suggestion;

REVOKE ALL ON public.cellartracker_match_review_view,
    public.cellartracker_match_suggestion_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cellartracker_match_review_view,
    public.cellartracker_match_suggestion_view TO authenticated;

REVOKE ALL ON FUNCTION
    public.begin_cellartracker_match_run(),
    public.record_cellartracker_algolia_result(UUID, TEXT, JSONB, TEXT[], BOOLEAN, TIMESTAMPTZ),
    public.record_cellartracker_algolia_error(UUID, TEXT, TEXT),
    public.confirm_cellartracker_match_group(TEXT, TEXT, TEXT),
    public.suppress_cellartracker_match_group(TEXT),
    public.unlink_cellartracker_match_group(TEXT),
    public.restore_cellartracker_match_group(TEXT),
    public.edit_cellartracker_match_group(TEXT, TEXT),
    public.delete_cellartracker_match_group(TEXT)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.begin_cellartracker_match_run(),
    public.record_cellartracker_algolia_result(UUID, TEXT, JSONB, TEXT[], BOOLEAN, TIMESTAMPTZ),
    public.record_cellartracker_algolia_error(UUID, TEXT, TEXT),
    public.confirm_cellartracker_match_group(TEXT, TEXT, TEXT),
    public.suppress_cellartracker_match_group(TEXT),
    public.unlink_cellartracker_match_group(TEXT),
    public.restore_cellartracker_match_group(TEXT),
    public.edit_cellartracker_match_group(TEXT, TEXT),
    public.delete_cellartracker_match_group(TEXT)
    TO authenticated;
