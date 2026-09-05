-- BBR holdings history, slice 4: the acceptance RPCs.
--
-- Plan: docs/BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md, slice 4 and
-- decisions D2 (effective date), D5 (no withdrawal), D6 (completeness) and
-- D9 (file identity is advisory). Functional spec sections 4.2 to 4.5.
--
-- Nothing calls these yet. Slice 6 restores the Accept control on top of them,
-- which is what ends the freeze.

-- 1. D9: file identity becomes advisory. Two exports with identical bytes and
--    different dates must not collapse into one import, and an unchanged
--    export must be able to refresh the current snapshot's date. The invariant
--    that actually matters -- one accepted snapshot per effective date -- is
--    D2's partial unique index, added in slice 2. What remains here is a plain
--    lookup index, so duplicate detection stays cheap while becoming a choice
--    the owner makes rather than a refusal.

ALTER TABLE public.cellar_imports
    DROP CONSTRAINT cellar_imports_source_type_content_checksum_parser_version_key;

CREATE INDEX idx_cellar_imports_file_identity
    ON public.cellar_imports (source_type, content_checksum, parser_version);

-- 2. Staging reports a duplicate instead of refusing one. p_allow_duplicate
--    lets the owner stage the same bytes again as a separate snapshot with its
--    own effective date; the default keeps today's behaviour, so the existing
--    seven-argument call site is unaffected. The duplicate return now carries
--    the stored declaration, so the caller can say which snapshot the file was
--    already imported as.

DROP FUNCTION public.stage_bbr_import(
    UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, JSONB
);

CREATE FUNCTION public.stage_bbr_import(
    p_import_id UUID,
    p_content_checksum TEXT,
    p_original_filename TEXT,
    p_byte_size BIGINT,
    p_storage_object_path TEXT,
    p_parser_version TEXT,
    p_rows JSONB,
    p_allow_duplicate BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing_id UUID;
    v_existing_status TEXT;
    v_existing_date DATE;
    v_existing_role TEXT;
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

    -- Several imports may now share a checksum, so report the one the owner
    -- most likely means: an accepted snapshot ahead of a staged one, then the
    -- most recent.
    SELECT id, status, effective_date, accepted_role
    INTO v_existing_id, v_existing_status, v_existing_date, v_existing_role
    FROM public.cellar_imports
    WHERE source_type = 'bbr_holdings'
      AND content_checksum = p_content_checksum
      AND parser_version = p_parser_version
    ORDER BY (status = 'accepted') DESC, uploaded_at DESC, id DESC
    LIMIT 1;

    IF v_existing_id IS NOT NULL AND NOT p_allow_duplicate THEN
        RETURN jsonb_build_object(
            'import_id', v_existing_id,
            'status', v_existing_status,
            'duplicate', TRUE,
            'existing_effective_date', v_existing_date,
            'existing_accepted_role', v_existing_role
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

-- 3. The owner's proposed date, recorded before acceptance so the preview can
--    be built against it. Pre-acceptance only: once a snapshot is accepted its
--    date is an owner assertion of record, amendable in slice 10 through an
--    audited path that re-checks the chronology, never by a bare update.

CREATE OR REPLACE FUNCTION public.set_bbr_import_effective_date(
    p_import_id UUID,
    p_effective_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_import public.cellar_imports%ROWTYPE;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    IF p_effective_date IS NULL THEN
        RAISE EXCEPTION 'an effective date is required'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_import
    FROM public.cellar_imports
    WHERE id = p_import_id
      AND source_type = 'bbr_holdings'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'import not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_import.status = 'accepted' THEN
        RAISE EXCEPTION
            'this import is already accepted as the snapshot for %',
            to_char(v_import.effective_date, 'YYYY-MM-DD')
        USING ERRCODE = '22023',
              HINT = 'An accepted snapshot''s date changes only through the audited amendment path.';
    END IF;

    UPDATE public.cellar_imports
    SET effective_date = p_effective_date
    WHERE id = p_import_id;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'effective_date', p_effective_date
    );
END;
$$;

-- 4. Acceptance. The role is stated explicitly with no default (spec 4.2), and
--    every chronology rule is checked here rather than left to the indexes, so
--    that a refusal says which rule blocked it and what the owner can do.

CREATE OR REPLACE FUNCTION public.accept_bbr_snapshot(
    p_import_id UUID,
    p_effective_date DATE,
    p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_import public.cellar_imports%ROWTYPE;
    v_nominated public.cellar_imports%ROWTYPE;
    v_evidence_rows INT;
    v_latest_accepted DATE;
    v_superseded UUID;
    v_now TIMESTAMPTZ := now();
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    IF p_role IS NULL OR p_role NOT IN ('current', 'historical') THEN
        RAISE EXCEPTION 'a role of current or historical must be stated'
            USING ERRCODE = '22023',
                  HINT = 'There is deliberately no default, so that an old recovered file cannot replace current holdings by accident.';
    END IF;

    IF p_effective_date IS NULL THEN
        RAISE EXCEPTION 'an effective date is required to accept a snapshot'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_import
    FROM public.cellar_imports
    WHERE id = p_import_id
      AND source_type = 'bbr_holdings'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'import not found' USING ERRCODE = 'P0002';
    END IF;

    -- Conditional idempotency: a repeated call with the same declaration is
    -- the retry of an interrupted request and succeeds. A repeat with
    -- different values is a different intention, and silently reporting
    -- success would misrepresent the chronology.
    IF v_import.status = 'accepted' THEN
        IF v_import.effective_date = p_effective_date
           AND v_import.accepted_role = p_role THEN
            RETURN jsonb_build_object(
                'import_id', v_import.id,
                'status', v_import.status,
                'effective_date', v_import.effective_date,
                'accepted_role', v_import.accepted_role,
                'superseded_import_id', v_import.superseded_by,
                'already_accepted', TRUE
            );
        END IF;

        RAISE EXCEPTION
            'this import is already accepted as the % snapshot for %',
            v_import.accepted_role,
            to_char(v_import.effective_date, 'YYYY-MM-DD')
        USING ERRCODE = '22023',
              HINT = 'Acceptance is recorded once. Amend the stored declaration rather than accepting it again with different values.';
    END IF;

    IF v_import.status <> 'validated' OR v_import.error_row_count > 0 THEN
        RAISE EXCEPTION 'only a validated import without row errors can be accepted'
            USING ERRCODE = '22023';
    END IF;

    -- Evidence completeness (D6). One invariant closing three holes: an import
    -- staged before evidence stopped depending on catalogue coverage, a
    -- partially staged import, and any future divergence between the staging
    -- and acceptance paths. It fails closed rather than quietly accepting a
    -- snapshot that is missing positions, which no later slice could detect.
    SELECT count(*)::INT
    INTO v_evidence_rows
    FROM public.bbr_holding_evidence
    WHERE import_id = p_import_id;

    IF v_evidence_rows <> v_import.parsed_row_count THEN
        RAISE EXCEPTION
            'this import holds ownership evidence for % of its % valid rows',
            v_evidence_rows,
            v_import.parsed_row_count
        USING ERRCODE = '22023',
              HINT = 'It was staged before ownership evidence stopped depending on catalogue coverage. Upload the file again, which stages it completely.';
    END IF;

    -- D2: one accepted snapshot per effective date. The partial unique index
    -- enforces this; checking it here is what turns a duplicate key error into
    -- an explanation.
    IF EXISTS (
        SELECT 1
        FROM public.cellar_imports
        WHERE source_type = 'bbr_holdings'
          AND status = 'accepted'
          AND effective_date = p_effective_date
    ) THEN
        RAISE EXCEPTION
            'an accepted snapshot already describes %',
            to_char(p_effective_date, 'YYYY-MM-DD')
        USING ERRCODE = '22023',
              HINT = 'One accepted snapshot per date. Correct the date, or amend the snapshot that already holds it.';
    END IF;

    -- Locking the nomination is what serialises two simultaneous current
    -- acceptances. The loser then finds it already superseded, supersedes
    -- nothing, and is refused by the partial unique index.
    SELECT *
    INTO v_nominated
    FROM public.cellar_imports
    WHERE source_type = 'bbr_holdings'
      AND status = 'accepted'
      AND accepted_role = 'current'
      AND superseded_at IS NULL
    FOR UPDATE;

    IF p_role = 'current' THEN
        SELECT max(effective_date)
        INTO v_latest_accepted
        FROM public.cellar_imports
        WHERE source_type = 'bbr_holdings'
          AND status = 'accepted';

        IF v_latest_accepted IS NOT NULL
           AND p_effective_date < v_latest_accepted THEN
            RAISE EXCEPTION
                'a current snapshot cannot pre-date the accepted snapshot for %',
                to_char(v_latest_accepted, 'YYYY-MM-DD')
            USING ERRCODE = '22023',
                  HINT = 'Correct the date, accept this file as historical, or supply a later current declaration.';
        END IF;

        IF v_nominated.id IS NOT NULL THEN
            UPDATE public.cellar_imports
            SET
                superseded_at = v_now,
                superseded_by = p_import_id
            WHERE id = v_nominated.id;

            v_superseded := v_nominated.id;
        END IF;
    ELSE
        IF v_nominated.id IS NOT NULL
           AND p_effective_date > v_nominated.effective_date THEN
            RAISE EXCEPTION
                'a historical snapshot cannot post-date the nominated current snapshot of %',
                to_char(v_nominated.effective_date, 'YYYY-MM-DD')
            USING ERRCODE = '22023',
                  HINT = 'Correct its date, nominate it as current, or first accept a later current declaration.';
        END IF;
    END IF;

    UPDATE public.cellar_imports
    SET
        status = 'accepted',
        accepted_at = v_now,
        accepted_by = (SELECT auth.uid()),
        effective_date = p_effective_date,
        accepted_role = p_role
    WHERE id = p_import_id
    RETURNING * INTO v_import;

    RETURN jsonb_build_object(
        'import_id', v_import.id,
        'status', v_import.status,
        'effective_date', v_import.effective_date,
        'accepted_role', v_import.accepted_role,
        'superseded_import_id', v_superseded,
        'already_accepted', FALSE
    );
END;
$$;

-- 5. Privileges. The owner check inside a SECURITY DEFINER body is necessary
--    but does not remove the default PUBLIC execute privilege, so both halves
--    are required on every function.

REVOKE ALL ON FUNCTION public.stage_bbr_import(
    UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, JSONB, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_bbr_import(
    UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, JSONB, BOOLEAN
) TO authenticated;

REVOKE ALL ON FUNCTION public.set_bbr_import_effective_date(UUID, DATE)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_bbr_import_effective_date(UUID, DATE)
    TO authenticated;

REVOKE ALL ON FUNCTION public.accept_bbr_snapshot(UUID, DATE, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_bbr_snapshot(UUID, DATE, TEXT)
    TO authenticated;
