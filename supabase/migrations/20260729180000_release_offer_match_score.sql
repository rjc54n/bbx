-- Retrieval evidence, not match probability: the score records how much of the
-- two identities overlapped, so review can triage without re-deriving it.
ALTER TABLE public.release_offer_match_suggestions
    ADD COLUMN match_score NUMERIC(4,3)
        CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 1);

-- Signature is unchanged: the exhaustive validation pass still owns
-- p_exact_parent_skus and p_exhaustive. Only the candidate recordset gains a
-- column.
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
            matched_words TEXT[], typo_count INT, match_score NUMERIC
        )
    )
    INSERT INTO public.release_offer_match_suggestions (
        match_group_key, parent_sku, source_run_id, rank, name, vintage,
        producer, region, stock_origin, purchase_mode, product_url,
        matched_words, typo_count, match_score, was_biddable_at_observation, observed_at
    )
    SELECT p_match_group_key, candidate.parent_sku, p_run_id, candidate.rank,
        candidate.name, candidate.vintage, candidate.producer, candidate.region,
        candidate.stock_origin, candidate.purchase_mode, candidate.product_url,
        coalesce(candidate.matched_words, '{}'), candidate.typo_count,
        round(candidate.match_score, 3),
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

CREATE OR REPLACE VIEW public.release_offer_match_suggestion_view
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
    suggestion.observed_at,
    -- Appended, not inserted: CREATE OR REPLACE VIEW can only add trailing columns.
    suggestion.match_score
FROM public.release_offer_match_suggestions suggestion;
