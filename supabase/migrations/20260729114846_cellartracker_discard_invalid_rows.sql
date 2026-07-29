CREATE OR REPLACE FUNCTION public.discard_cellartracker_import_row(
    p_import_id UUID,
    p_source_row_number INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_import public.cellar_imports%ROWTYPE;
    v_deleted INT;
    v_source_count INT;
    v_parsed_count INT;
    v_unmatched_count INT;
    v_warning_count INT;
    v_error_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_import
    FROM public.cellar_imports
    WHERE id = p_import_id AND source_type = 'cellartracker_inventory'
    FOR UPDATE;
    IF NOT FOUND OR v_import.status NOT IN ('validated', 'failed') THEN
        RAISE EXCEPTION 'only an unaccepted CellarTracker import can be amended'
            USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.cellar_import_rows
    WHERE import_id = p_import_id
      AND source_row_number = p_source_row_number
      AND match_status = 'invalid';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 1 THEN
        RAISE EXCEPTION 'invalid staging row not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT count(*)::INT,
      count(*) FILTER (WHERE match_status <> 'invalid')::INT,
      count(*) FILTER (WHERE match_status = 'unmatched')::INT,
      count(*) FILTER (WHERE jsonb_array_length(validation_warnings) > 0)::INT,
      count(*) FILTER (WHERE match_status = 'invalid')::INT
    INTO v_source_count, v_parsed_count, v_unmatched_count, v_warning_count, v_error_count
    FROM public.cellar_import_rows WHERE import_id = p_import_id;

    UPDATE public.cellar_imports
    SET source_row_count = v_source_count,
        parsed_row_count = v_parsed_count,
        unmatched_row_count = v_unmatched_count,
        warning_row_count = v_warning_count,
        error_row_count = v_error_count,
        status = CASE WHEN v_error_count = 0 THEN 'validated' ELSE 'failed' END,
        failure_summary = CASE WHEN v_error_count = 0 THEN NULL ELSE format('%s invalid source rows.', v_error_count) END
    WHERE id = p_import_id;

    RETURN jsonb_build_object('discarded_row_number', p_source_row_number, 'error_row_count', v_error_count);
END;
$$;

REVOKE ALL ON FUNCTION public.discard_cellartracker_import_row(UUID, INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_cellartracker_import_row(UUID, INT)
    TO authenticated;
