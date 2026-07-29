-- CellarTracker and BBR describe the same wine in different shapes.
-- CellarTracker leads with the producer and holds geography in separate
-- columns; BBR emits "<vintage> <wine>, <producer>, <geography>". The
-- full-string comparison inherited from release-offer matching can never
-- satisfy either ordering, so identity moves to an order-independent set of
-- core tokens on both sides.

-- Sorted, distinct identity tokens. Unlike private.release_wine_match_key this
-- lowercases before folding, so an accented capital survives, and it drops any
-- four-digit vintage token rather than only a known vintage.
--
-- Articles and conjunctions are dropped. Producer words such as "chateau",
-- "domaine" and "tenuta" are deliberately kept: dropping them collapses
-- "Chateau Margaux" to the Margaux appellation, which every Margaux property
-- would then match.
CREATE OR REPLACE FUNCTION private.wine_core_tokens(p_text TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT coalesce(array_agg(DISTINCT token ORDER BY token), '{}'::TEXT[])
    FROM regexp_split_to_table(
        regexp_replace(
            translate(
                lower(coalesce(p_text, '')),
                'àáâãäåæçèéêëìíîïñòóôõöœùúûüýÿ',
                'aaaaaaaceeeeiiiinoooooouuuuyy'
            ),
            '[^a-z0-9]+', ' ', 'g'
        ),
        ' '
    ) AS token
    WHERE token <> ''
      AND token !~ '^(18|19|20)[0-9]{2}$'
      AND token <> ALL (ARRAY[
          'de','du','des','da','di','do','dos','del','della','delle',
          'la','le','les','el','il','al','lo','the','a','an','and',
          'et','e','y','und','von','van','der','den','ter'
      ]);
$$;

-- CellarTracker's Wine already contains the designation and vineyard and holds
-- no geography, so nothing is subtracted. Subtracting the Appellation column
-- would be wrong: in Burgundy the cru name is both the appellation and the
-- wine's identity.
CREATE OR REPLACE FUNCTION private.ct_wine_core_key(p_wine TEXT, p_producer TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT array_to_string(
        private.wine_core_tokens(concat_ws(' ', p_wine, p_producer)), ' ');
$$;

-- BBR names are comma-separated and suffixed with geography, for example
-- "2018 Barrua, Isola dei Nuraghi, Punica, Sardinia, Italy". Trailing segments
-- that are wholly geographic are dropped so the remainder is comparable with a
-- CellarTracker identity.
--
-- Segments are dropped whole rather than token by token, and the first segment
-- is never dropped: removing geography tokens individually would reduce
-- "2015 Chateau Margaux, Margaux, Bordeaux" to "chateau".
CREATE OR REPLACE FUNCTION private.bbr_wine_core_key(
    p_name TEXT,
    p_producer TEXT,
    p_country TEXT,
    p_region TEXT,
    p_subregion TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    WITH geography AS (
        SELECT private.wine_core_tokens(
            concat_ws(' ', p_country, p_region, p_subregion)) AS tokens
    ), segments AS (
        SELECT segment, ordinality
        FROM regexp_split_to_table(coalesce(p_name, ''), ',')
            WITH ORDINALITY AS split(segment, ordinality)
    ), kept AS (
        SELECT segments.segment
        FROM segments, geography
        WHERE segments.ordinality = 1
           OR cardinality(private.wine_core_tokens(segments.segment)) = 0
           OR NOT (private.wine_core_tokens(segments.segment) <@ geography.tokens)
    )
    SELECT coalesce(array_to_string(
        private.wine_core_tokens(
            concat_ws(' ', string_agg(kept.segment, ' '), p_producer)), ' '), '')
    FROM kept;
$$;

REVOKE ALL ON FUNCTION
    private.wine_core_tokens(TEXT),
    private.ct_wine_core_key(TEXT, TEXT),
    private.bbr_wine_core_key(TEXT, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;

CREATE INDEX idx_products_core_key
    ON private.products (
        vintage,
        private.bbr_wine_core_key(name, producer, country, region, subregion)
    );

-- Generated, so the parser and both row-repair functions stay unchanged.
ALTER TABLE public.cellartracker_evidence
    ADD COLUMN source_core_key TEXT GENERATED ALWAYS AS (
        private.ct_wine_core_key(source_wine, producer)
    ) STORED;

CREATE INDEX idx_cellartracker_evidence_core_key
    ON public.cellartracker_evidence(source_core_key, vintage);

-- Retrieval evidence, not match probability: the score records how much of the
-- two identities overlapped, so review can triage without re-deriving it.
ALTER TABLE public.cellartracker_match_suggestions
    ADD COLUMN match_score NUMERIC(4,3)
        CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 1);

CREATE OR REPLACE FUNCTION public.begin_cellartracker_match_run()
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

    -- Tier one: order-independent core-key equality across the whole product
    -- table, linking only where a single Parent ID answers.
    WITH unresolved_groups AS (
        SELECT DISTINCT evidence.match_group_key, evidence.source_core_key, evidence.vintage
        FROM public.cellartracker_evidence evidence
        LEFT JOIN public.cellartracker_product_resolutions resolution
          ON resolution.import_id = evidence.import_id
         AND resolution.source_row_number = evidence.source_row_number
        WHERE evidence.import_id = v_snapshot_id
          AND resolution.import_id IS NULL
          AND evidence.vintage IS NOT NULL
          AND evidence.source_core_key <> ''
    ), unique_matches AS (
        SELECT source.match_group_key, min(product.parent_sku) AS parent_sku
        FROM unresolved_groups source
        JOIN private.products product ON product.vintage = source.vintage
          AND private.bbr_wine_core_key(
              product.name, product.producer, product.country,
              product.region, product.subregion) = source.source_core_key
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

-- The exhaustive multi-page validation is retired. Tier one owns whole-catalogue
-- exactness, so the caller now sends a shortlist it has already ranked and the
-- single Parent ID it judged safe to link, or NULL for review.
DROP FUNCTION public.record_cellartracker_algolia_result(
    UUID, TEXT, JSONB, TEXT[], BOOLEAN, TIMESTAMPTZ);

CREATE FUNCTION public.record_cellartracker_algolia_result(
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
    v_snapshot_id UUID; v_linked INT := 0;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    IF jsonb_typeof(p_candidates) <> 'array' OR jsonb_array_length(p_candidates) > 5 THEN
        RAISE EXCEPTION 'p_candidates must be an array of at most five results' USING ERRCODE = '22023';
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

    DELETE FROM public.cellartracker_match_suggestions WHERE match_group_key = p_match_group_key;

    WITH candidates AS (
        SELECT * FROM jsonb_to_recordset(p_candidates) AS candidate(
            rank INT, parent_sku TEXT, name TEXT, vintage INT, producer TEXT,
            region TEXT, stock_origin TEXT, purchase_mode TEXT, product_url TEXT,
            matched_words TEXT[], typo_count INT, match_score NUMERIC
        )
    )
    INSERT INTO public.cellartracker_match_suggestions (
        match_group_key, parent_sku, source_run_id, rank, name, vintage,
        producer, region, stock_origin, purchase_mode, product_url,
        matched_words, typo_count, match_score, was_biddable_at_observation, observed_at
    )
    SELECT p_match_group_key, candidate.parent_sku, p_run_id, candidate.rank,
        candidate.name, candidate.vintage, candidate.producer, candidate.region,
        candidate.stock_origin, candidate.purchase_mode, candidate.product_url,
        coalesce(candidate.matched_words, '{}'), candidate.typo_count,
        round(candidate.match_score, 3),
        EXISTS (SELECT 1 FROM private.products product
            WHERE product.parent_sku = candidate.parent_sku AND product.gone_since IS NULL),
        p_observed_at
    FROM candidates candidate
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
        algolia_exact_link_count = algolia_exact_link_count + v_linked
    WHERE id = p_run_id;
    PERFORM private.refresh_cellartracker_match_run(p_run_id);
    RETURN jsonb_build_object('status', 'processed', 'linked_row_count', v_linked);
END;
$$;

REVOKE ALL ON FUNCTION public.record_cellartracker_algolia_result(
    UUID, TEXT, JSONB, TEXT, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_cellartracker_algolia_result(
    UUID, TEXT, JSONB, TEXT, TIMESTAMPTZ)
    TO authenticated;

CREATE OR REPLACE VIEW public.cellartracker_match_suggestion_view
WITH (security_invoker = TRUE)
AS
SELECT suggestion.match_group_key, suggestion.parent_sku, suggestion.source_run_id,
    suggestion.rank, suggestion.name, suggestion.vintage, suggestion.producer,
    suggestion.region, suggestion.stock_origin, suggestion.purchase_mode,
    suggestion.product_url, suggestion.matched_words, suggestion.typo_count,
    EXISTS (SELECT 1 FROM public.catalogue_view catalogue
        WHERE catalogue.parent_sku = suggestion.parent_sku) AS is_biddable,
    suggestion.observed_at,
    -- Appended, not inserted: CREATE OR REPLACE VIEW can only add trailing columns.
    suggestion.match_score
FROM public.cellartracker_match_suggestions suggestion;
