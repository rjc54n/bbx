-- CellarTracker is a complete periodic wine summary, not an event ledger.
ALTER TABLE public.cellar_imports DROP CONSTRAINT cellar_imports_source_type_check;
ALTER TABLE public.cellar_imports ADD CONSTRAINT cellar_imports_source_type_check
  CHECK (source_type IN ('bbr_holdings', 'cellartracker_inventory'));

CREATE TABLE public.cellartracker_evidence (
  import_id UUID NOT NULL REFERENCES public.cellar_imports(id) ON DELETE CASCADE,
  source_row_number INT NOT NULL,
  source_wine TEXT NOT NULL, source_match_key TEXT NOT NULL, vintage INT,
  bottle_volume_ml INT NOT NULL CHECK (bottle_volume_ml = 750),
  purchase_price_per_bottle_p INT CHECK (purchase_price_per_bottle_p >= 0),
  quantity_home INT NOT NULL CHECK (quantity_home >= 0),
  quantity_bbr INT NOT NULL CHECK (quantity_bbr >= 0),
  total_quantity INT NOT NULL CHECK (total_quantity = quantity_home + quantity_bbr),
  fully_consumed BOOLEAN NOT NULL, colour TEXT, producer TEXT, country TEXT,
  region TEXT, appellation TEXT, varietal TEXT, begin_consume INT, end_consume INT,
  PRIMARY KEY (import_id, source_row_number),
  FOREIGN KEY (import_id, source_row_number) REFERENCES public.cellar_import_rows(import_id, source_row_number) ON DELETE CASCADE,
  CHECK ((total_quantity = 0) = fully_consumed)
);
CREATE INDEX cellartracker_evidence_group_idx ON public.cellartracker_evidence(source_match_key, vintage);

CREATE TABLE public.cellartracker_product_resolutions (
  import_id UUID NOT NULL, source_row_number INT NOT NULL, status TEXT NOT NULL CHECK (status IN ('linked','suppressed')),
  parent_sku TEXT, match_method TEXT NOT NULL CHECK (match_method IN ('local_exact','algolia_exact','algolia_confirmed','manual','suppressed')),
  resolved_by UUID REFERENCES auth.users(id), resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (import_id, source_row_number),
  FOREIGN KEY (import_id, source_row_number) REFERENCES public.cellartracker_evidence(import_id, source_row_number) ON DELETE CASCADE,
  CHECK ((status = 'linked' AND parent_sku IS NOT NULL) OR (status = 'suppressed' AND parent_sku IS NULL))
);
CREATE TABLE public.cellartracker_resolution_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, import_id UUID NOT NULL, source_row_number INT NOT NULL,
  event_type TEXT NOT NULL, previous_parent_sku TEXT, parent_sku TEXT, changed_by UUID REFERENCES auth.users(id), changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cellartracker_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cellartracker_product_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cellartracker_resolution_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cellartracker_evidence, public.cellartracker_product_resolutions, public.cellartracker_resolution_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cellartracker_evidence, public.cellartracker_product_resolutions, public.cellartracker_resolution_events TO authenticated;
CREATE POLICY "Owner reads CellarTracker evidence" ON public.cellartracker_evidence FOR SELECT TO authenticated USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner reads CellarTracker resolutions" ON public.cellartracker_product_resolutions FOR SELECT TO authenticated USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner reads CellarTracker audit" ON public.cellartracker_resolution_events FOR SELECT TO authenticated USING ((SELECT private.is_app_owner()));

CREATE OR REPLACE FUNCTION public.stage_cellartracker_import(p_import_id UUID, p_content_checksum TEXT, p_original_filename TEXT, p_byte_size BIGINT, p_storage_object_path TEXT, p_parser_version TEXT, p_rows JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_existing UUID; v_errors INT; v_import UUID;
BEGIN
 IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows)=0 OR jsonb_array_length(p_rows)>10000 THEN RAISE EXCEPTION 'invalid row batch' USING ERRCODE='22023'; END IF;
 SELECT id INTO v_existing FROM public.cellar_imports WHERE source_type='cellartracker_inventory' AND content_checksum=p_content_checksum AND parser_version=p_parser_version;
 IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('import_id',v_existing,'duplicate',true); END IF;
 INSERT INTO public.cellar_imports(id,source_type,content_checksum,original_filename,byte_size,storage_object_path,uploaded_by,parser_version,status,source_row_count,parsed_row_count,matched_row_count,unmatched_row_count,warning_row_count,error_row_count)
 SELECT p_import_id,'cellartracker_inventory',p_content_checksum,p_original_filename,p_byte_size,p_storage_object_path,auth.uid(),p_parser_version,'validated',jsonb_array_length(p_rows),count(*) FILTER (WHERE (r->>'match_status') <> 'invalid'),0,count(*) FILTER (WHERE (r->>'match_status')='unmatched'),count(*) FILTER (WHERE jsonb_array_length(coalesce(r->'validation_warnings','[]'))>0),count(*) FILTER (WHERE (r->>'match_status')='invalid') FROM jsonb_array_elements(p_rows) r RETURNING id INTO v_import;
 INSERT INTO public.cellar_import_rows(import_id,source_row_number,raw_row,match_status,validation_errors,validation_warnings)
 SELECT v_import,(r->>'source_row_number')::INT,r->'raw_row',r->>'match_status',coalesce(r->'validation_errors','[]'),coalesce(r->'validation_warnings','[]') FROM jsonb_array_elements(p_rows) r;
 INSERT INTO public.cellartracker_evidence(import_id,source_row_number,source_wine,source_match_key,vintage,bottle_volume_ml,purchase_price_per_bottle_p,quantity_home,quantity_bbr,total_quantity,fully_consumed,colour,producer,country,region,appellation,varietal,begin_consume,end_consume)
 SELECT v_import,(r->>'source_row_number')::INT,r->>'source_wine',r->>'source_match_key',nullif(r->>'vintage','')::INT,(r->>'bottle_volume_ml')::INT,nullif(r->>'purchase_price_per_bottle_p','')::INT,(r->>'quantity_home')::INT,(r->>'quantity_bbr')::INT,(r->>'total_quantity')::INT,(r->>'fully_consumed')::BOOLEAN,nullif(r->>'colour',''),nullif(r->>'producer',''),nullif(r->>'country',''),nullif(r->>'region',''),nullif(r->>'appellation',''),nullif(r->>'varietal',''),nullif(r->>'begin_consume','')::INT,nullif(r->>'end_consume','')::INT FROM jsonb_array_elements(p_rows) r WHERE (r->>'match_status') <> 'invalid';
 SELECT error_row_count INTO v_errors FROM public.cellar_imports WHERE id=v_import;
 RETURN jsonb_build_object('import_id',v_import,'duplicate',false,'error_row_count',v_errors);
END $$;
CREATE OR REPLACE FUNCTION public.accept_cellartracker_import(p_import_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE='42501'; END IF;
 UPDATE public.cellar_imports SET status='accepted',accepted_at=now(),accepted_by=auth.uid() WHERE id=p_import_id AND source_type='cellartracker_inventory' AND status='validated' AND error_row_count=0;
 IF NOT FOUND THEN RAISE EXCEPTION 'import cannot be accepted' USING ERRCODE='22023'; END IF; RETURN jsonb_build_object('import_id',p_import_id,'status','accepted'); END $$;
REVOKE ALL ON FUNCTION public.stage_cellartracker_import(UUID,TEXT,TEXT,BIGINT,TEXT,TEXT,JSONB), public.accept_cellartracker_import(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stage_cellartracker_import(UUID,TEXT,TEXT,BIGINT,TEXT,TEXT,JSONB), public.accept_cellartracker_import(UUID) TO authenticated;

CREATE VIEW public.current_cellartracker_records WITH (security_invoker=true) AS
WITH latest AS (SELECT id FROM public.cellar_imports WHERE source_type='cellartracker_inventory' AND status='accepted' ORDER BY accepted_at DESC,id DESC LIMIT 1), smallest AS (
 SELECT DISTINCT ON (parent_sku) parent_sku,case_size,ask,highest_bid_p,is_listed FROM public.catalogue_view WHERE case_size > 0 ORDER BY parent_sku,case_size ASC
) SELECT e.*,i.accepted_at,r.parent_sku,r.status AS link_status,r.match_method,s.case_size,s.is_listed,
 CASE WHEN s.ask IS NOT NULL THEN round(s.ask::numeric/s.case_size)::INT END AS lowest_ask_per_bottle_p,
 CASE WHEN s.highest_bid_p IS NOT NULL THEN round(s.highest_bid_p::numeric/s.case_size)::INT END AS highest_bid_per_bottle_p
 FROM latest l JOIN public.cellartracker_evidence e ON e.import_id=l.id JOIN public.cellar_imports i ON i.id=l.id
 LEFT JOIN public.cellartracker_product_resolutions r ON r.import_id=e.import_id AND r.source_row_number=e.source_row_number LEFT JOIN smallest s ON s.parent_sku=r.parent_sku;
REVOKE ALL ON public.current_cellartracker_records FROM PUBLIC,anon,authenticated; GRANT SELECT ON public.current_cellartracker_records TO authenticated;

CREATE OR REPLACE FUNCTION public.begin_cellartracker_matching() RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_linked INT; v_unresolved INT;
BEGIN
 IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE='42501'; END IF;
 WITH latest AS (SELECT id FROM public.cellar_imports WHERE source_type='cellartracker_inventory' AND status='accepted' ORDER BY accepted_at DESC,id DESC LIMIT 1), exact AS (
   SELECT e.import_id,e.source_row_number,min(p.parent_sku) parent_sku FROM latest l JOIN public.cellartracker_evidence e ON e.import_id=l.id JOIN private.products p ON p.vintage IS NOT DISTINCT FROM e.vintage AND private.release_wine_match_key(p.name,p.vintage)=e.source_match_key GROUP BY e.import_id,e.source_row_number HAVING count(DISTINCT p.parent_sku)=1
 ) INSERT INTO public.cellartracker_product_resolutions(import_id,source_row_number,status,parent_sku,match_method,resolved_by)
 SELECT import_id,source_row_number,'linked',parent_sku,'local_exact',auth.uid() FROM exact ON CONFLICT (import_id,source_row_number) DO NOTHING;
 GET DIAGNOSTICS v_linked=ROW_COUNT;
 SELECT count(*) INTO v_unresolved FROM public.current_cellartracker_records WHERE parent_sku IS NULL AND link_status IS NULL;
 RETURN jsonb_build_object('local_exact_link_count',v_linked,'unresolved_row_count',v_unresolved);
END $$;
CREATE OR REPLACE FUNCTION public.set_cellartracker_product_resolution(p_import_id UUID,p_source_row_number INT,p_parent_sku TEXT,p_method TEXT DEFAULT 'manual') RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_previous TEXT;
BEGIN
 IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE='42501'; END IF;
 IF p_parent_sku !~ '^\\d{5,30}$' OR p_method NOT IN ('manual','algolia_confirmed') THEN RAISE EXCEPTION 'invalid resolution' USING ERRCODE='22023'; END IF;
 SELECT parent_sku INTO v_previous FROM public.cellartracker_product_resolutions WHERE import_id=p_import_id AND source_row_number=p_source_row_number;
 INSERT INTO public.cellartracker_product_resolutions(import_id,source_row_number,status,parent_sku,match_method,resolved_by) VALUES(p_import_id,p_source_row_number,'linked',p_parent_sku,p_method,auth.uid()) ON CONFLICT(import_id,source_row_number) DO UPDATE SET status='linked',parent_sku=excluded.parent_sku,match_method=excluded.match_method,resolved_by=excluded.resolved_by,resolved_at=now();
 INSERT INTO public.cellartracker_resolution_events(import_id,source_row_number,event_type,previous_parent_sku,parent_sku,changed_by) VALUES(p_import_id,p_source_row_number,CASE WHEN v_previous IS NULL THEN 'linked' ELSE 'edited' END,v_previous,p_parent_sku,auth.uid());
 RETURN jsonb_build_object('changed',true);
END $$;
CREATE OR REPLACE FUNCTION public.unlink_cellartracker_product_resolution(p_import_id UUID,p_source_row_number INT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_previous TEXT; BEGIN IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE='42501'; END IF; DELETE FROM public.cellartracker_product_resolutions WHERE import_id=p_import_id AND source_row_number=p_source_row_number RETURNING parent_sku INTO v_previous; INSERT INTO public.cellartracker_resolution_events(import_id,source_row_number,event_type,previous_parent_sku,changed_by) VALUES(p_import_id,p_source_row_number,'unlinked',v_previous,auth.uid()); RETURN jsonb_build_object('changed',v_previous IS NOT NULL); END $$;
REVOKE ALL ON FUNCTION public.begin_cellartracker_matching(),public.set_cellartracker_product_resolution(UUID,INT,TEXT,TEXT),public.unlink_cellartracker_product_resolution(UUID,INT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_cellartracker_matching(),public.set_cellartracker_product_resolution(UUID,INT,TEXT,TEXT),public.unlink_cellartracker_product_resolution(UUID,INT) TO authenticated;
