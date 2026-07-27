-- Phase 7 Phase B: decouple ETL (upload/staging) from matching. Previously
-- finalise_release_offer_import ran automatically at the end of every upload,
-- conflating two independent concerns: (a) verifying staged counts and
-- computing error/warning counts (pure ETL -- invalid rows are already
-- flagged during stage_release_offer_batch, before any matching runs), and
-- (b) running the tier-1/tier-2 matching passes. That coupling is why a slow
-- matching step silently blocked every upload. Split along the seam:
--
--   staging -> staged -> validated/failed -> accepted
--
-- mark_release_offer_import_staged does only (a) and is called right after
-- staging completes, so uploads land fast with no matching involved.
-- run_release_offer_matching does only (b), replacing
-- finalise_release_offer_import, and is triggered explicitly by the user from
-- the import detail page once an import is 'staged'. Matching logic itself
-- (tier-1 source_product_id, tier-2 exact name+vintage) is unchanged.

ALTER TABLE public.release_offer_imports
    DROP CONSTRAINT release_offer_imports_status_check;

ALTER TABLE public.release_offer_imports
    ADD CONSTRAINT release_offer_imports_status_check
        CHECK (status IN ('staging', 'staged', 'validated', 'accepted', 'failed'));

CREATE FUNCTION public.mark_release_offer_import_staged(
    p_import_id UUID,
    p_expected_source_rows INT,
    p_expected_price_fragments INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_import public.release_offer_imports%ROWTYPE;
    v_rows INT;
    v_prices INT;
    v_warning INT;
    v_errors INT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_import
    FROM public.release_offer_imports
    WHERE id = p_import_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'import not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_import.status <> 'staging' THEN
        RAISE EXCEPTION 'only a staging import can be marked staged'
            USING ERRCODE = '22023';
    END IF;

    SELECT count(*)::INT INTO v_rows
    FROM public.release_offer_source_rows WHERE import_id = p_import_id;
    SELECT count(*)::INT INTO v_prices
    FROM public.release_offer_prices WHERE import_id = p_import_id;
    IF v_rows <> p_expected_source_rows OR v_prices <> p_expected_price_fragments THEN
        RAISE EXCEPTION 'staged count mismatch: expected % rows/% prices, found %/%',
            p_expected_source_rows, p_expected_price_fragments, v_rows, v_prices
            USING ERRCODE = '22023';
    END IF;

    SELECT
        count(*) FILTER (
            WHERE jsonb_array_length(validation_warnings) > 0
        )::INT,
        count(*) FILTER (WHERE match_status = 'invalid')::INT
    INTO v_warning, v_errors
    FROM public.release_offer_source_rows
    WHERE import_id = p_import_id;

    UPDATE public.release_offer_imports
    SET
        status = CASE WHEN v_errors > 0 THEN 'failed' ELSE 'staged' END,
        source_row_count = v_rows,
        priced_fragment_count = v_prices,
        matched_row_count = 0,
        unmatched_row_count = v_rows,
        warning_row_count = v_warning,
        error_row_count = v_errors,
        failure_summary = CASE
            WHEN v_errors > 0 THEN format('%s source row(s) failed validation', v_errors)
        END
    WHERE id = p_import_id
    RETURNING * INTO v_import;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'status', v_import.status,
        'source_row_count', v_rows,
        'priced_fragment_count', v_prices,
        'warning_row_count', v_warning,
        'error_row_count', v_errors
    );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_release_offer_import_staged(UUID, INT, INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_release_offer_import_staged(UUID, INT, INT)
    TO authenticated;

DROP FUNCTION public.finalise_release_offer_import(UUID, INT, INT);

CREATE FUNCTION public.run_release_offer_matching(p_import_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_import public.release_offer_imports%ROWTYPE;
    v_matched INT;
    v_unmatched INT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_import
    FROM public.release_offer_imports
    WHERE id = p_import_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'import not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_import.status <> 'staged' THEN
        RAISE EXCEPTION 'only a staged import can be matched'
            USING ERRCODE = '22023';
    END IF;

    -- A resolved BBR Parent ID (CSV parent_sku, then JSON_Data, then a
    -- scraped link -- the parser's precedence) is the strongest match. It
    -- need not already exist in the catalogue: an out-of-stock or
    -- not-yet-listed wine is expected, not an error.
    UPDATE public.release_offer_source_rows r
    SET
        parent_sku = r.source_product_id,
        match_status = 'matched',
        match_method = 'source_product_id'
    WHERE r.import_id = p_import_id
      AND r.match_status = 'unmatched'
      AND r.source_product_id IS NOT NULL;

    -- Auto-match names only when the same vintage and normalised name identify
    -- one catalogue parent. Ambiguity remains visible for manual resolution.
    WITH candidates AS (
        SELECT
            r.import_id,
            r.source_row_number,
            min(p.parent_sku) AS parent_sku,
            count(*) AS candidate_count
        FROM public.release_offer_source_rows r
        JOIN public.products p ON p.vintage = r.source_vintage
        WHERE r.import_id = p_import_id
          AND r.match_status = 'unmatched'
          AND private.release_wine_match_key(p.name, p.vintage) = r.source_match_key
        GROUP BY r.import_id, r.source_row_number
    )
    UPDATE public.release_offer_source_rows r
    SET
        parent_sku = c.parent_sku,
        match_status = 'matched',
        match_method = 'exact_name_vintage'
    FROM candidates c
    WHERE r.import_id = c.import_id
      AND r.source_row_number = c.source_row_number
      AND c.candidate_count = 1;

    SELECT
        count(*) FILTER (WHERE match_status = 'matched')::INT,
        count(*) FILTER (WHERE match_status = 'unmatched')::INT
    INTO v_matched, v_unmatched
    FROM public.release_offer_source_rows
    WHERE import_id = p_import_id;

    UPDATE public.release_offer_imports
    SET
        status = 'validated',
        matched_row_count = v_matched,
        unmatched_row_count = v_unmatched
    WHERE id = p_import_id
    RETURNING * INTO v_import;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'status', v_import.status,
        'matched_row_count', v_matched,
        'unmatched_row_count', v_unmatched
    );
END;
$$;

REVOKE ALL ON FUNCTION public.run_release_offer_matching(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_release_offer_matching(UUID)
    TO authenticated;
