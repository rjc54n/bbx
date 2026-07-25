-- Phase 5A-5C: single-owner authentication boundary and BBR holdings imports.
--
-- Bootstrap is deliberately manual. Create the owner in Supabase Auth, then
-- insert that stable auth.users.id into public.app_owners using an
-- administrative SQL session. No public route can claim ownership.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE TABLE public.app_owners (
    singleton    BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    user_id      UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_owners ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.app_owners FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_owners TO authenticated;

CREATE POLICY "Owner can read own allowlist row"
    ON public.app_owners
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION private.is_app_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.app_owners
        WHERE user_id = (SELECT auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION private.is_app_owner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_app_owner() TO authenticated;

CREATE TABLE public.cellar_imports (
    id                    UUID PRIMARY KEY,
    source_type           TEXT NOT NULL
        CHECK (source_type IN ('bbr_holdings')),
    content_checksum      TEXT NOT NULL
        CHECK (content_checksum ~ '^[0-9a-f]{64}$'),
    original_filename     TEXT NOT NULL
        CHECK (char_length(original_filename) BETWEEN 1 AND 255),
    byte_size             BIGINT NOT NULL
        CHECK (byte_size BETWEEN 1 AND 4194304),
    storage_object_path   TEXT NOT NULL UNIQUE
        CHECK (char_length(storage_object_path) BETWEEN 1 AND 512),
    uploaded_by           UUID NOT NULL REFERENCES auth.users(id),
    uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    parser_version        TEXT NOT NULL
        CHECK (char_length(parser_version) BETWEEN 1 AND 50),
    status                TEXT NOT NULL
        CHECK (status IN ('validated', 'accepted', 'failed')),
    source_row_count      INT NOT NULL DEFAULT 0 CHECK (source_row_count >= 0),
    parsed_row_count      INT NOT NULL DEFAULT 0 CHECK (parsed_row_count >= 0),
    matched_row_count     INT NOT NULL DEFAULT 0 CHECK (matched_row_count >= 0),
    unmatched_row_count   INT NOT NULL DEFAULT 0 CHECK (unmatched_row_count >= 0),
    warning_row_count     INT NOT NULL DEFAULT 0 CHECK (warning_row_count >= 0),
    error_row_count       INT NOT NULL DEFAULT 0 CHECK (error_row_count >= 0),
    failure_summary       TEXT CHECK (char_length(failure_summary) <= 1000),
    accepted_at           TIMESTAMPTZ,
    accepted_by           UUID REFERENCES auth.users(id),
    UNIQUE (source_type, content_checksum, parser_version),
    CHECK (
        (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_by IS NOT NULL)
        OR
        (status <> 'accepted' AND accepted_at IS NULL AND accepted_by IS NULL)
    )
);

CREATE INDEX idx_cellar_imports_source_accepted
    ON public.cellar_imports(source_type, accepted_at DESC)
    WHERE status = 'accepted';

CREATE TABLE public.cellar_import_rows (
    import_id              UUID NOT NULL
        REFERENCES public.cellar_imports(id) ON DELETE CASCADE,
    source_row_number      INT NOT NULL CHECK (source_row_number > 0),
    raw_row                JSONB NOT NULL CHECK (jsonb_typeof(raw_row) = 'object'),
    match_status           TEXT NOT NULL
        CHECK (match_status IN ('matched', 'unmatched', 'invalid')),
    validation_errors      JSONB NOT NULL DEFAULT '[]'::JSONB
        CHECK (jsonb_typeof(validation_errors) = 'array'),
    validation_warnings    JSONB NOT NULL DEFAULT '[]'::JSONB
        CHECK (jsonb_typeof(validation_warnings) = 'array'),
    parent_sku             TEXT,
    format_code            TEXT,
    PRIMARY KEY (import_id, source_row_number),
    FOREIGN KEY (parent_sku, format_code)
        REFERENCES public.skus(parent_sku, format_code),
    CHECK (
        (match_status = 'matched' AND parent_sku IS NOT NULL AND format_code IS NOT NULL)
        OR
        (match_status <> 'matched')
    )
);

CREATE INDEX idx_cellar_import_rows_match
    ON public.cellar_import_rows(import_id, match_status);

CREATE TABLE public.bbr_holding_evidence (
    import_id                         UUID NOT NULL,
    source_row_number                 INT NOT NULL,
    parent_sku                        TEXT NOT NULL,
    format_code                       TEXT NOT NULL,
    product_code                      TEXT NOT NULL,
    description                       TEXT NOT NULL,
    country                           TEXT,
    region                            TEXT,
    vintage                           INT,
    colour                            TEXT,
    maturity                          TEXT,
    drinking_window_from              INT,
    drinking_window_to                INT,
    bottle_volume_ml                  INT NOT NULL CHECK (bottle_volume_ml > 0),
    quantity_bottles                  INT NOT NULL CHECK (quantity_bottles > 0),
    eligible_for_bbx                  BOOLEAN NOT NULL,
    purchase_price_per_case_p         INT CHECK (purchase_price_per_case_p >= 0),
    case_size                         INT NOT NULL CHECK (case_size > 0),
    livex_market_price_p              INT CHECK (livex_market_price_p >= 0),
    wine_searcher_lowest_list_price_p INT
        CHECK (wine_searcher_lowest_list_price_p >= 0),
    bbx_last_transaction_price_p      INT
        CHECK (bbx_last_transaction_price_p >= 0),
    bbx_lowest_price_p                INT CHECK (bbx_lowest_price_p >= 0),
    bbx_highest_bid_p                 INT CHECK (bbx_highest_bid_p >= 0),
    current_status                    TEXT,
    alcohol_percent                   NUMERIC(5, 2)
        CHECK (alcohol_percent BETWEEN 0 AND 100),
    PRIMARY KEY (import_id, source_row_number),
    FOREIGN KEY (import_id, source_row_number)
        REFERENCES public.cellar_import_rows(import_id, source_row_number)
        ON DELETE CASCADE,
    FOREIGN KEY (parent_sku, format_code)
        REFERENCES public.skus(parent_sku, format_code)
);

CREATE INDEX idx_bbr_holding_evidence_product
    ON public.bbr_holding_evidence(parent_sku, format_code);

ALTER TABLE public.cellar_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cellar_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bbr_holding_evidence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
    public.cellar_imports,
    public.cellar_import_rows,
    public.bbr_holding_evidence
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON
    public.cellar_imports,
    public.cellar_import_rows,
    public.bbr_holding_evidence
TO authenticated;

CREATE POLICY "Owner can read cellar imports"
    ON public.cellar_imports FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can insert cellar imports"
    ON public.cellar_imports FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT private.is_app_owner())
        AND uploaded_by = (SELECT auth.uid())
    );
CREATE POLICY "Owner can update cellar imports"
    ON public.cellar_imports FOR UPDATE TO authenticated
    USING ((SELECT private.is_app_owner()))
    WITH CHECK (
        (SELECT private.is_app_owner())
        AND uploaded_by = (SELECT auth.uid())
    );
CREATE POLICY "Owner can delete cellar imports"
    ON public.cellar_imports FOR DELETE TO authenticated
    USING ((SELECT private.is_app_owner()));

CREATE POLICY "Owner can read cellar import rows"
    ON public.cellar_import_rows FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can insert cellar import rows"
    ON public.cellar_import_rows FOR INSERT TO authenticated
    WITH CHECK ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can update cellar import rows"
    ON public.cellar_import_rows FOR UPDATE TO authenticated
    USING ((SELECT private.is_app_owner()))
    WITH CHECK ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can delete cellar import rows"
    ON public.cellar_import_rows FOR DELETE TO authenticated
    USING ((SELECT private.is_app_owner()));

CREATE POLICY "Owner can read BBR holding evidence"
    ON public.bbr_holding_evidence FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can insert BBR holding evidence"
    ON public.bbr_holding_evidence FOR INSERT TO authenticated
    WITH CHECK ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can update BBR holding evidence"
    ON public.bbr_holding_evidence FOR UPDATE TO authenticated
    USING ((SELECT private.is_app_owner()))
    WITH CHECK ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can delete BBR holding evidence"
    ON public.bbr_holding_evidence FOR DELETE TO authenticated
    USING ((SELECT private.is_app_owner()));

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
    WHERE r.match_status = 'matched';

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

CREATE OR REPLACE FUNCTION public.accept_bbr_import(p_import_id UUID)
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
        RETURN jsonb_build_object(
            'import_id', v_import.id,
            'status', v_import.status,
            'already_accepted', TRUE
        );
    END IF;

    IF v_import.status <> 'validated' OR v_import.error_row_count > 0 THEN
        RAISE EXCEPTION 'only a validated import without row errors can be accepted'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.cellar_imports
    SET
        status = 'accepted',
        accepted_at = now(),
        accepted_by = (SELECT auth.uid())
    WHERE id = p_import_id
    RETURNING * INTO v_import;

    RETURN jsonb_build_object(
        'import_id', v_import.id,
        'status', v_import.status,
        'already_accepted', FALSE,
        'accepted_at', v_import.accepted_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_bbr_import(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_bbr_import(UUID) TO authenticated;

CREATE VIEW public.current_bbr_holdings
WITH (security_invoker = TRUE)
AS
WITH latest AS (
    SELECT id
    FROM public.cellar_imports
    WHERE source_type = 'bbr_holdings'
      AND status = 'accepted'
    ORDER BY accepted_at DESC, id DESC
    LIMIT 1
)
SELECT
    e.import_id,
    i.accepted_at AS confirmed_at,
    e.source_row_number,
    e.parent_sku,
    e.format_code,
    e.product_code,
    e.description,
    e.country,
    e.region,
    e.vintage,
    e.colour,
    e.maturity,
    e.drinking_window_from,
    e.drinking_window_to,
    e.bottle_volume_ml,
    e.quantity_bottles,
    e.eligible_for_bbx,
    e.purchase_price_per_case_p,
    e.case_size,
    e.livex_market_price_p,
    e.wine_searcher_lowest_list_price_p,
    e.bbx_last_transaction_price_p,
    e.bbx_lowest_price_p,
    e.bbx_highest_bid_p,
    e.current_status,
    e.alcohol_percent
FROM latest l
JOIN public.cellar_imports i ON i.id = l.id
JOIN public.bbr_holding_evidence e ON e.import_id = l.id;

REVOKE ALL ON public.current_bbr_holdings
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.current_bbr_holdings TO authenticated;

INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
VALUES (
    'cellar-imports',
    'cellar-imports',
    FALSE,
    4194304,
    ARRAY[
        'text/csv',
        'application/csv',
        'application/vnd.ms-excel',
        'text/plain'
    ]::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET
    public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Owner can read cellar import objects"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'cellar-imports'
        AND (SELECT private.is_app_owner())
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::TEXT)
    );

CREATE POLICY "Owner can upload cellar import objects"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'cellar-imports'
        AND (SELECT private.is_app_owner())
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::TEXT)
    );

CREATE POLICY "Owner can update cellar import objects"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'cellar-imports'
        AND (SELECT private.is_app_owner())
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::TEXT)
    )
    WITH CHECK (
        bucket_id = 'cellar-imports'
        AND (SELECT private.is_app_owner())
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::TEXT)
    );

CREATE POLICY "Owner can delete cellar import objects"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'cellar-imports'
        AND (SELECT private.is_app_owner())
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::TEXT)
    );
