-- Phase 7 Phase B: finalise_release_offer_import's third pass computed
-- similarity-ranked match candidates for every still-unmatched row, over the
-- full products table (51k+ rows). Nothing in the app reads match_candidates
-- yet (Phase C's manual-resolution UI is the intended consumer) and there is
-- no trigram index to make the ranking cheap. Worse, its WHERE clause
-- (`r.source_vintage IS NULL OR p.vintage = r.source_vintage`) is vacuously
-- true for any row with a null source_vintage, so those rows scan the entire
-- products table per row. Against a real 3,546-row historic-offer import this
-- exceeded the statement timeout and the import could never finalise.
--
-- Drop the candidate-computation pass for now. Tier-1 (resolved source
-- product ID) and tier-2 (exact name+vintage) matching are untouched and
-- remain index-backed. Phase C should reintroduce candidate suggestions
-- deliberately -- bounded to rows with a known vintage, backed by a trigram
-- index -- once the UI that consumes match_candidates exists.

CREATE OR REPLACE FUNCTION public.finalise_release_offer_import(
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
    v_matched INT;
    v_unmatched INT;
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
        RAISE EXCEPTION 'only a staging import can be finalised'
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
        count(*) FILTER (WHERE match_status = 'unmatched')::INT,
        count(*) FILTER (
            WHERE jsonb_array_length(validation_warnings) > 0
        )::INT,
        count(*) FILTER (WHERE match_status = 'invalid')::INT
    INTO v_matched, v_unmatched, v_warning, v_errors
    FROM public.release_offer_source_rows
    WHERE import_id = p_import_id;

    UPDATE public.release_offer_imports
    SET
        status = CASE WHEN v_errors > 0 THEN 'failed' ELSE 'validated' END,
        source_row_count = v_rows,
        priced_fragment_count = v_prices,
        matched_row_count = v_matched,
        unmatched_row_count = v_unmatched,
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
        'matched_row_count', v_matched,
        'unmatched_row_count', v_unmatched,
        'warning_row_count', v_warning,
        'error_row_count', v_errors
    );
END;
$$;
