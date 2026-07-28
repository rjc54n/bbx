-- A rejected match only prevents future retries. This separate owner-only
-- operation removes bad historic evidence and its parsed price fragments.

ALTER TABLE public.release_offer_resolution_events
    DROP CONSTRAINT release_offer_resolution_events_event_type_check;

ALTER TABLE public.release_offer_resolution_events
    ADD CONSTRAINT release_offer_resolution_events_event_type_check
        CHECK (event_type IN (
            'linked', 'edited', 'suppressed', 'unlinked', 'restored', 'deleted'
        ));

CREATE OR REPLACE FUNCTION private.audit_release_offer_resolution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event_type TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_type := CASE WHEN NEW.status = 'ignored' THEN 'suppressed' ELSE 'linked' END;
        INSERT INTO public.release_offer_resolution_events (
            import_id, source_row_number, event_type,
            new_status, new_parent_sku, new_match_method,
            match_run_id, changed_by
        ) VALUES (
            NEW.import_id, NEW.source_row_number, v_event_type,
            NEW.status, NEW.parent_sku, NEW.match_method,
            NEW.match_run_id, NEW.resolved_by
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        v_event_type := CASE
            WHEN NEW.status = 'ignored' THEN 'suppressed'
            WHEN OLD.status = 'ignored' AND NEW.status = 'linked' THEN 'linked'
            ELSE 'edited'
        END;
        INSERT INTO public.release_offer_resolution_events (
            import_id, source_row_number, event_type,
            previous_status, previous_parent_sku, previous_match_method,
            new_status, new_parent_sku, new_match_method,
            match_run_id, changed_by
        ) VALUES (
            NEW.import_id, NEW.source_row_number, v_event_type,
            OLD.status, OLD.parent_sku, OLD.match_method,
            NEW.status, NEW.parent_sku, NEW.match_method,
            NEW.match_run_id, NEW.resolved_by
        );
        RETURN NEW;
    END IF;

    IF current_setting('app.release_offer_match_group_delete', TRUE) = 'on' THEN
        RETURN OLD;
    END IF;

    v_event_type := CASE WHEN OLD.status = 'ignored' THEN 'restored' ELSE 'unlinked' END;
    INSERT INTO public.release_offer_resolution_events (
        import_id, source_row_number, event_type,
        previous_status, previous_parent_sku, previous_match_method,
        match_run_id, changed_by
    ) VALUES (
        OLD.import_id, OLD.source_row_number, v_event_type,
        OLD.status, OLD.parent_sku, OLD.match_method,
        OLD.match_run_id, (SELECT auth.uid())
    );
    RETURN OLD;
END;
$$;

CREATE FUNCTION public.delete_release_offer_match_group(p_match_group_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deleted_row_count INT;
    v_run_id UUID;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF p_match_group_key IS NULL OR char_length(trim(p_match_group_key)) = 0 THEN
        RAISE EXCEPTION 'match group key is required' USING ERRCODE = '22023';
    END IF;

    WITH target_rows AS (
        SELECT row.import_id, row.source_row_number, resolution.status,
            resolution.parent_sku, resolution.match_method, resolution.match_run_id
        FROM public.release_offer_source_rows row
        JOIN public.release_offer_imports imports ON imports.id = row.import_id
        LEFT JOIN public.release_offer_product_resolutions resolution
          ON resolution.import_id = row.import_id
         AND resolution.source_row_number = row.source_row_number
        WHERE imports.status = 'accepted'
          AND row.match_group_key = p_match_group_key
        FOR UPDATE OF row
    )
    INSERT INTO public.release_offer_resolution_events (
        import_id, source_row_number, event_type,
        previous_status, previous_parent_sku, previous_match_method,
        changed_by
    )
    SELECT import_id, source_row_number, 'deleted',
        status, parent_sku, match_method,
        (SELECT auth.uid())
    FROM target_rows;

    DELETE FROM public.release_price_anchor_overrides override
    WHERE override.release_offer_price_id IN (
        SELECT price.id
        FROM public.release_offer_prices price
        JOIN public.release_offer_source_rows row
          ON row.import_id = price.import_id
         AND row.source_row_number = price.source_row_number
        JOIN public.release_offer_imports imports ON imports.id = row.import_id
        WHERE imports.status = 'accepted'
          AND row.match_group_key = p_match_group_key
    );

    DELETE FROM public.release_offer_match_suggestions
    WHERE match_group_key = p_match_group_key;

    FOR v_run_id IN
        DELETE FROM public.release_offer_match_run_groups
        WHERE match_group_key = p_match_group_key
          AND status <> 'processed'
        RETURNING run_id
    LOOP
        PERFORM private.refresh_release_offer_match_run(v_run_id);
    END LOOP;

    PERFORM set_config('app.release_offer_match_group_delete', 'on', TRUE);

    DELETE FROM public.release_offer_source_rows row
    USING public.release_offer_imports imports
    WHERE imports.id = row.import_id
      AND imports.status = 'accepted'
      AND row.match_group_key = p_match_group_key;
    GET DIAGNOSTICS v_deleted_row_count = ROW_COUNT;

    IF v_deleted_row_count = 0 THEN
        RAISE EXCEPTION 'match group not found' USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
        'match_group_key', p_match_group_key,
        'deleted_row_count', v_deleted_row_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_release_offer_match_group(TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_release_offer_match_group(TEXT)
    TO authenticated;
