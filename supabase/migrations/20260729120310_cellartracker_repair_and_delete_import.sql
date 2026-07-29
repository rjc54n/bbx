CREATE OR REPLACE FUNCTION public.repair_cellartracker_import_price(
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
    v_raw JSONB;
    v_total INT;
    v_home INT;
    v_bbr INT;
    v_vintage INT;
    v_errors INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    IF p_price_p < 0 THEN RAISE EXCEPTION 'price cannot be negative' USING ERRCODE = '22023'; END IF;
    SELECT raw_row INTO v_raw FROM public.cellar_import_rows
    WHERE import_id = p_import_id AND source_row_number = p_source_row_number AND match_status = 'invalid' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid staging row not found' USING ERRCODE = 'P0002'; END IF;
    v_total := (v_raw->>'TotalQuantity')::INT; v_home := (v_raw->>'Quantity')::INT; v_bbr := (v_raw->>'Pending')::INT;
    v_vintage := CASE WHEN coalesce(v_raw->>'Vintage','') ~ '^\d{4}$' THEN (v_raw->>'Vintage')::INT END;
    IF v_total <> v_home + v_bbr OR (v_total > 0 AND coalesce(v_raw->>'Size','') <> '750ml') THEN RAISE EXCEPTION 'row has errors other than price' USING ERRCODE = '22023'; END IF;
    UPDATE public.cellar_import_rows SET raw_row = jsonb_set(v_raw, '{Price}', to_jsonb((p_price_p::NUMERIC / 100)::TEXT)), match_status = 'unmatched', validation_errors = '[]'::JSONB WHERE import_id = p_import_id AND source_row_number = p_source_row_number;
    INSERT INTO public.cellartracker_evidence(import_id,source_row_number,source_wine,source_match_key,vintage,bottle_volume_ml,purchase_price_per_bottle_p,quantity_home,quantity_bbr,total_quantity,fully_consumed,colour,producer,country,region,appellation,varietal,begin_consume,end_consume)
    VALUES(p_import_id,p_source_row_number,v_raw->>'Wine',private.release_wine_match_key(v_raw->>'Wine',v_vintage),v_vintage,750,p_price_p,v_home,v_bbr,v_total,v_total=0,nullif(v_raw->>'Color',''),nullif(v_raw->>'Producer',''),nullif(v_raw->>'Country',''),nullif(v_raw->>'Region',''),nullif(v_raw->>'Appellation',''),nullif(v_raw->>'Varietal',''),CASE WHEN coalesce(v_raw->>'BeginConsume','') ~ '^\d+$' THEN (v_raw->>'BeginConsume')::INT END,CASE WHEN coalesce(v_raw->>'EndConsume','') ~ '^\d+$' THEN (v_raw->>'EndConsume')::INT END);
    SELECT count(*) FILTER (WHERE match_status='invalid')::INT INTO v_errors FROM public.cellar_import_rows WHERE import_id=p_import_id;
    UPDATE public.cellar_imports SET error_row_count=v_errors, parsed_row_count=(SELECT count(*)::INT FROM public.cellar_import_rows WHERE import_id=p_import_id), unmatched_row_count=(SELECT count(*)::INT FROM public.cellar_import_rows WHERE import_id=p_import_id AND match_status='unmatched'), source_row_count=(SELECT count(*)::INT FROM public.cellar_import_rows WHERE import_id=p_import_id), status=CASE WHEN v_errors=0 THEN 'validated' ELSE 'failed' END, failure_summary=CASE WHEN v_errors=0 THEN NULL ELSE format('%s invalid source rows.',v_errors) END WHERE id=p_import_id;
    RETURN jsonb_build_object('repaired_row_number',p_source_row_number,'error_row_count',v_errors);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_cellartracker_import(p_import_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE='42501'; END IF;
    DELETE FROM public.cellar_imports WHERE id=p_import_id AND source_type='cellartracker_inventory';
    IF NOT FOUND THEN RAISE EXCEPTION 'CellarTracker import not found' USING ERRCODE='P0002'; END IF;
    RETURN jsonb_build_object('deleted',true);
END;
$$;
REVOKE ALL ON FUNCTION public.repair_cellartracker_import_price(UUID,INT,INT), public.delete_cellartracker_import(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repair_cellartracker_import_price(UUID,INT,INT), public.delete_cellartracker_import(UUID) TO authenticated;
