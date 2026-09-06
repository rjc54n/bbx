-- Persist versioned match evidence so the review queue can sort and filter on
-- stored scalar fields. Matching remains at Parent ID grain; release evidence
-- remains at Parent ID plus format grain.

ALTER TABLE public.release_offer_match_suggestions
    ADD COLUMN algorithm_version TEXT,
    ADD COLUMN evidence_score NUMERIC(5,4),
    ADD COLUMN score_margin NUMERIC(5,4),
    ADD COLUMN review_band TEXT,
    ADD COLUMN review_priority SMALLINT,
    ADD COLUMN impact_band TEXT,
    ADD COLUMN risk_flags TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN match_reasons TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN comparison_evidence JSONB;

ALTER TABLE public.cellartracker_match_suggestions
    ADD COLUMN algorithm_version TEXT,
    ADD COLUMN evidence_score NUMERIC(5,4),
    ADD COLUMN score_margin NUMERIC(5,4),
    ADD COLUMN review_band TEXT,
    ADD COLUMN review_priority SMALLINT,
    ADD COLUMN impact_band TEXT,
    ADD COLUMN risk_flags TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN match_reasons TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN comparison_evidence JSONB;

ALTER TABLE public.release_offer_match_suggestions
    ADD CONSTRAINT release_offer_suggestion_algorithm_version_check
        CHECK (algorithm_version IS NULL OR nullif(btrim(algorithm_version), '') IS NOT NULL),
    ADD CONSTRAINT release_offer_suggestion_evidence_score_check
        CHECK (evidence_score IS NULL OR evidence_score BETWEEN 0 AND 1),
    ADD CONSTRAINT release_offer_suggestion_score_margin_check
        CHECK (score_margin IS NULL OR (rank = 1 AND score_margin BETWEEN 0 AND 1)),
    ADD CONSTRAINT release_offer_suggestion_review_band_check
        CHECK (review_band IS NULL OR review_band IN ('likely', 'ambiguous', 'weak')),
    ADD CONSTRAINT release_offer_suggestion_review_priority_check
        CHECK (review_priority IS NULL OR review_priority BETWEEN 1 AND 99),
    ADD CONSTRAINT release_offer_suggestion_impact_band_check
        CHECK (impact_band IS NULL OR impact_band IN ('current_market', 'source_evidence', 'identity_only')),
    ADD CONSTRAINT release_offer_suggestion_comparison_evidence_check
        CHECK (comparison_evidence IS NULL OR jsonb_typeof(comparison_evidence) = 'object'),
    ADD CONSTRAINT release_offer_suggestion_v2_completeness_check
        CHECK (algorithm_version IS NULL OR (
            evidence_score IS NOT NULL AND review_band IS NOT NULL
            AND review_priority IS NOT NULL AND impact_band IS NOT NULL
            AND comparison_evidence IS NOT NULL
        ));

ALTER TABLE public.cellartracker_match_suggestions
    ADD CONSTRAINT cellartracker_suggestion_algorithm_version_check
        CHECK (algorithm_version IS NULL OR nullif(btrim(algorithm_version), '') IS NOT NULL),
    ADD CONSTRAINT cellartracker_suggestion_evidence_score_check
        CHECK (evidence_score IS NULL OR evidence_score BETWEEN 0 AND 1),
    ADD CONSTRAINT cellartracker_suggestion_score_margin_check
        CHECK (score_margin IS NULL OR (rank = 1 AND score_margin BETWEEN 0 AND 1)),
    ADD CONSTRAINT cellartracker_suggestion_review_band_check
        CHECK (review_band IS NULL OR review_band IN ('likely', 'ambiguous', 'weak')),
    ADD CONSTRAINT cellartracker_suggestion_review_priority_check
        CHECK (review_priority IS NULL OR review_priority BETWEEN 1 AND 99),
    ADD CONSTRAINT cellartracker_suggestion_impact_band_check
        CHECK (impact_band IS NULL OR impact_band IN ('current_market', 'source_evidence', 'identity_only')),
    ADD CONSTRAINT cellartracker_suggestion_comparison_evidence_check
        CHECK (comparison_evidence IS NULL OR jsonb_typeof(comparison_evidence) = 'object'),
    ADD CONSTRAINT cellartracker_suggestion_v2_completeness_check
        CHECK (algorithm_version IS NULL OR (
            evidence_score IS NOT NULL AND review_band IS NOT NULL
            AND review_priority IS NOT NULL AND impact_band IS NOT NULL
            AND comparison_evidence IS NOT NULL
        ));

CREATE INDEX idx_release_offer_suggestions_review_priority
    ON public.release_offer_match_suggestions
        (review_priority, evidence_score DESC, match_group_key)
    WHERE rank = 1;

CREATE INDEX idx_cellartracker_suggestions_review_priority
    ON public.cellartracker_match_suggestions
        (review_priority, evidence_score DESC, match_group_key)
    WHERE rank = 1;

CREATE FUNCTION private.match_review_priority(p_review_band TEXT, p_impact_band TEXT)
RETURNS SMALLINT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_review_band = 'likely' AND p_impact_band = 'current_market' THEN 10
        WHEN p_review_band = 'ambiguous' AND p_impact_band = 'current_market' THEN 20
        WHEN p_review_band = 'likely' AND p_impact_band = 'source_evidence' THEN 30
        WHEN p_review_band = 'ambiguous' AND p_impact_band = 'source_evidence' THEN 40
        WHEN p_review_band = 'weak' THEN 50
        WHEN p_impact_band = 'identity_only' THEN 60
        ELSE 90
    END::SMALLINT;
$$;

REVOKE ALL ON FUNCTION private.match_review_priority(TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;

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
    v_valid_fragment_count INT := 0;
    v_valid_format_count INT := 0;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(p_candidates) <> 'array' OR jsonb_array_length(p_candidates) > 5 THEN
        RAISE EXCEPTION 'p_candidates must be an array of at most five results' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_candidates) candidate
        WHERE coalesce((candidate->>'rank')::INT, 0) <> 1
          AND candidate->'score_margin' IS NOT NULL
          AND jsonb_typeof(candidate->'score_margin') <> 'null'
    ) THEN
        RAISE EXCEPTION 'score_margin is only valid for rank 1' USING ERRCODE = '22023';
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

    SELECT count(*)::INT, count(DISTINCT price.format_code)::INT
    INTO v_valid_fragment_count, v_valid_format_count
    FROM public.release_offer_source_rows row
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    JOIN public.release_offer_prices price
      ON price.import_id = row.import_id
     AND price.source_row_number = row.source_row_number
    WHERE imports.status = 'accepted'
      AND row.match_group_key = p_match_group_key
      AND price.parse_status = 'valid'
      AND price.tax_basis = 'in_bond'
      AND price.format_code IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.release_offer_record_exclusions exclusion
          WHERE exclusion.content_fingerprint = row.content_fingerprint
      );

    DELETE FROM public.release_offer_match_suggestions
    WHERE match_group_key = p_match_group_key;

    WITH candidates AS (
        SELECT * FROM jsonb_to_recordset(p_candidates) AS candidate(
            rank INT, parent_sku TEXT, name TEXT, vintage INT, producer TEXT,
            region TEXT, stock_origin TEXT, purchase_mode TEXT, product_url TEXT,
            matched_words TEXT[], typo_count INT, match_score NUMERIC,
            algorithm_version TEXT, evidence_score NUMERIC, score_margin NUMERIC,
            review_band TEXT, risk_flags TEXT[], match_reasons TEXT[],
            comparison_evidence JSONB
        )
    ), prepared AS (
        SELECT candidate.*,
            EXISTS (
                SELECT 1 FROM private.products product
                WHERE product.parent_sku = candidate.parent_sku
                  AND product.gone_since IS NULL
            ) AS was_biddable,
            CASE
                WHEN candidate.algorithm_version IS NULL THEN NULL
                WHEN v_valid_fragment_count = 0 OR v_valid_format_count = 0 THEN 'identity_only'
                WHEN EXISTS (
                    SELECT 1 FROM private.products product
                    WHERE product.parent_sku = candidate.parent_sku
                      AND product.gone_since IS NULL
                ) THEN 'current_market'
                ELSE 'source_evidence'
            END AS calculated_impact_band
        FROM candidates candidate
    )
    INSERT INTO public.release_offer_match_suggestions (
        match_group_key, parent_sku, source_run_id, rank, name, vintage,
        producer, region, stock_origin, purchase_mode, product_url,
        matched_words, typo_count, match_score, was_biddable_at_observation, observed_at,
        algorithm_version, evidence_score, score_margin, review_band,
        review_priority, impact_band, risk_flags, match_reasons, comparison_evidence
    )
    SELECT p_match_group_key, candidate.parent_sku, p_run_id, candidate.rank,
        candidate.name, candidate.vintage, candidate.producer, candidate.region,
        candidate.stock_origin, candidate.purchase_mode, candidate.product_url,
        coalesce(candidate.matched_words, '{}'), candidate.typo_count,
        round(candidate.match_score, 3), candidate.was_biddable, p_observed_at,
        candidate.algorithm_version, round(candidate.evidence_score, 4),
        CASE WHEN candidate.rank = 1 THEN round(candidate.score_margin, 4) END,
        candidate.review_band,
        CASE WHEN candidate.algorithm_version IS NULL THEN NULL
             ELSE private.match_review_priority(candidate.review_band, candidate.calculated_impact_band) END,
        candidate.calculated_impact_band,
        coalesce(candidate.risk_flags, '{}'), coalesce(candidate.match_reasons, '{}'),
        CASE WHEN candidate.algorithm_version IS NULL THEN NULL
             ELSE coalesce(candidate.comparison_evidence, '{}'::JSONB) || jsonb_build_object(
                 'valid_in_bond_fragment_count', v_valid_fragment_count,
                 'valid_format_count', v_valid_format_count
             ) END
    FROM prepared candidate
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
        algorithm_version = coalesce(
            (SELECT min(candidate->>'algorithm_version')
             FROM jsonb_array_elements(p_candidates) candidate
             WHERE nullif(candidate->>'algorithm_version', '') IS NOT NULL),
            algorithm_version
        ),
        algolia_exact_link_count = algolia_exact_link_count + v_linked
    WHERE id = p_run_id;
    PERFORM private.refresh_release_offer_match_run(p_run_id);
    RETURN jsonb_build_object(
        'status', 'processed', 'linked_row_count', v_linked,
        'already_processed', FALSE,
        'valid_in_bond_fragment_count', v_valid_fragment_count,
        'valid_format_count', v_valid_format_count
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_cellartracker_algolia_result(
    p_run_id UUID,
    p_match_group_key TEXT,
    p_candidates JSONB,
    p_auto_link_parent_sku TEXT,
    p_observed_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_group public.cellartracker_match_run_groups%ROWTYPE;
    v_snapshot_id UUID;
    v_linked INT := 0;
    v_total_quantity INT := 0;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    IF jsonb_typeof(p_candidates) <> 'array' OR jsonb_array_length(p_candidates) > 5 THEN
        RAISE EXCEPTION 'p_candidates must be an array of at most five results' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_candidates) candidate
        WHERE coalesce((candidate->>'rank')::INT, 0) <> 1
          AND candidate->'score_margin' IS NOT NULL
          AND jsonb_typeof(candidate->'score_margin') <> 'null'
    ) THEN
        RAISE EXCEPTION 'score_margin is only valid for rank 1' USING ERRCODE = '22023';
    END IF;
    IF p_auto_link_parent_sku IS NOT NULL AND p_auto_link_parent_sku !~ '^\d{5,30}$' THEN
        RAISE EXCEPTION 'invalid auto-link Parent ID' USING ERRCODE = '22023';
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

    SELECT coalesce(sum(evidence.total_quantity), 0)::INT INTO v_total_quantity
    FROM public.cellartracker_evidence evidence
    WHERE evidence.import_id = v_snapshot_id
      AND evidence.match_group_key = p_match_group_key
      AND NOT EXISTS (
          SELECT 1 FROM public.cellartracker_record_decisions decisions
          WHERE decisions.match_group_key = evidence.match_group_key
            AND decisions.source_wine = evidence.source_wine
            AND decisions.is_excluded
      );

    DELETE FROM public.cellartracker_match_suggestions
    WHERE match_group_key = p_match_group_key;

    WITH candidates AS (
        SELECT * FROM jsonb_to_recordset(p_candidates) AS candidate(
            rank INT, parent_sku TEXT, name TEXT, vintage INT, producer TEXT,
            region TEXT, stock_origin TEXT, purchase_mode TEXT, product_url TEXT,
            matched_words TEXT[], typo_count INT, match_score NUMERIC,
            algorithm_version TEXT, evidence_score NUMERIC, score_margin NUMERIC,
            review_band TEXT, risk_flags TEXT[], match_reasons TEXT[],
            comparison_evidence JSONB
        )
    ), prepared AS (
        SELECT candidate.*,
            EXISTS (
                SELECT 1 FROM private.products product
                WHERE product.parent_sku = candidate.parent_sku
                  AND product.gone_since IS NULL
            ) AS was_biddable,
            CASE
                WHEN candidate.algorithm_version IS NULL THEN NULL
                WHEN v_total_quantity <= 0 THEN 'identity_only'
                WHEN EXISTS (
                    SELECT 1 FROM private.products product
                    WHERE product.parent_sku = candidate.parent_sku
                      AND product.gone_since IS NULL
                ) THEN 'current_market'
                ELSE 'source_evidence'
            END AS calculated_impact_band
        FROM candidates candidate
    )
    INSERT INTO public.cellartracker_match_suggestions (
        match_group_key, parent_sku, source_run_id, rank, name, vintage,
        producer, region, stock_origin, purchase_mode, product_url,
        matched_words, typo_count, match_score, was_biddable_at_observation, observed_at,
        algorithm_version, evidence_score, score_margin, review_band,
        review_priority, impact_band, risk_flags, match_reasons, comparison_evidence
    )
    SELECT p_match_group_key, candidate.parent_sku, p_run_id, candidate.rank,
        candidate.name, candidate.vintage, candidate.producer, candidate.region,
        candidate.stock_origin, candidate.purchase_mode, candidate.product_url,
        coalesce(candidate.matched_words, '{}'), candidate.typo_count,
        round(candidate.match_score, 3), candidate.was_biddable, p_observed_at,
        candidate.algorithm_version, round(candidate.evidence_score, 4),
        CASE WHEN candidate.rank = 1 THEN round(candidate.score_margin, 4) END,
        candidate.review_band,
        CASE WHEN candidate.algorithm_version IS NULL THEN NULL
             ELSE private.match_review_priority(candidate.review_band, candidate.calculated_impact_band) END,
        candidate.calculated_impact_band,
        coalesce(candidate.risk_flags, '{}'), coalesce(candidate.match_reasons, '{}'),
        CASE WHEN candidate.algorithm_version IS NULL THEN NULL
             ELSE coalesce(candidate.comparison_evidence, '{}'::JSONB) || jsonb_build_object(
                 'total_quantity', v_total_quantity
             ) END
    FROM prepared candidate
    WHERE candidate.rank BETWEEN 1 AND 5
      AND candidate.parent_sku ~ '^\d{5,30}$'
      AND nullif(btrim(candidate.name), '') IS NOT NULL;

    IF p_auto_link_parent_sku IS NOT NULL AND v_group.source_vintage IS NOT NULL THEN
        INSERT INTO public.cellartracker_product_resolutions (
            import_id, source_row_number, status, parent_sku,
            match_method, match_run_id, resolved_by
        )
        SELECT evidence.import_id, evidence.source_row_number, 'linked', p_auto_link_parent_sku,
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
        algorithm_version = coalesce(
            (SELECT min(candidate->>'algorithm_version')
             FROM jsonb_array_elements(p_candidates) candidate
             WHERE nullif(candidate->>'algorithm_version', '') IS NOT NULL),
            algorithm_version
        ),
        algolia_exact_link_count = algolia_exact_link_count + v_linked
    WHERE id = p_run_id;
    PERFORM private.refresh_cellartracker_match_run(p_run_id);
    RETURN jsonb_build_object(
        'status', 'processed', 'linked_row_count', v_linked,
        'already_processed', FALSE, 'total_quantity', v_total_quantity
    );
END;
$$;

CREATE OR REPLACE VIEW public.release_offer_match_suggestion_view
WITH (security_invoker = TRUE)
AS
SELECT suggestion.match_group_key, suggestion.parent_sku, suggestion.source_run_id,
    suggestion.rank, suggestion.name, suggestion.vintage, suggestion.producer,
    suggestion.region, suggestion.stock_origin, suggestion.purchase_mode,
    suggestion.product_url, suggestion.matched_words, suggestion.typo_count,
    EXISTS (SELECT 1 FROM public.catalogue_view catalogue
        WHERE catalogue.parent_sku = suggestion.parent_sku) AS is_biddable,
    suggestion.observed_at, suggestion.match_score,
    suggestion.algorithm_version, suggestion.evidence_score, suggestion.score_margin,
    coalesce(suggestion.review_band, 'legacy') AS review_band,
    coalesce(suggestion.review_priority, 90::SMALLINT) AS review_priority,
    suggestion.impact_band, suggestion.risk_flags, suggestion.match_reasons,
    suggestion.comparison_evidence,
    suggestion.was_biddable_at_observation
FROM public.release_offer_match_suggestions suggestion;

CREATE OR REPLACE VIEW public.cellartracker_match_suggestion_view
WITH (security_invoker = TRUE)
AS
SELECT suggestion.match_group_key, suggestion.parent_sku, suggestion.source_run_id,
    suggestion.rank, suggestion.name, suggestion.vintage, suggestion.producer,
    suggestion.region, suggestion.stock_origin, suggestion.purchase_mode,
    suggestion.product_url, suggestion.matched_words, suggestion.typo_count,
    EXISTS (SELECT 1 FROM public.catalogue_view catalogue
        WHERE catalogue.parent_sku = suggestion.parent_sku) AS is_biddable,
    suggestion.observed_at, suggestion.match_score,
    suggestion.algorithm_version, suggestion.evidence_score, suggestion.score_margin,
    coalesce(suggestion.review_band, 'legacy') AS review_band,
    coalesce(suggestion.review_priority, 90::SMALLINT) AS review_priority,
    suggestion.impact_band, suggestion.risk_flags, suggestion.match_reasons,
    suggestion.comparison_evidence,
    suggestion.was_biddable_at_observation
FROM public.cellartracker_match_suggestions suggestion;

CREATE OR REPLACE VIEW public.wine_match_suggestion_view
WITH (security_invoker = TRUE)
AS
SELECT 'release_offer'::TEXT AS source,
    suggestion.match_group_key, suggestion.parent_sku, suggestion.rank,
    suggestion.name, suggestion.vintage, suggestion.producer, suggestion.region,
    suggestion.match_score, suggestion.is_biddable AS is_bbx_eligible,
    suggestion.observed_at, suggestion.algorithm_version,
    suggestion.evidence_score, suggestion.score_margin, suggestion.review_band,
    suggestion.review_priority, suggestion.impact_band, suggestion.risk_flags,
    suggestion.match_reasons, suggestion.comparison_evidence,
    suggestion.was_biddable_at_observation
FROM public.release_offer_match_suggestion_view suggestion
UNION ALL
SELECT 'cellartracker'::TEXT AS source,
    suggestion.match_group_key, suggestion.parent_sku, suggestion.rank,
    suggestion.name, suggestion.vintage, suggestion.producer, suggestion.region,
    suggestion.match_score, suggestion.is_biddable AS is_bbx_eligible,
    suggestion.observed_at, suggestion.algorithm_version,
    suggestion.evidence_score, suggestion.score_margin, suggestion.review_band,
    suggestion.review_priority, suggestion.impact_band, suggestion.risk_flags,
    suggestion.match_reasons, suggestion.comparison_evidence,
    suggestion.was_biddable_at_observation
FROM public.cellartracker_match_suggestion_view suggestion;

CREATE OR REPLACE VIEW public.wine_match_review_view
WITH (security_invoker = TRUE)
AS
SELECT 'release_offer'::TEXT AS source,
    review.match_group_key,
    CASE WHEN review.parent_sku IS NOT NULL THEN 'parent:' || review.parent_sku END AS wine_ref,
    review.parent_sku, review.match_method, review.source_wine, review.source_vintage,
    review.source_row_count, review.unresolved_row_count, review.linked_row_count,
    review.suppressed_row_count, review.is_biddable AS is_bbx_eligible,
    review.suggestion_count, review.top_match_score, review.suggestions_observed_at,
    review.last_run_status, review.last_error_at, review.second_wine_conflict,
    review.token_coverage, review.coverage_tier,
    suggestion.algorithm_version, suggestion.evidence_score, suggestion.score_margin,
    coalesce(suggestion.review_band, 'legacy') AS review_band,
    coalesce(suggestion.review_priority, 90::SMALLINT) AS review_priority,
    suggestion.impact_band, coalesce(suggestion.risk_flags, '{}') AS risk_flags,
    coalesce(suggestion.match_reasons, '{}') AS match_reasons,
    suggestion.parent_sku AS top_candidate_parent_sku,
    suggestion.was_biddable_at_observation AS top_candidate_was_biddable_at_observation
FROM public.release_offer_match_review_view review
LEFT JOIN public.release_offer_match_suggestions suggestion
  ON suggestion.match_group_key = review.match_group_key AND suggestion.rank = 1
UNION ALL
SELECT 'cellartracker'::TEXT AS source,
    review.match_group_key,
    CASE WHEN review.parent_sku IS NOT NULL THEN 'parent:' || review.parent_sku END AS wine_ref,
    review.parent_sku, review.match_method, review.source_wine, review.source_vintage,
    review.source_row_count, review.unresolved_row_count, review.linked_row_count,
    review.suppressed_row_count, review.is_biddable AS is_bbx_eligible,
    review.suggestion_count, review.top_match_score, review.suggestions_observed_at,
    review.last_run_status, review.last_error_at, review.second_wine_conflict,
    review.token_coverage, review.coverage_tier,
    suggestion.algorithm_version, suggestion.evidence_score, suggestion.score_margin,
    coalesce(suggestion.review_band, 'legacy') AS review_band,
    coalesce(suggestion.review_priority, 90::SMALLINT) AS review_priority,
    suggestion.impact_band, coalesce(suggestion.risk_flags, '{}') AS risk_flags,
    coalesce(suggestion.match_reasons, '{}') AS match_reasons,
    suggestion.parent_sku AS top_candidate_parent_sku,
    suggestion.was_biddable_at_observation AS top_candidate_was_biddable_at_observation
FROM public.cellartracker_match_review_view review
LEFT JOIN public.cellartracker_match_suggestions suggestion
  ON suggestion.match_group_key = review.match_group_key AND suggestion.rank = 1;

DROP FUNCTION IF EXISTS public.wine_match_queue_summary(TEXT);

CREATE FUNCTION public.wine_match_queue_summary(p_source TEXT DEFAULT NULL)
RETURNS TABLE (
    needs_review BIGINT,
    with_suggestions BIGINT,
    no_suggestions BIGINT,
    errors BIGINT,
    linked BIGINT,
    no_suitable_match BIGINT,
    all_groups BIGINT,
    workable BIGINT,
    low_coverage BIGINT,
    second_wine_conflicts BIGINT,
    likely BIGINT,
    ambiguous BIGINT,
    weak BIGINT,
    legacy BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        count(*) FILTER (WHERE review.unresolved_row_count > 0),
        count(*) FILTER (WHERE review.unresolved_row_count > 0
            AND review.last_run_status IS DISTINCT FROM 'failed' AND review.suggestion_count > 0),
        count(*) FILTER (WHERE review.unresolved_row_count > 0
            AND review.last_run_status IS DISTINCT FROM 'failed' AND review.suggestion_count = 0),
        count(*) FILTER (WHERE review.unresolved_row_count > 0 AND review.last_run_status = 'failed'),
        count(*) FILTER (WHERE review.linked_row_count > 0 AND review.unresolved_row_count = 0),
        count(*) FILTER (WHERE review.suppressed_row_count > 0 AND review.unresolved_row_count = 0),
        count(*),
        count(*) FILTER (WHERE review.unresolved_row_count > 0
            AND review.last_run_status IS DISTINCT FROM 'failed' AND review.suggestion_count > 0
            AND review.coverage_tier <> 'low'),
        count(*) FILTER (WHERE review.unresolved_row_count > 0
            AND review.last_run_status IS DISTINCT FROM 'failed' AND review.suggestion_count > 0
            AND review.coverage_tier = 'low'),
        count(*) FILTER (WHERE review.unresolved_row_count > 0 AND review.second_wine_conflict),
        count(*) FILTER (WHERE review.unresolved_row_count > 0 AND review.suggestion_count > 0
            AND review.review_band = 'likely'),
        count(*) FILTER (WHERE review.unresolved_row_count > 0 AND review.suggestion_count > 0
            AND review.review_band = 'ambiguous'),
        count(*) FILTER (WHERE review.unresolved_row_count > 0 AND review.suggestion_count > 0
            AND review.review_band = 'weak'),
        count(*) FILTER (WHERE review.unresolved_row_count > 0 AND review.suggestion_count > 0
            AND review.review_band = 'legacy')
    FROM public.wine_match_review_view review
    WHERE p_source IS NULL OR review.source = p_source;
$$;

REVOKE ALL ON FUNCTION public.wine_match_queue_summary(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wine_match_queue_summary(TEXT) TO authenticated;

REVOKE ALL ON public.wine_match_review_view, public.wine_match_suggestion_view
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wine_match_review_view, public.wine_match_suggestion_view
    TO authenticated;
