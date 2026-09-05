-- BBR holdings history, slice 3: ownership evidence independent of catalogue
-- coverage.
--
-- Plan: docs/BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md, slice 3 and decision
-- D3. Ordered before acceptance is restored (D6), because a snapshot accepted
-- while evidence is still incomplete drops those positions forever, and once
-- the history projections land a position missing for want of catalogue
-- coverage is indistinguishable from one BBR stopped reporting.
--
-- BBR is the ownership authority. Whether the local catalogue could decorate a
-- position is a dated fact about the observation, not a condition of recording
-- it, so parent_sku becomes the BBR-asserted Parent ID, format_code the
-- source-derived format, and catalogue_matched records what local resolution
-- managed at import time.
--
-- ROLLBACK IS FORWARD-FIX-ONLY PAST ITS ACTIVATION POINT. The activation point
-- is the first import staged after this migration that contains an unmatched
-- row. Before it, reverting is clean. After it, restoring the foreign key
-- would mean deleting valid BBR ownership evidence, which is the opposite of
-- this slice's purpose -- so the response to a defect here is a further
-- migration, never a revert. To find out which side of the line the database
-- is on:
--
--     SELECT count(*) FROM public.bbr_holding_evidence WHERE NOT catalogue_matched;

-- 1. The catalogue is no longer a gate on recording ownership. cellar_import_rows
--    keeps its own foreign key: it is shared with CellarTracker and its
--    parent_sku goes on meaning "resolved catalogue identity".

ALTER TABLE public.bbr_holding_evidence
    DROP CONSTRAINT bbr_holding_evidence_parent_sku_format_code_fkey;

-- 2. Existing evidence rows are all matched -- the foreign key above allowed
--    nothing else -- so the default backfills them correctly. It is then
--    dropped, so that every future insert has to state what resolution
--    actually achieved rather than inheriting an optimistic default.

ALTER TABLE public.bbr_holding_evidence
    ADD COLUMN catalogue_matched BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.bbr_holding_evidence
    ALTER COLUMN catalogue_matched DROP DEFAULT;

COMMENT ON COLUMN public.bbr_holding_evidence.catalogue_matched IS
    'Whether local catalogue resolution succeeded when this row was imported. A dated fact about the observation, not about the catalogue today (D3).';

COMMENT ON COLUMN public.bbr_holding_evidence.parent_sku IS
    'BBR-asserted Parent ID. Not a catalogue foreign key -- see catalogue_matched.';

-- 3. One position per product and format within an import. Slice 0 profiled the
--    recovered exports and found no repeated (Parent ID, derived format) rows,
--    which selects this branch of D10. The parser already marks a repeat
--    invalid, so this is the backstop rather than the first line of defence.

ALTER TABLE public.bbr_holding_evidence
    ADD CONSTRAINT bbr_holding_evidence_position_key
        UNIQUE (import_id, parent_sku, format_code);

-- 4. Stage unmatched positions as evidence too. Only the evidence insert
--    changes: its WHERE now admits unmatched rows, and catalogue_matched
--    records which they were. Imports staged before this migration are NOT
--    backfilled -- reconstructing them from raw_row would mean re-implementing
--    money, volume and percentage parsing in SQL. Slice 4's completeness
--    invariant refuses such an import instead, and tells the owner to upload
--    the file again, which re-stages it correctly.

CREATE OR REPLACE FUNCTION public.stage_bbr_import(
    p_import_id UUID,
    p_content_checksum TEXT,
    p_original_filename TEXT,
    p_byte_size BIGINT,
    p_storage_object_path TEXT,
    p_parser_version TEXT,
    p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing_id UUID;
    v_existing_status TEXT;
    v_source_count INT;
    v_parsed_count INT;
    v_matched_count INT;
    v_unmatched_count INT;
    v_warning_count INT;
    v_error_count INT;
    v_status TEXT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
        RAISE EXCEPTION 'p_rows must be a non-empty JSON array'
            USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(p_rows) > 10000 THEN
        RAISE EXCEPTION 'row limit exceeded' USING ERRCODE = '22023';
    END IF;

    SELECT id, status
    INTO v_existing_id, v_existing_status
    FROM public.cellar_imports
    WHERE source_type = 'bbr_holdings'
      AND content_checksum = p_content_checksum
      AND parser_version = p_parser_version;

    IF v_existing_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'import_id', v_existing_id,
            'status', v_existing_status,
            'duplicate', TRUE
        );
    END IF;

    SELECT
        count(*)::INT,
        count(*) FILTER (WHERE match_status <> 'invalid')::INT,
        count(*) FILTER (WHERE match_status = 'matched')::INT,
        count(*) FILTER (WHERE match_status = 'unmatched')::INT,
        count(*) FILTER (
            WHERE jsonb_array_length(validation_warnings) > 0
        )::INT,
        count(*) FILTER (WHERE match_status = 'invalid')::INT
    INTO
        v_source_count,
        v_parsed_count,
        v_matched_count,
        v_unmatched_count,
        v_warning_count,
        v_error_count
    FROM jsonb_to_recordset(p_rows) AS r(
        match_status TEXT,
        validation_warnings JSONB
    );

    v_status := CASE WHEN v_error_count > 0 THEN 'failed' ELSE 'validated' END;

    INSERT INTO public.cellar_imports (
        id,
        source_type,
        content_checksum,
        original_filename,
        byte_size,
        storage_object_path,
        uploaded_by,
        parser_version,
        status,
        source_row_count,
        parsed_row_count,
        matched_row_count,
        unmatched_row_count,
        warning_row_count,
        error_row_count,
        failure_summary
    )
    VALUES (
        p_import_id,
        'bbr_holdings',
        p_content_checksum,
        p_original_filename,
        p_byte_size,
        p_storage_object_path,
        (SELECT auth.uid()),
        p_parser_version,
        v_status,
        v_source_count,
        v_parsed_count,
        v_matched_count,
        v_unmatched_count,
        v_warning_count,
        v_error_count,
        CASE
            WHEN v_error_count > 0
            THEN format('%s row(s) failed validation', v_error_count)
        END
    );

    INSERT INTO public.cellar_import_rows (
        import_id,
        source_row_number,
        raw_row,
        match_status,
        validation_errors,
        validation_warnings,
        parent_sku,
        format_code
    )
    SELECT
        p_import_id,
        r.source_row_number,
        r.raw_row,
        r.match_status,
        r.validation_errors,
        r.validation_warnings,
        CASE WHEN r.match_status = 'matched' THEN r.parent_sku END,
        CASE WHEN r.match_status = 'matched' THEN r.format_code END
    FROM jsonb_to_recordset(p_rows) AS r(
        source_row_number INT,
        raw_row JSONB,
        match_status TEXT,
        validation_errors JSONB,
        validation_warnings JSONB,
        parent_sku TEXT,
        format_code TEXT
    );

    INSERT INTO public.bbr_holding_evidence (
        import_id,
        source_row_number,
        parent_sku,
        format_code,
        catalogue_matched,
        product_code,
        description,
        country,
        region,
        vintage,
        colour,
        maturity,
        drinking_window_from,
        drinking_window_to,
        bottle_volume_ml,
        quantity_bottles,
        eligible_for_bbx,
        purchase_price_per_case_p,
        case_size,
        livex_market_price_p,
        wine_searcher_lowest_list_price_p,
        bbx_last_transaction_price_p,
        bbx_lowest_price_p,
        bbx_highest_bid_p,
        current_status,
        alcohol_percent
    )
    SELECT
        p_import_id,
        r.source_row_number,
        r.parent_sku,
        r.format_code,
        r.match_status = 'matched',
        r.product_code,
        r.description,
        r.country,
        r.region,
        r.vintage,
        r.colour,
        r.maturity,
        r.drinking_window_from,
        r.drinking_window_to,
        r.bottle_volume_ml,
        r.quantity_bottles,
        r.eligible_for_bbx,
        r.purchase_price_per_case_p,
        r.case_size,
        r.livex_market_price_p,
        r.wine_searcher_lowest_list_price_p,
        r.bbx_last_transaction_price_p,
        r.bbx_lowest_price_p,
        r.bbx_highest_bid_p,
        r.current_status,
        r.alcohol_percent
    FROM jsonb_to_recordset(p_rows) AS r(
        source_row_number INT,
        match_status TEXT,
        parent_sku TEXT,
        format_code TEXT,
        product_code TEXT,
        description TEXT,
        country TEXT,
        region TEXT,
        vintage INT,
        colour TEXT,
        maturity TEXT,
        drinking_window_from INT,
        drinking_window_to INT,
        bottle_volume_ml INT,
        quantity_bottles INT,
        eligible_for_bbx BOOLEAN,
        purchase_price_per_case_p INT,
        case_size INT,
        livex_market_price_p INT,
        wine_searcher_lowest_list_price_p INT,
        bbx_last_transaction_price_p INT,
        bbx_lowest_price_p INT,
        bbx_highest_bid_p INT,
        current_status TEXT,
        alcohol_percent NUMERIC
    )
    WHERE r.match_status IN ('matched', 'unmatched');

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'status', v_status,
        'duplicate', FALSE,
        'source_row_count', v_source_count,
        'matched_row_count', v_matched_count,
        'unmatched_row_count', v_unmatched_count,
        'warning_row_count', v_warning_count,
        'error_row_count', v_error_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.stage_bbr_import(
    UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_bbr_import(
    UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, JSONB
) TO authenticated;
