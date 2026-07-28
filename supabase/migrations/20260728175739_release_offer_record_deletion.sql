-- Allow an owner to remove one accepted source record without deleting the
-- rest of its wine-and-vintage match group. The audit event remains durable.

CREATE FUNCTION public.delete_release_offer_record(
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
    v_status TEXT;
    v_parent_sku TEXT;
    v_match_method TEXT;
    v_match_run_id UUID;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF p_import_id IS NULL OR p_source_row_number IS NULL OR p_source_row_number <= 0 THEN
        RAISE EXCEPTION 'valid import and source row identifiers are required' USING ERRCODE = '22023';
    END IF;

    SELECT row.match_group_key, resolution.status, resolution.parent_sku,
        resolution.match_method, resolution.match_run_id
    INTO v_match_group_key, v_status, v_parent_sku, v_match_method, v_match_run_id
    FROM public.release_offer_source_rows row
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    LEFT JOIN public.release_offer_product_resolutions resolution
      ON resolution.import_id = row.import_id
     AND resolution.source_row_number = row.source_row_number
    WHERE row.import_id = p_import_id
      AND row.source_row_number = p_source_row_number
      AND imports.status = 'accepted'
    FOR UPDATE OF row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'accepted release-offer record not found' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.release_offer_resolution_events (
        import_id, source_row_number, event_type,
        previous_status, previous_parent_sku, previous_match_method,
        match_run_id, changed_by
    ) VALUES (
        p_import_id, p_source_row_number, 'deleted',
        v_status, v_parent_sku, v_match_method,
        v_match_run_id, (SELECT auth.uid())
    );

    DELETE FROM public.release_price_anchor_overrides override
    WHERE override.release_offer_price_id IN (
        SELECT id
        FROM public.release_offer_prices
        WHERE import_id = p_import_id
          AND source_row_number = p_source_row_number
    );

    -- The resolution delete is a cascade from the source row. Its generic
    -- trigger event would be misleading because this explicit deletion audit
    -- entry is already recorded above.
    PERFORM set_config('app.release_offer_match_group_delete', 'on', TRUE);

    DELETE FROM public.release_offer_source_rows
    WHERE import_id = p_import_id
      AND source_row_number = p_source_row_number;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'source_row_number', p_source_row_number,
        'match_group_key', v_match_group_key
    );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_release_offer_record(UUID, INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_release_offer_record(UUID, INT)
    TO authenticated;
