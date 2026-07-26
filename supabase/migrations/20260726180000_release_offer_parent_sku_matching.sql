-- Phase 7 Phase A: the historic-offers CSV now carries a resolved BBR Parent
-- ID directly (the CSV parent_sku column), rather than relying only on an
-- embedded JSON identifier or a scraped bbr.com link. A resolved ID may name
-- a wine that is not (or not currently) in our biddable catalogue -- that is
-- expected, since our store is the biddable subset of BBR's full range, not
-- all of it. Publication must not require a catalogue_view/skus row: a
-- resolved parent_sku, an explicit in-bond price and an accepted import are
-- sufficient, with format_code constructed deterministically from the parsed
-- case size and bottle volume. Off-catalogue anchors already surface through
-- release_price_market_view's existing LEFT JOIN to catalogue_view, with
-- null comparison columns, and light up automatically once the wine returns
-- to the catalogue.

-- ---------------------------------------------------------------------------
-- release_offer_source_rows.parent_sku no longer requires catalogue
-- membership. Replace the products(parent_sku) FK with a format CHECK that
-- matches the numeric BBR Parent ID contract already enforced client-side.
-- ---------------------------------------------------------------------------

ALTER TABLE public.release_offer_source_rows
    DROP CONSTRAINT release_offer_source_rows_parent_sku_fkey;

ALTER TABLE public.release_offer_source_rows
    ADD CONSTRAINT release_offer_source_rows_parent_sku_check
    CHECK (parent_sku IS NULL OR parent_sku ~ '^\d{5,30}$');

ALTER TABLE public.release_offer_source_rows
    ADD CONSTRAINT release_offer_source_rows_source_product_id_check
    CHECK (source_product_id IS NULL OR source_product_id ~ '^\d{5,30}$');

-- ---------------------------------------------------------------------------
-- Tier-1 matching now trusts a resolved source_product_id (populated from
-- the CSV parent_sku column ahead of JSON_Data.source_product_id and a
-- scraped link, per the parser's precedence) without requiring the ID to
-- already exist in the catalogue.
-- ---------------------------------------------------------------------------

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

    UPDATE public.release_offer_source_rows r
    SET match_candidates = coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'parent_sku', candidate.parent_sku,
            'name', candidate.name,
            'vintage', candidate.vintage,
            'similarity', round(candidate.match_similarity::NUMERIC, 3)
        ) ORDER BY candidate.match_similarity DESC)
        FROM (
            SELECT
                p.parent_sku,
                p.name,
                p.vintage,
                public.similarity(
                    private.release_wine_match_key(p.name, p.vintage),
                    r.source_match_key
                ) AS match_similarity
            FROM public.products p
            WHERE r.source_vintage IS NULL
               OR p.vintage = r.source_vintage
            ORDER BY match_similarity DESC
            LIMIT 3
        ) candidate
    ), '[]'::JSONB)
    WHERE r.import_id = p_import_id
      AND r.match_status = 'unmatched';

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

-- ---------------------------------------------------------------------------
-- Publication no longer requires a catalogue_view/skus row at (parent_sku,
-- format_code). A matched parent_sku, an explicit in-bond price and a
-- constructible format_code (guaranteed by parse_status = 'valid') are
-- sufficient. release_price_market_view's existing LEFT JOIN to
-- catalogue_view already surfaces these anchors with null bid/ask.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_release_offer_import(p_import_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_import public.release_offer_imports%ROWTYPE;
    v_published INT;
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
    IF v_import.status = 'accepted' THEN
        RETURN jsonb_build_object(
            'import_id', p_import_id,
            'status', 'accepted',
            'already_accepted', TRUE
        );
    END IF;
    IF v_import.status <> 'validated' OR v_import.error_row_count > 0 THEN
        RAISE EXCEPTION 'only a validated import can be accepted'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.release_offer_prices price
    SET
        publication_status = CASE
            WHEN row.match_status <> 'matched' THEN 'pending'
            WHEN price.parse_status <> 'valid' THEN 'pending'
            WHEN price.tax_basis <> 'in_bond' THEN 'pending'
            ELSE 'published'
        END,
        rejection_reason = NULL
    FROM public.release_offer_source_rows row
    WHERE price.import_id = p_import_id
      AND row.import_id = price.import_id
      AND row.source_row_number = price.source_row_number;

    GET DIAGNOSTICS v_published = ROW_COUNT;

    UPDATE public.release_offer_imports
    SET status = 'accepted', accepted_at = now(), accepted_by = (SELECT auth.uid())
    WHERE id = p_import_id
    RETURNING * INTO v_import;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'status', 'accepted',
        'already_accepted', FALSE,
        'evaluated_price_count', v_published,
        'accepted_at', v_import.accepted_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_release_offer_row(
    p_import_id UUID,
    p_source_row_number INT,
    p_parent_sku TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF p_parent_sku !~ '^\d{5,30}$' THEN
        RAISE EXCEPTION 'parent_sku must be a supported numeric BBR Parent ID'
            USING ERRCODE = '22023';
    END IF;

    SELECT status INTO v_status
    FROM public.release_offer_imports
    WHERE id = p_import_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'import not found' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.release_offer_source_rows
    SET parent_sku = p_parent_sku, match_status = 'matched', match_method = 'manual'
    WHERE import_id = p_import_id
      AND source_row_number = p_source_row_number
      AND match_status <> 'invalid';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'source row not found or invalid' USING ERRCODE = 'P0002';
    END IF;

    IF v_status = 'accepted' THEN
        UPDATE public.release_offer_prices price
        SET publication_status = CASE
            WHEN price.parse_status = 'valid'
             AND price.tax_basis = 'in_bond'
            THEN 'published'
            ELSE 'pending'
        END
        WHERE import_id = p_import_id
          AND source_row_number = p_source_row_number;
    END IF;

    UPDATE public.release_offer_imports i
    SET
        matched_row_count = counts.matched,
        unmatched_row_count = counts.unmatched
    FROM (
        SELECT
            count(*) FILTER (WHERE match_status = 'matched')::INT AS matched,
            count(*) FILTER (WHERE match_status = 'unmatched')::INT AS unmatched
        FROM public.release_offer_source_rows
        WHERE import_id = p_import_id
    ) counts
    WHERE i.id = p_import_id;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'source_row_number', p_source_row_number,
        'parent_sku', p_parent_sku,
        'match_status', 'matched'
    );
END;
$$;
