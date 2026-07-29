-- Let the owner maintain one record in the current accepted CellarTracker
-- snapshot without changing every row in its wine-and-vintage match group.

CREATE FUNCTION public.update_cellartracker_record_price(
    p_import_id UUID,
    p_source_row_number INT,
    p_price_p INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_raw_row JSONB;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF p_import_id IS NULL OR p_source_row_number IS NULL
       OR p_source_row_number <= 0 OR p_price_p IS NULL OR p_price_p < 0 THEN
        RAISE EXCEPTION 'valid record identifiers and a non-negative price are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT rows.raw_row
    INTO v_raw_row
    FROM public.cellar_import_rows rows
    JOIN public.cellar_imports imports ON imports.id = rows.import_id
    JOIN public.cellartracker_evidence evidence
      ON evidence.import_id = rows.import_id
     AND evidence.source_row_number = rows.source_row_number
    WHERE rows.import_id = p_import_id
      AND rows.source_row_number = p_source_row_number
      AND imports.source_type = 'cellartracker_inventory'
      AND imports.status = 'accepted'
    FOR UPDATE OF rows, evidence;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'accepted CellarTracker record not found' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.cellartracker_evidence
    SET purchase_price_per_bottle_p = p_price_p
    WHERE import_id = p_import_id
      AND source_row_number = p_source_row_number;

    UPDATE public.cellar_import_rows
    SET raw_row = jsonb_set(
        v_raw_row,
        '{Price}',
        to_jsonb(to_char(p_price_p::NUMERIC / 100, 'FM999999999999990.00'))
    )
    WHERE import_id = p_import_id
      AND source_row_number = p_source_row_number;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'source_row_number', p_source_row_number,
        'purchase_price_per_bottle_p', p_price_p
    );
END;
$$;

CREATE FUNCTION public.delete_cellartracker_record(
    p_import_id UUID,
    p_source_row_number INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_match_group_key TEXT;
    v_parent_sku TEXT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF p_import_id IS NULL OR p_source_row_number IS NULL OR p_source_row_number <= 0 THEN
        RAISE EXCEPTION 'valid record identifiers are required' USING ERRCODE = '22023';
    END IF;

    SELECT evidence.match_group_key, resolution.parent_sku
    INTO v_match_group_key, v_parent_sku
    FROM public.cellartracker_evidence evidence
    JOIN public.cellar_imports imports ON imports.id = evidence.import_id
    LEFT JOIN public.cellartracker_product_resolutions resolution
      ON resolution.import_id = evidence.import_id
     AND resolution.source_row_number = evidence.source_row_number
    WHERE evidence.import_id = p_import_id
      AND evidence.source_row_number = p_source_row_number
      AND imports.source_type = 'cellartracker_inventory'
      AND imports.status = 'accepted'
    FOR UPDATE OF evidence;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'accepted CellarTracker record not found' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.cellartracker_resolution_events (
        import_id, source_row_number, event_type, previous_parent_sku, changed_by
    ) VALUES (
        p_import_id, p_source_row_number, 'deleted', v_parent_sku, (SELECT auth.uid())
    );

    -- The resolution is removed by cascade. Do not also record it as an
    -- explicit unlink or restore.
    PERFORM set_config('app.cellartracker_match_group_delete', 'on', TRUE);

    DELETE FROM public.cellar_import_rows
    WHERE import_id = p_import_id
      AND source_row_number = p_source_row_number;

    UPDATE public.cellar_imports
    SET source_row_count = greatest(0, source_row_count - 1),
        parsed_row_count = greatest(0, parsed_row_count - 1),
        unmatched_row_count = greatest(0, unmatched_row_count - 1)
    WHERE id = p_import_id;

    IF NOT EXISTS (
        SELECT 1
        FROM public.cellartracker_evidence
        WHERE import_id = p_import_id
          AND match_group_key = v_match_group_key
    ) THEN
        DELETE FROM public.cellartracker_match_suggestions
        WHERE match_group_key = v_match_group_key;
    END IF;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'source_row_number', p_source_row_number,
        'match_group_key', v_match_group_key
    );
END;
$$;

REVOKE ALL ON FUNCTION
    public.update_cellartracker_record_price(UUID, INT, INT),
    public.delete_cellartracker_record(UUID, INT)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.update_cellartracker_record_price(UUID, INT, INT),
    public.delete_cellartracker_record(UUID, INT)
    TO authenticated;
