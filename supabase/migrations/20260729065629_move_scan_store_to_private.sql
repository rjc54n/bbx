-- Keep the public schema as the Data API contract and move the scanner's raw
-- store behind the existing, non-exposed private schema. ALTER ... SET SCHEMA
-- preserves data, indexes, constraints, sequences and dependent view bindings.

DO $$
BEGIN
    IF to_regclass('public._migrations') IS NOT NULL
       AND to_regclass('private._migrations') IS NOT NULL THEN
        RAISE EXCEPTION 'both public._migrations and private._migrations exist';
    ELSIF to_regclass('public._migrations') IS NOT NULL THEN
        ALTER TABLE public._migrations SET SCHEMA private;
    ELSIF to_regclass('private._migrations') IS NULL THEN
        -- Clean Supabase migration replays do not run the scanner bootstrap,
        -- so create its empty ledger in the final production location.
        CREATE TABLE private._migrations (
            name TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    END IF;
END;
$$;

ALTER TABLE public.scan_runs SET SCHEMA private;
ALTER TABLE public.products SET SCHEMA private;
ALTER TABLE public.skus SET SCHEMA private;
ALTER TABLE public.offers SET SCHEMA private;
ALTER TABLE public.observation_events SET SCHEMA private;

REVOKE ALL ON TABLE private._migrations
    FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE
    private.scan_runs,
    private.products,
    private.skus,
    private.offers,
    private.observation_events
    FROM PUBLIC, anon, authenticated, service_role;

-- The private schema is not in PostgREST's exposed-schema list. These grants
-- let the invoker views execute without creating raw Data API endpoints.
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;
GRANT SELECT ON TABLE
    private.scan_runs,
    private.products,
    private.skus,
    private.offers,
    private.observation_events
    TO anon, authenticated, service_role;

ALTER VIEW public.scan_health_view SET (security_invoker = TRUE);
ALTER VIEW public.product_detail_view SET (security_invoker = TRUE);
ALTER VIEW public.price_history_view SET (security_invoker = TRUE);
ALTER VIEW public.candidate_view SET (security_invoker = TRUE);
ALTER VIEW public.catalogue_view SET (security_invoker = TRUE);
ALTER VIEW public.facet_ranges_view SET (security_invoker = TRUE);
ALTER VIEW public.recent_price_change_view SET (security_invoker = TRUE);
ALTER VIEW public.facet_values_view SET (security_invoker = TRUE);
ALTER VIEW public.format_options_view SET (security_invoker = TRUE);

-- These are the two deployed function bodies that address the scan store by
-- schema-qualified name. Preserve their API and authorization behaviour while
-- following products into private.
CREATE OR REPLACE FUNCTION public.begin_release_offer_match_run()
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
        JOIN private.products product ON product.vintage = group_row.source_vintage
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

CREATE OR REPLACE FUNCTION public.record_release_offer_algolia_result(
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
            SELECT 1 FROM private.products product
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
