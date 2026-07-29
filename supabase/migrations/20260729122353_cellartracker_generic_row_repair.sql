CREATE OR REPLACE FUNCTION public.repair_cellartracker_import_row(
    p_import_id UUID,
    p_source_row_number INT,
    p_raw_row JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_total INT;
    v_home INT;
    v_bbr INT;
    v_vintage INT;
    v_price_p INT;
    v_errors INT;
    v_wine TEXT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE='42501'; END IF;
    IF jsonb_typeof(p_raw_row) <> 'object' THEN RAISE EXCEPTION 'source row must be an object' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.cellar_import_rows WHERE import_id=p_import_id AND source_row_number=p_source_row_number AND match_status='invalid' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid staging row not found' USING ERRCODE='P0002'; END IF;
    v_wine := nullif(trim(p_raw_row->>'Wine'),'');
    IF v_wine IS NULL THEN RAISE EXCEPTION 'Wine is required' USING ERRCODE='22023'; END IF;
    IF coalesce(p_raw_row->>'TotalQuantity','') !~ '^\d+$' OR coalesce(p_raw_row->>'Quantity','') !~ '^\d+$' OR coalesce(p_raw_row->>'Pending','') !~ '^\d+$' THEN RAISE EXCEPTION 'quantities must be whole non-negative numbers' USING ERRCODE='22023'; END IF;
    v_total := (p_raw_row->>'TotalQuantity')::INT; v_home := (p_raw_row->>'Quantity')::INT; v_bbr := (p_raw_row->>'Pending')::INT;
    IF v_total <> v_home + v_bbr THEN RAISE EXCEPTION 'TotalQuantity must equal Quantity plus Pending' USING ERRCODE='22023'; END IF;
    IF coalesce(p_raw_row->>'Currency','') <> 'GBP' THEN RAISE EXCEPTION 'Currency must be GBP' USING ERRCODE='22023'; END IF;
    IF v_total > 0 AND coalesce(p_raw_row->>'Size','') <> '750ml' THEN RAISE EXCEPTION 'positive holdings must be 750ml' USING ERRCODE='22023'; END IF;
    IF coalesce(p_raw_row->>'Price','') !~ '^\d+(\.\d{1,4})?$' THEN RAISE EXCEPTION 'Price must be a non-negative GBP amount' USING ERRCODE='22023'; END IF;
    v_price_p := round((p_raw_row->>'Price')::NUMERIC * 100)::INT;
    v_vintage := CASE WHEN coalesce(p_raw_row->>'Vintage','') ~ '^\d{4}$' THEN (p_raw_row->>'Vintage')::INT WHEN coalesce(p_raw_row->>'Vintage','') IN ('','NV','N.V.') THEN NULL ELSE NULL END;
    IF coalesce(p_raw_row->>'Vintage','') NOT IN ('','NV','N.V.') AND v_vintage IS NULL THEN RAISE EXCEPTION 'Vintage must be a four-digit year or NV' USING ERRCODE='22023'; END IF;
    UPDATE public.cellar_import_rows SET raw_row=p_raw_row,match_status='unmatched',validation_errors='[]'::JSONB WHERE import_id=p_import_id AND source_row_number=p_source_row_number;
    INSERT INTO public.cellartracker_evidence(import_id,source_row_number,source_wine,source_match_key,vintage,bottle_volume_ml,purchase_price_per_bottle_p,quantity_home,quantity_bbr,total_quantity,fully_consumed,colour,producer,country,region,appellation,varietal,begin_consume,end_consume)
    VALUES(p_import_id,p_source_row_number,v_wine,private.release_wine_match_key(v_wine,v_vintage),v_vintage,750,v_price_p,v_home,v_bbr,v_total,v_total=0,nullif(p_raw_row->>'Color',''),nullif(p_raw_row->>'Producer',''),nullif(p_raw_row->>'Country',''),nullif(p_raw_row->>'Region',''),nullif(p_raw_row->>'Appellation',''),nullif(p_raw_row->>'Varietal',''),CASE WHEN coalesce(p_raw_row->>'BeginConsume','') ~ '^\d+$' THEN (p_raw_row->>'BeginConsume')::INT END,CASE WHEN coalesce(p_raw_row->>'EndConsume','') ~ '^\d+$' THEN (p_raw_row->>'EndConsume')::INT END);
    SELECT count(*) FILTER (WHERE match_status='invalid')::INT INTO v_errors FROM public.cellar_import_rows WHERE import_id=p_import_id;
    UPDATE public.cellar_imports SET error_row_count=v_errors,parsed_row_count=(SELECT count(*)::INT FROM public.cellar_import_rows WHERE import_id=p_import_id),unmatched_row_count=(SELECT count(*)::INT FROM public.cellar_import_rows WHERE import_id=p_import_id AND match_status='unmatched'),source_row_count=(SELECT count(*)::INT FROM public.cellar_import_rows WHERE import_id=p_import_id),status=CASE WHEN v_errors=0 THEN 'validated' ELSE 'failed' END,failure_summary=CASE WHEN v_errors=0 THEN NULL ELSE format('%s invalid source rows.',v_errors) END WHERE id=p_import_id;
    RETURN jsonb_build_object('repaired_row_number',p_source_row_number,'error_row_count',v_errors);
END;
$$;
REVOKE ALL ON FUNCTION public.repair_cellartracker_import_row(UUID,INT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repair_cellartracker_import_row(UUID,INT,JSONB) TO authenticated;
