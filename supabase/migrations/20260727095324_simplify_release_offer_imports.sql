-- Manual CSV imports only. Raw evidence is immutable; product-link decisions
-- live independently so matching can safely be repeated as the catalogue moves.

DROP TABLE IF EXISTS public.release_offer_ingestion_cursors;
DROP TABLE IF EXISTS public.release_offer_link_resolutions;

DROP VIEW public.release_price_market_view;
DROP VIEW public.release_price_anchor_view;
DROP VIEW public.release_offer_evidence_view;

DROP FUNCTION IF EXISTS public.resolve_release_offer_row(UUID, INT, TEXT);
DROP FUNCTION IF EXISTS public.run_release_offer_matching(UUID);

ALTER TABLE public.release_offer_imports
    DROP COLUMN source_type,
    DROP COLUMN matched_row_count,
    DROP COLUMN unmatched_row_count;

ALTER TABLE public.release_offer_imports
    ALTER COLUMN byte_size SET NOT NULL,
    ALTER COLUMN storage_object_path SET NOT NULL;

ALTER TABLE public.release_offer_imports
    DROP CONSTRAINT IF EXISTS release_offer_imports_source_storage_check,
    DROP CONSTRAINT IF EXISTS release_offer_imports_status_check;

ALTER TABLE public.release_offer_imports
    ADD CONSTRAINT release_offer_imports_status_check
        CHECK (status IN ('staging', 'staged', 'accepted', 'failed'));

ALTER TABLE public.release_offer_source_rows
    DROP COLUMN match_status,
    DROP COLUMN match_method,
    DROP COLUMN parent_sku,
    DROP COLUMN match_candidates;

DROP INDEX IF EXISTS public.idx_release_offer_rows_resolution;
DROP INDEX IF EXISTS public.idx_release_offer_rows_product;

ALTER TABLE public.release_offer_prices
    DROP COLUMN publication_status,
    DROP COLUMN rejection_reason;

DROP INDEX IF EXISTS public.idx_release_offer_prices_publication;

CREATE TABLE public.release_offer_product_resolutions (
    import_id UUID NOT NULL,
    source_row_number INT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('linked', 'ignored')),
    parent_sku TEXT,
    match_method TEXT CHECK (match_method IN ('direct', 'exact_name_vintage', 'manual')),
    resolved_by UUID REFERENCES auth.users(id),
    resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (import_id, source_row_number),
    FOREIGN KEY (import_id, source_row_number)
        REFERENCES public.release_offer_source_rows(import_id, source_row_number)
        ON DELETE CASCADE,
    CHECK (parent_sku IS NULL OR parent_sku ~ '^\\d{5,30}$'),
    CHECK (
        (status = 'linked' AND parent_sku IS NOT NULL AND match_method IS NOT NULL)
        OR (status = 'ignored' AND parent_sku IS NULL AND match_method IS NULL)
    )
);

CREATE INDEX idx_release_offer_product_resolutions_import_status
    ON public.release_offer_product_resolutions(import_id, status, source_row_number);
CREATE INDEX idx_release_offer_product_resolutions_parent_sku
    ON public.release_offer_product_resolutions(parent_sku)
    WHERE parent_sku IS NOT NULL;

ALTER TABLE public.release_offer_product_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.release_offer_product_resolutions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.release_offer_product_resolutions TO authenticated;
CREATE POLICY "Owner can read release offer product resolutions"
    ON public.release_offer_product_resolutions FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));

DROP FUNCTION public.begin_release_offer_import(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT);
CREATE FUNCTION public.begin_release_offer_import(
    p_import_id UUID, p_content_checksum TEXT, p_original_filename TEXT,
    p_byte_size BIGINT, p_storage_object_path TEXT, p_parser_version TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_existing public.release_offer_imports%ROWTYPE;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    SELECT * INTO v_existing FROM public.release_offer_imports
    WHERE content_checksum = p_content_checksum AND parser_version = p_parser_version;
    IF FOUND THEN RETURN jsonb_build_object('import_id', v_existing.id, 'status', v_existing.status, 'duplicate', TRUE); END IF;
    INSERT INTO public.release_offer_imports (id, content_checksum, original_filename, byte_size, storage_object_path, imported_by, parser_version)
    VALUES (p_import_id, p_content_checksum, p_original_filename, p_byte_size, p_storage_object_path, (SELECT auth.uid()), p_parser_version);
    RETURN jsonb_build_object('import_id', p_import_id, 'status', 'staging', 'duplicate', FALSE);
END; $$;
REVOKE ALL ON FUNCTION public.begin_release_offer_import(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_release_offer_import(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.stage_release_offer_batch(p_import_id UUID, p_rows JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status TEXT; v_row_count INT; v_price_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 OR jsonb_array_length(p_rows) > 250 THEN
        RAISE EXCEPTION 'p_rows must contain 1 to 250 rows' USING ERRCODE = '22023';
    END IF;
    SELECT status INTO v_status FROM public.release_offer_imports WHERE id = p_import_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'import not found' USING ERRCODE = 'P0002'; END IF;
    IF v_status <> 'staging' THEN RAISE EXCEPTION 'only a staging import can receive rows' USING ERRCODE = '22023'; END IF;
    WITH input_rows AS (
        SELECT * FROM jsonb_to_recordset(p_rows) AS r(source_row_number INT, raw_row JSONB, offer_date DATE, source_wine TEXT, source_vintage INT, source_match_key TEXT, source_price_text TEXT, description TEXT, tasting_notes TEXT, source_message_id TEXT, source_product_url TEXT, source_product_id TEXT, content_fingerprint TEXT, validation_errors JSONB, validation_warnings JSONB, prices JSONB)
    )
    INSERT INTO public.release_offer_source_rows (import_id, source_row_number, raw_row, offer_date, source_wine, source_vintage, source_match_key, source_price_text, description, tasting_notes, source_message_id, source_product_url, source_product_id, content_fingerprint, validation_errors, validation_warnings)
    SELECT p_import_id, source_row_number, raw_row, offer_date, source_wine, source_vintage, source_match_key, source_price_text, description, tasting_notes, source_message_id, source_product_url, source_product_id, content_fingerprint, validation_errors, validation_warnings FROM input_rows
    ON CONFLICT (import_id, source_row_number) DO NOTHING;
    WITH input_rows AS (SELECT * FROM jsonb_to_recordset(p_rows) AS r(source_row_number INT, prices JSONB))
    INSERT INTO public.release_offer_prices (import_id, source_row_number, fragment_index, raw_price_text, amount_p, currency, case_size, bottle_volume_ml, format_code, tax_basis, parse_status, price_fingerprint, validation_warnings)
    SELECT p_import_id, r.source_row_number, p.fragment_index, p.raw_price_text, p.amount_p, coalesce(p.currency, 'GBP'), p.case_size, p.bottle_volume_ml, p.format_code, p.tax_basis, p.parse_status, p.price_fingerprint, p.validation_warnings
    FROM input_rows r CROSS JOIN LATERAL jsonb_to_recordset(r.prices) AS p(fragment_index INT, raw_price_text TEXT, amount_p INT, currency TEXT, case_size INT, bottle_volume_ml INT, format_code TEXT, tax_basis TEXT, parse_status TEXT, price_fingerprint TEXT, validation_warnings JSONB)
    ON CONFLICT (import_id, source_row_number, fragment_index) DO NOTHING;
    SELECT count(*)::INT INTO v_row_count FROM public.release_offer_source_rows WHERE import_id = p_import_id;
    SELECT count(*)::INT INTO v_price_count FROM public.release_offer_prices WHERE import_id = p_import_id;
    RETURN jsonb_build_object('import_id', p_import_id, 'source_row_count', v_row_count, 'priced_fragment_count', v_price_count);
END; $$;

CREATE OR REPLACE FUNCTION public.mark_release_offer_import_staged(
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
    v_rows INT;
    v_prices INT;
    v_warnings INT;
    v_errors INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    PERFORM 1 FROM public.release_offer_imports WHERE id = p_import_id AND status = 'staging' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'only a staging import can be marked staged' USING ERRCODE = '22023'; END IF;
    SELECT count(*)::INT, count(*) FILTER (WHERE jsonb_array_length(validation_warnings) > 0)::INT,
           count(*) FILTER (WHERE jsonb_array_length(validation_errors) > 0)::INT
    INTO v_rows, v_warnings, v_errors
    FROM public.release_offer_source_rows WHERE import_id = p_import_id;
    SELECT count(*)::INT INTO v_prices FROM public.release_offer_prices WHERE import_id = p_import_id;
    IF v_rows <> p_expected_source_rows OR v_prices <> p_expected_price_fragments THEN
        RAISE EXCEPTION 'staged count mismatch: expected % rows/% prices, found %/%', p_expected_source_rows, p_expected_price_fragments, v_rows, v_prices USING ERRCODE = '22023';
    END IF;
    UPDATE public.release_offer_imports
    SET status = CASE WHEN v_errors > 0 THEN 'failed' ELSE 'staged' END,
        source_row_count = v_rows, priced_fragment_count = v_prices,
        warning_row_count = v_warnings, error_row_count = v_errors,
        failure_summary = CASE WHEN v_errors > 0 THEN format('%s source row(s) failed validation', v_errors) END
    WHERE id = p_import_id;
    RETURN jsonb_build_object('import_id', p_import_id, 'status', CASE WHEN v_errors > 0 THEN 'failed' ELSE 'staged' END, 'source_row_count', v_rows, 'priced_fragment_count', v_prices);
END;
$$;

CREATE FUNCTION public.run_release_offer_matching(p_import_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_linked INT;
    v_unresolved INT;
    v_ignored INT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    PERFORM 1 FROM public.release_offer_imports
    WHERE id = p_import_id AND status IN ('staged', 'accepted') FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'only staged or accepted imports can be matched' USING ERRCODE = '22023'; END IF;

    INSERT INTO public.release_offer_product_resolutions (import_id, source_row_number, status, parent_sku, match_method, resolved_by)
    SELECT r.import_id, r.source_row_number, 'linked', r.source_product_id, 'direct', (SELECT auth.uid())
    FROM public.release_offer_source_rows r
    WHERE r.import_id = p_import_id AND r.source_product_id IS NOT NULL
    ON CONFLICT (import_id, source_row_number) DO UPDATE
    SET status = EXCLUDED.status, parent_sku = EXCLUDED.parent_sku, match_method = EXCLUDED.match_method,
        resolved_by = EXCLUDED.resolved_by, resolved_at = now()
    WHERE public.release_offer_product_resolutions.status = 'linked'
      AND public.release_offer_product_resolutions.match_method IN ('direct', 'exact_name_vintage');

    WITH candidates AS (
        SELECT r.import_id, r.source_row_number, min(p.parent_sku) AS parent_sku
        FROM public.release_offer_source_rows r
        JOIN public.products p ON p.vintage = r.source_vintage
        LEFT JOIN public.release_offer_product_resolutions resolution
          ON resolution.import_id = r.import_id AND resolution.source_row_number = r.source_row_number
        WHERE r.import_id = p_import_id AND resolution.import_id IS NULL
          AND private.release_wine_match_key(p.name, p.vintage) = r.source_match_key
        GROUP BY r.import_id, r.source_row_number HAVING count(*) = 1
    )
    INSERT INTO public.release_offer_product_resolutions (import_id, source_row_number, status, parent_sku, match_method, resolved_by)
    SELECT import_id, source_row_number, 'linked', parent_sku, 'exact_name_vintage', (SELECT auth.uid()) FROM candidates;

    SELECT count(*) FILTER (WHERE resolution.status = 'linked')::INT,
           count(*) FILTER (WHERE resolution.status = 'ignored')::INT,
           count(*) FILTER (WHERE resolution.import_id IS NULL)::INT
    INTO v_linked, v_ignored, v_unresolved
    FROM public.release_offer_source_rows row
    LEFT JOIN public.release_offer_product_resolutions resolution
      ON resolution.import_id = row.import_id AND resolution.source_row_number = row.source_row_number
    WHERE row.import_id = p_import_id;
    RETURN jsonb_build_object('import_id', p_import_id, 'linked_row_count', v_linked, 'unresolved_row_count', v_unresolved, 'ignored_row_count', v_ignored);
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_release_offer_import(p_import_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    UPDATE public.release_offer_imports
    SET status = 'accepted', accepted_at = now(), accepted_by = (SELECT auth.uid())
    WHERE id = p_import_id AND status = 'staged';
    IF NOT FOUND THEN RAISE EXCEPTION 'only a staged import can be accepted' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('import_id', p_import_id, 'status', 'accepted');
END; $$;

CREATE FUNCTION public.set_release_offer_product_resolution(p_import_id UUID, p_source_row_number INT, p_parent_sku TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    IF p_parent_sku !~ '^\\d{5,30}$' THEN RAISE EXCEPTION 'invalid parent SKU' USING ERRCODE = '22023'; END IF;
    PERFORM 1 FROM public.release_offer_source_rows WHERE import_id = p_import_id AND source_row_number = p_source_row_number;
    IF NOT FOUND THEN RAISE EXCEPTION 'source row not found' USING ERRCODE = 'P0002'; END IF;
    INSERT INTO public.release_offer_product_resolutions (import_id, source_row_number, status, parent_sku, match_method, resolved_by)
    VALUES (p_import_id, p_source_row_number, 'linked', p_parent_sku, 'manual', (SELECT auth.uid()))
    ON CONFLICT (import_id, source_row_number) DO UPDATE SET status = EXCLUDED.status, parent_sku = EXCLUDED.parent_sku, match_method = EXCLUDED.match_method, resolved_by = EXCLUDED.resolved_by, resolved_at = now();
    RETURN jsonb_build_object('status', 'linked', 'parent_sku', p_parent_sku, 'match_method', 'manual');
END; $$;

CREATE FUNCTION public.ignore_release_offer_row(p_import_id UUID, p_source_row_number INT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    PERFORM 1 FROM public.release_offer_source_rows WHERE import_id = p_import_id AND source_row_number = p_source_row_number;
    IF NOT FOUND THEN RAISE EXCEPTION 'source row not found' USING ERRCODE = 'P0002'; END IF;
    INSERT INTO public.release_offer_product_resolutions (import_id, source_row_number, status, resolved_by)
    VALUES (p_import_id, p_source_row_number, 'ignored', (SELECT auth.uid()))
    ON CONFLICT (import_id, source_row_number) DO UPDATE SET status = 'ignored', parent_sku = NULL, match_method = NULL, resolved_by = EXCLUDED.resolved_by, resolved_at = now();
    RETURN jsonb_build_object('status', 'ignored');
END; $$;

CREATE FUNCTION public.clear_release_offer_product_resolution(p_import_id UUID, p_source_row_number INT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    DELETE FROM public.release_offer_product_resolutions WHERE import_id = p_import_id AND source_row_number = p_source_row_number;
    RETURN jsonb_build_object('status', 'unresolved');
END; $$;

CREATE FUNCTION public.delete_release_offer_import(p_import_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_path TEXT;
BEGIN
    IF NOT private.is_app_owner() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
    SELECT storage_object_path INTO v_path FROM public.release_offer_imports WHERE id = p_import_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'import not found' USING ERRCODE = 'P0002'; END IF;
    DELETE FROM public.release_price_anchor_overrides WHERE release_offer_price_id IN (SELECT id FROM public.release_offer_prices WHERE import_id = p_import_id);
    DELETE FROM public.release_offer_imports WHERE id = p_import_id;
    RETURN jsonb_build_object('storage_object_path', v_path);
END; $$;

REVOKE ALL ON FUNCTION public.run_release_offer_matching(UUID), public.set_release_offer_product_resolution(UUID, INT, TEXT), public.ignore_release_offer_row(UUID, INT), public.clear_release_offer_product_resolution(UUID, INT), public.delete_release_offer_import(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_release_offer_matching(UUID), public.set_release_offer_product_resolution(UUID, INT, TEXT), public.ignore_release_offer_row(UUID, INT), public.clear_release_offer_product_resolution(UUID, INT), public.delete_release_offer_import(UUID) TO authenticated;

CREATE VIEW public.release_offer_evidence_view WITH (security_invoker = TRUE) AS
WITH ranked AS (
    SELECT price.id AS release_offer_price_id, row.import_id, row.source_row_number,
        resolution.parent_sku, price.format_code, row.offer_date, row.source_wine,
        row.source_product_url, price.amount_p AS release_price_p, price.case_size,
        price.bottle_volume_ml, price.tax_basis, resolution.match_method, row.source_message_id,
        row.content_fingerprint,
        row_number() OVER (PARTITION BY resolution.parent_sku, price.format_code, row.offer_date, price.amount_p ORDER BY imports.accepted_at, row.import_id, row.source_row_number, price.fragment_index) AS duplicate_rank
    FROM public.release_offer_prices price
    JOIN public.release_offer_source_rows row ON row.import_id = price.import_id AND row.source_row_number = price.source_row_number
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    JOIN public.release_offer_product_resolutions resolution ON resolution.import_id = row.import_id AND resolution.source_row_number = row.source_row_number
    WHERE imports.status = 'accepted' AND resolution.status = 'linked' AND price.parse_status = 'valid' AND price.tax_basis = 'in_bond'
) SELECT * FROM ranked WHERE duplicate_rank = 1;

CREATE VIEW public.release_price_anchor_view WITH (security_invoker = TRUE) AS
WITH provisional AS (
    SELECT DISTINCT ON (parent_sku, format_code) parent_sku, format_code, release_offer_price_id, offer_date, release_price_p, source_wine, source_product_url
    FROM public.release_offer_evidence_view ORDER BY parent_sku, format_code, offer_date, release_offer_price_id
), selected AS (
    SELECT p.parent_sku, p.format_code, coalesce(confirmed.release_offer_price_id, p.release_offer_price_id) AS release_offer_price_id,
        CASE WHEN override.release_offer_price_id IS NULL THEN 'provisional' ELSE 'confirmed' END AS anchor_status
    FROM provisional p LEFT JOIN public.release_price_anchor_overrides override ON override.parent_sku = p.parent_sku AND override.format_code = p.format_code
    LEFT JOIN public.release_offer_evidence_view confirmed ON confirmed.release_offer_price_id = override.release_offer_price_id
)
SELECT selected.parent_sku, selected.format_code, selected.anchor_status, evidence.release_offer_price_id, evidence.offer_date, evidence.release_price_p, evidence.source_wine, evidence.source_product_url
FROM selected JOIN public.release_offer_evidence_view evidence ON evidence.release_offer_price_id = selected.release_offer_price_id;

CREATE VIEW public.release_price_market_view WITH (security_invoker = TRUE) AS
SELECT anchor.parent_sku, anchor.format_code, anchor.anchor_status, anchor.release_offer_price_id, anchor.offer_date, anchor.release_price_p, anchor.source_wine, anchor.source_product_url,
    catalogue.name, catalogue.vintage, catalogue.region, catalogue.colour, catalogue.producer, catalogue.product_url, catalogue.case_size, catalogue.bottle_volume_ml, catalogue.is_listed, catalogue.ask AS lowest_ask_p, catalogue.highest_bid_p, catalogue.market_price_p, catalogue.last_rest_checked_at,
    catalogue.ask - anchor.release_price_p AS ask_vs_release_p, round(100 * (catalogue.ask - anchor.release_price_p)::NUMERIC / NULLIF(anchor.release_price_p, 0), 1) AS ask_vs_release_pct,
    catalogue.highest_bid_p - anchor.release_price_p AS bid_vs_release_p, round(100 * (catalogue.highest_bid_p - anchor.release_price_p)::NUMERIC / NULLIF(anchor.release_price_p, 0), 1) AS bid_vs_release_pct,
    floor(catalogue.highest_bid_p * (1 - fee.seller_commission_rate))::INT AS seller_net_highest_bid_p,
    (ceil(anchor.release_price_p / ((1 - fee.seller_commission_rate) * 100)) * 100)::INT AS recoup_bid_p, fee.seller_commission_rate
FROM public.release_price_anchor_view anchor LEFT JOIN public.catalogue_view catalogue ON catalogue.parent_sku = anchor.parent_sku AND catalogue.format_code = anchor.format_code
CROSS JOIN LATERAL (SELECT seller_commission_rate FROM public.bbx_fee_schedule WHERE effective_from <= current_date ORDER BY effective_from DESC LIMIT 1) fee;

REVOKE ALL ON public.release_offer_evidence_view, public.release_price_anchor_view, public.release_price_market_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.release_offer_evidence_view, public.release_price_anchor_view, public.release_price_market_view TO authenticated;
