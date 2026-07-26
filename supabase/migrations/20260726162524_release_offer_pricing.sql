-- Phase 7: private BBR release-offer evidence and current BBX comparisons.
--
-- Source rows remain immutable evidence. Publication is deliberately narrower:
-- only accepted imports, exact product matches, exact BBX formats and explicit
-- in-bond prices can supply release-price anchors.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE OR REPLACE FUNCTION private.release_wine_match_key(
    p_name TEXT,
    p_vintage INT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT trim(regexp_replace(
        regexp_replace(
            lower(translate(
                coalesce(p_name, ''),
                'àáâãäåæçèéêëìíîïñòóôõöœùúûüýÿ',
                'aaaaaaaceeeeiiiinooooooeuuuuyy'
            )),
            CASE
                WHEN p_vintage IS NULL THEN '(?!)'
                ELSE '(^|[^0-9])' || p_vintage::TEXT || '([^0-9]|$)'
            END,
            ' ',
            'g'
        ),
        '[^a-z0-9]+',
        ' ',
        'g'
    ));
$$;

REVOKE ALL ON FUNCTION private.release_wine_match_key(TEXT, INT)
    FROM PUBLIC, anon, authenticated;

CREATE INDEX idx_products_release_name_match
    ON public.products (
        vintage,
        private.release_wine_match_key(name, vintage)
    );

CREATE TABLE public.release_offer_imports (
    id                    UUID PRIMARY KEY,
    source_type           TEXT NOT NULL
        CHECK (source_type IN ('historic_csv', 'gmail')),
    content_checksum      TEXT NOT NULL
        CHECK (content_checksum ~ '^[0-9a-f]{64}$'),
    original_filename     TEXT NOT NULL
        CHECK (char_length(original_filename) BETWEEN 1 AND 255),
    byte_size             BIGINT NOT NULL
        CHECK (byte_size BETWEEN 1 AND 4194304),
    storage_object_path   TEXT NOT NULL UNIQUE
        CHECK (char_length(storage_object_path) BETWEEN 1 AND 512),
    imported_by           UUID NOT NULL REFERENCES auth.users(id),
    imported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    parser_version        TEXT NOT NULL
        CHECK (char_length(parser_version) BETWEEN 1 AND 50),
    status                TEXT NOT NULL DEFAULT 'staging'
        CHECK (status IN ('staging', 'validated', 'accepted', 'failed')),
    source_row_count      INT NOT NULL DEFAULT 0 CHECK (source_row_count >= 0),
    priced_fragment_count INT NOT NULL DEFAULT 0 CHECK (priced_fragment_count >= 0),
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

CREATE INDEX idx_release_offer_imports_status
    ON public.release_offer_imports(imported_at DESC, status);

CREATE TABLE public.release_offer_source_rows (
    import_id             UUID NOT NULL
        REFERENCES public.release_offer_imports(id) ON DELETE CASCADE,
    source_row_number     INT NOT NULL CHECK (source_row_number > 0),
    raw_row               JSONB NOT NULL CHECK (jsonb_typeof(raw_row) = 'object'),
    offer_date            DATE NOT NULL,
    source_wine           TEXT NOT NULL CHECK (char_length(source_wine) BETWEEN 1 AND 1000),
    source_vintage        INT CHECK (source_vintage BETWEEN 1800 AND 2099),
    source_match_key      TEXT NOT NULL CHECK (char_length(source_match_key) BETWEEN 1 AND 1000),
    source_price_text     TEXT NOT NULL CHECK (char_length(source_price_text) BETWEEN 1 AND 2000),
    description           TEXT,
    tasting_notes         TEXT,
    source_message_id     TEXT,
    source_product_url    TEXT,
    source_product_id     TEXT,
    content_fingerprint   TEXT NOT NULL CHECK (content_fingerprint ~ '^[0-9a-f]{64}$'),
    match_status          TEXT NOT NULL DEFAULT 'unmatched'
        CHECK (match_status IN ('matched', 'unmatched', 'invalid')),
    match_method          TEXT
        CHECK (match_method IN ('source_product_id', 'exact_name_vintage', 'manual')),
    parent_sku            TEXT REFERENCES public.products(parent_sku),
    match_candidates      JSONB NOT NULL DEFAULT '[]'::JSONB
        CHECK (jsonb_typeof(match_candidates) = 'array'),
    validation_errors     JSONB NOT NULL DEFAULT '[]'::JSONB
        CHECK (jsonb_typeof(validation_errors) = 'array'),
    validation_warnings   JSONB NOT NULL DEFAULT '[]'::JSONB
        CHECK (jsonb_typeof(validation_warnings) = 'array'),
    PRIMARY KEY (import_id, source_row_number),
    CHECK (
        (match_status = 'matched' AND parent_sku IS NOT NULL AND match_method IS NOT NULL)
        OR
        (match_status <> 'matched' AND parent_sku IS NULL AND match_method IS NULL)
    )
);

CREATE INDEX idx_release_offer_rows_resolution
    ON public.release_offer_source_rows(import_id, match_status, source_row_number);
CREATE INDEX idx_release_offer_rows_product
    ON public.release_offer_source_rows(parent_sku, offer_date)
    WHERE parent_sku IS NOT NULL;

CREATE TABLE public.release_offer_prices (
    id                    BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    import_id             UUID NOT NULL,
    source_row_number     INT NOT NULL,
    fragment_index        INT NOT NULL CHECK (fragment_index > 0),
    raw_price_text        TEXT NOT NULL CHECK (char_length(raw_price_text) BETWEEN 1 AND 1000),
    amount_p              INT CHECK (amount_p > 0),
    currency              TEXT NOT NULL DEFAULT 'GBP' CHECK (currency = 'GBP'),
    case_size             INT CHECK (case_size > 0),
    bottle_volume_ml      INT CHECK (bottle_volume_ml > 0),
    format_code           TEXT,
    tax_basis             TEXT NOT NULL
        CHECK (tax_basis IN ('in_bond', 'duty_paid', 'unknown')),
    parse_status          TEXT NOT NULL
        CHECK (parse_status IN ('valid', 'unresolved')),
    price_fingerprint     TEXT NOT NULL CHECK (price_fingerprint ~ '^[0-9a-f]{64}$'),
    validation_warnings   JSONB NOT NULL DEFAULT '[]'::JSONB
        CHECK (jsonb_typeof(validation_warnings) = 'array'),
    publication_status    TEXT NOT NULL DEFAULT 'pending'
        CHECK (publication_status IN ('pending', 'published', 'rejected')),
    rejection_reason      TEXT,
    UNIQUE (import_id, source_row_number, fragment_index),
    FOREIGN KEY (import_id, source_row_number)
        REFERENCES public.release_offer_source_rows(import_id, source_row_number)
        ON DELETE CASCADE,
    CHECK (
        (parse_status = 'valid'
            AND amount_p IS NOT NULL
            AND case_size IS NOT NULL
            AND bottle_volume_ml IS NOT NULL
            AND format_code IS NOT NULL)
        OR parse_status = 'unresolved'
    )
);

CREATE INDEX idx_release_offer_prices_publication
    ON public.release_offer_prices(publication_status, format_code);

CREATE TABLE public.release_price_anchor_overrides (
    parent_sku            TEXT NOT NULL,
    format_code           TEXT NOT NULL,
    release_offer_price_id BIGINT NOT NULL UNIQUE
        REFERENCES public.release_offer_prices(id),
    note                  TEXT CHECK (char_length(note) <= 1000),
    confirmed_by          UUID NOT NULL REFERENCES auth.users(id),
    confirmed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (parent_sku, format_code),
    FOREIGN KEY (parent_sku, format_code)
        REFERENCES public.skus(parent_sku, format_code)
);

CREATE TABLE public.bbx_fee_schedule (
    effective_from DATE PRIMARY KEY,
    seller_commission_rate NUMERIC(6, 5) NOT NULL
        CHECK (seller_commission_rate >= 0 AND seller_commission_rate < 1),
    source_url TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.bbx_fee_schedule (
    effective_from,
    seller_commission_rate,
    source_url
)
VALUES (
    DATE '2026-07-26',
    0.10,
    'https://www.bbr.com/customer-support/bbx'
);

ALTER TABLE public.release_offer_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_offer_source_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_offer_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_price_anchor_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bbx_fee_schedule ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
    public.release_offer_imports,
    public.release_offer_source_rows,
    public.release_offer_prices,
    public.release_price_anchor_overrides,
    public.bbx_fee_schedule
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON
    public.release_offer_imports,
    public.release_offer_source_rows,
    public.release_offer_prices,
    public.release_price_anchor_overrides,
    public.bbx_fee_schedule
TO authenticated;

CREATE POLICY "Owner can read release offer imports"
    ON public.release_offer_imports FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can read release offer rows"
    ON public.release_offer_source_rows FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can read release offer prices"
    ON public.release_offer_prices FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can read release anchor overrides"
    ON public.release_price_anchor_overrides FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));
CREATE POLICY "Owner can read BBX fee schedule"
    ON public.bbx_fee_schedule FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));

CREATE OR REPLACE FUNCTION public.begin_release_offer_import(
    p_import_id UUID,
    p_source_type TEXT,
    p_content_checksum TEXT,
    p_original_filename TEXT,
    p_byte_size BIGINT,
    p_storage_object_path TEXT,
    p_parser_version TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing public.release_offer_imports%ROWTYPE;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_existing
    FROM public.release_offer_imports
    WHERE source_type = p_source_type
      AND content_checksum = p_content_checksum
      AND parser_version = p_parser_version;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'import_id', v_existing.id,
            'status', v_existing.status,
            'duplicate', TRUE
        );
    END IF;

    INSERT INTO public.release_offer_imports (
        id, source_type, content_checksum, original_filename, byte_size,
        storage_object_path, imported_by, parser_version
    ) VALUES (
        p_import_id, p_source_type, p_content_checksum, p_original_filename,
        p_byte_size, p_storage_object_path, (SELECT auth.uid()), p_parser_version
    );

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'status', 'staging',
        'duplicate', FALSE
    );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_release_offer_import(
    UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_release_offer_import(
    UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.stage_release_offer_batch(
    p_import_id UUID,
    p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status TEXT;
    v_row_count INT;
    v_price_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(p_rows) <> 'array'
       OR jsonb_array_length(p_rows) = 0
       OR jsonb_array_length(p_rows) > 250 THEN
        RAISE EXCEPTION 'p_rows must contain 1 to 250 rows'
            USING ERRCODE = '22023';
    END IF;

    SELECT status INTO v_status
    FROM public.release_offer_imports
    WHERE id = p_import_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'import not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_status <> 'staging' THEN
        RAISE EXCEPTION 'only a staging import can receive rows'
            USING ERRCODE = '22023';
    END IF;

    WITH input_rows AS (
        SELECT *
        FROM jsonb_to_recordset(p_rows) AS r(
            source_row_number INT,
            raw_row JSONB,
            offer_date DATE,
            source_wine TEXT,
            source_vintage INT,
            source_match_key TEXT,
            source_price_text TEXT,
            description TEXT,
            tasting_notes TEXT,
            source_message_id TEXT,
            source_product_url TEXT,
            source_product_id TEXT,
            content_fingerprint TEXT,
            validation_errors JSONB,
            validation_warnings JSONB,
            prices JSONB
        )
    )
    INSERT INTO public.release_offer_source_rows (
        import_id, source_row_number, raw_row, offer_date, source_wine, source_vintage,
        source_match_key, source_price_text, description, tasting_notes,
        source_message_id, source_product_url, source_product_id,
        content_fingerprint, match_status, validation_errors,
        validation_warnings
    )
    SELECT
        p_import_id, source_row_number, raw_row, offer_date, source_wine, source_vintage,
        source_match_key, source_price_text, description, tasting_notes,
        source_message_id, source_product_url, source_product_id,
        content_fingerprint,
        CASE
            WHEN jsonb_array_length(validation_errors) > 0 THEN 'invalid'
            ELSE 'unmatched'
        END,
        validation_errors,
        validation_warnings
    FROM input_rows
    ON CONFLICT (import_id, source_row_number) DO NOTHING;

    WITH input_rows AS (
        SELECT *
        FROM jsonb_to_recordset(p_rows) AS r(
            source_row_number INT,
            prices JSONB
        )
    )
    INSERT INTO public.release_offer_prices (
        import_id, source_row_number, fragment_index, raw_price_text,
        amount_p, currency, case_size, bottle_volume_ml, format_code,
        tax_basis, parse_status, price_fingerprint, validation_warnings
    )
    SELECT
        p_import_id,
        r.source_row_number,
        p.fragment_index,
        p.raw_price_text,
        p.amount_p,
        coalesce(p.currency, 'GBP'),
        p.case_size,
        p.bottle_volume_ml,
        p.format_code,
        p.tax_basis,
        p.parse_status,
        p.price_fingerprint,
        p.validation_warnings
    FROM input_rows r
    CROSS JOIN LATERAL jsonb_to_recordset(r.prices) AS p(
        fragment_index INT,
        raw_price_text TEXT,
        amount_p INT,
        currency TEXT,
        case_size INT,
        bottle_volume_ml INT,
        format_code TEXT,
        tax_basis TEXT,
        parse_status TEXT,
        price_fingerprint TEXT,
        validation_warnings JSONB
    )
    ON CONFLICT (import_id, source_row_number, fragment_index) DO NOTHING;

    SELECT count(*)::INT INTO v_row_count
    FROM public.release_offer_source_rows
    WHERE import_id = p_import_id;
    SELECT count(*)::INT INTO v_price_count
    FROM public.release_offer_prices
    WHERE import_id = p_import_id;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'source_row_count', v_row_count,
        'priced_fragment_count', v_price_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.stage_release_offer_batch(UUID, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_release_offer_batch(UUID, JSONB)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.finalise_release_offer_import(
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
    v_import public.release_offer_imports%ROWTYPE;
    v_rows INT;
    v_prices INT;
    v_matched INT;
    v_unmatched INT;
    v_warning INT;
    v_errors INT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_import
    FROM public.release_offer_imports
    WHERE id = p_import_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'import not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_import.status <> 'staging' THEN
        RAISE EXCEPTION 'only a staging import can be finalised'
            USING ERRCODE = '22023';
    END IF;

    SELECT count(*)::INT INTO v_rows
    FROM public.release_offer_source_rows WHERE import_id = p_import_id;
    SELECT count(*)::INT INTO v_prices
    FROM public.release_offer_prices WHERE import_id = p_import_id;
    IF v_rows <> p_expected_source_rows OR v_prices <> p_expected_price_fragments THEN
        RAISE EXCEPTION 'staged count mismatch: expected % rows/% prices, found %/%',
            p_expected_source_rows, p_expected_price_fragments, v_rows, v_prices
            USING ERRCODE = '22023';
    END IF;

    -- A product identifier from a resolved BBR URL is the strongest match.
    UPDATE public.release_offer_source_rows r
    SET
        parent_sku = p.parent_sku,
        match_status = 'matched',
        match_method = 'source_product_id'
    FROM public.products p
    WHERE r.import_id = p_import_id
      AND r.match_status = 'unmatched'
      AND r.source_product_id = p.parent_sku;

    -- Auto-match names only when the same vintage and normalised name identify
    -- one catalogue parent. Ambiguity remains visible for manual resolution.
    WITH candidates AS (
        SELECT
            r.import_id,
            r.source_row_number,
            min(p.parent_sku) AS parent_sku,
            count(*) AS candidate_count
        FROM public.release_offer_source_rows r
        JOIN public.products p ON p.vintage = r.source_vintage
        WHERE r.import_id = p_import_id
          AND r.match_status = 'unmatched'
          AND private.release_wine_match_key(p.name, p.vintage) = r.source_match_key
        GROUP BY r.import_id, r.source_row_number
    )
    UPDATE public.release_offer_source_rows r
    SET
        parent_sku = c.parent_sku,
        match_status = 'matched',
        match_method = 'exact_name_vintage'
    FROM candidates c
    WHERE r.import_id = c.import_id
      AND r.source_row_number = c.source_row_number
      AND c.candidate_count = 1;

    UPDATE public.release_offer_source_rows r
    SET match_candidates = coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'parent_sku', candidate.parent_sku,
            'name', candidate.name,
            'vintage', candidate.vintage,
            'similarity', round(candidate.match_similarity::NUMERIC, 3)
        ) ORDER BY candidate.match_similarity DESC)
        FROM (
            SELECT
                p.parent_sku,
                p.name,
                p.vintage,
                public.similarity(
                    private.release_wine_match_key(p.name, p.vintage),
                    r.source_match_key
                ) AS match_similarity
            FROM public.products p
            WHERE r.source_vintage IS NULL
               OR p.vintage = r.source_vintage
            ORDER BY match_similarity DESC
            LIMIT 3
        ) candidate
    ), '[]'::JSONB)
    WHERE r.import_id = p_import_id
      AND r.match_status = 'unmatched';

    SELECT
        count(*) FILTER (WHERE match_status = 'matched')::INT,
        count(*) FILTER (WHERE match_status = 'unmatched')::INT,
        count(*) FILTER (
            WHERE jsonb_array_length(validation_warnings) > 0
        )::INT,
        count(*) FILTER (WHERE match_status = 'invalid')::INT
    INTO v_matched, v_unmatched, v_warning, v_errors
    FROM public.release_offer_source_rows
    WHERE import_id = p_import_id;

    UPDATE public.release_offer_imports
    SET
        status = CASE WHEN v_errors > 0 THEN 'failed' ELSE 'validated' END,
        source_row_count = v_rows,
        priced_fragment_count = v_prices,
        matched_row_count = v_matched,
        unmatched_row_count = v_unmatched,
        warning_row_count = v_warning,
        error_row_count = v_errors,
        failure_summary = CASE
            WHEN v_errors > 0 THEN format('%s source row(s) failed validation', v_errors)
        END
    WHERE id = p_import_id
    RETURNING * INTO v_import;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'status', v_import.status,
        'source_row_count', v_rows,
        'priced_fragment_count', v_prices,
        'matched_row_count', v_matched,
        'unmatched_row_count', v_unmatched,
        'warning_row_count', v_warning,
        'error_row_count', v_errors
    );
END;
$$;

REVOKE ALL ON FUNCTION public.finalise_release_offer_import(UUID, INT, INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalise_release_offer_import(UUID, INT, INT)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_release_offer_import(p_import_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_import public.release_offer_imports%ROWTYPE;
    v_published INT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_import
    FROM public.release_offer_imports
    WHERE id = p_import_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'import not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_import.status = 'accepted' THEN
        RETURN jsonb_build_object(
            'import_id', p_import_id,
            'status', 'accepted',
            'already_accepted', TRUE
        );
    END IF;
    IF v_import.status <> 'validated' OR v_import.error_row_count > 0 THEN
        RAISE EXCEPTION 'only a validated import can be accepted'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.release_offer_prices price
    SET
        publication_status = CASE
            WHEN row.match_status <> 'matched' THEN 'pending'
            WHEN price.parse_status <> 'valid' THEN 'pending'
            WHEN price.tax_basis <> 'in_bond' THEN 'pending'
            WHEN NOT EXISTS (
                SELECT 1
                FROM public.skus sku
                WHERE sku.parent_sku = row.parent_sku
                  AND sku.format_code = price.format_code
            ) THEN 'pending'
            ELSE 'published'
        END,
        rejection_reason = NULL
    FROM public.release_offer_source_rows row
    WHERE price.import_id = p_import_id
      AND row.import_id = price.import_id
      AND row.source_row_number = price.source_row_number;

    GET DIAGNOSTICS v_published = ROW_COUNT;

    UPDATE public.release_offer_imports
    SET status = 'accepted', accepted_at = now(), accepted_by = (SELECT auth.uid())
    WHERE id = p_import_id
    RETURNING * INTO v_import;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'status', 'accepted',
        'already_accepted', FALSE,
        'evaluated_price_count', v_published,
        'accepted_at', v_import.accepted_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_release_offer_import(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_release_offer_import(UUID)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_release_offer_row(
    p_import_id UUID,
    p_source_row_number INT,
    p_parent_sku TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE parent_sku = p_parent_sku) THEN
        RAISE EXCEPTION 'product not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT status INTO v_status
    FROM public.release_offer_imports
    WHERE id = p_import_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'import not found' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.release_offer_source_rows
    SET parent_sku = p_parent_sku, match_status = 'matched', match_method = 'manual'
    WHERE import_id = p_import_id
      AND source_row_number = p_source_row_number
      AND match_status <> 'invalid';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'source row not found or invalid' USING ERRCODE = 'P0002';
    END IF;

    IF v_status = 'accepted' THEN
        UPDATE public.release_offer_prices price
        SET publication_status = CASE
            WHEN price.parse_status = 'valid'
             AND price.tax_basis = 'in_bond'
             AND EXISTS (
                SELECT 1 FROM public.skus sku
                WHERE sku.parent_sku = p_parent_sku
                  AND sku.format_code = price.format_code
             ) THEN 'published'
            ELSE 'pending'
        END
        WHERE import_id = p_import_id
          AND source_row_number = p_source_row_number;
    END IF;

    UPDATE public.release_offer_imports i
    SET
        matched_row_count = counts.matched,
        unmatched_row_count = counts.unmatched
    FROM (
        SELECT
            count(*) FILTER (WHERE match_status = 'matched')::INT AS matched,
            count(*) FILTER (WHERE match_status = 'unmatched')::INT AS unmatched
        FROM public.release_offer_source_rows
        WHERE import_id = p_import_id
    ) counts
    WHERE i.id = p_import_id;

    RETURN jsonb_build_object(
        'import_id', p_import_id,
        'source_row_number', p_source_row_number,
        'parent_sku', p_parent_sku,
        'match_status', 'matched'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_release_offer_row(UUID, INT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_release_offer_row(UUID, INT, TEXT)
    TO authenticated;

CREATE VIEW public.release_offer_evidence_view
WITH (security_invoker = TRUE)
AS
WITH ranked AS (
    SELECT
        price.id AS release_offer_price_id,
        row.import_id,
        row.source_row_number,
        row.parent_sku,
        price.format_code,
        row.offer_date,
        row.source_wine,
        row.source_product_url,
        price.amount_p AS release_price_p,
        price.case_size,
        price.bottle_volume_ml,
        price.tax_basis,
        row.match_method,
        row.source_message_id,
        row.content_fingerprint,
        row_number() OVER (
            PARTITION BY row.parent_sku, price.format_code, row.offer_date, price.amount_p
            ORDER BY imports.accepted_at, row.import_id, row.source_row_number, price.fragment_index
        ) AS duplicate_rank
    FROM public.release_offer_prices price
    JOIN public.release_offer_source_rows row
      ON row.import_id = price.import_id
     AND row.source_row_number = price.source_row_number
    JOIN public.release_offer_imports imports ON imports.id = row.import_id
    WHERE imports.status = 'accepted'
      AND price.publication_status = 'published'
)
SELECT * FROM ranked WHERE duplicate_rank = 1;

CREATE VIEW public.release_price_anchor_view
WITH (security_invoker = TRUE)
AS
WITH provisional AS (
    SELECT DISTINCT ON (parent_sku, format_code)
        parent_sku,
        format_code,
        release_offer_price_id,
        offer_date,
        release_price_p,
        source_wine,
        source_product_url
    FROM public.release_offer_evidence_view
    ORDER BY parent_sku, format_code, offer_date, release_offer_price_id
), selected AS (
    SELECT
        p.parent_sku,
        p.format_code,
        coalesce(confirmed.release_offer_price_id, p.release_offer_price_id)
            AS release_offer_price_id,
        CASE WHEN override.release_offer_price_id IS NULL
            THEN 'provisional' ELSE 'confirmed' END AS anchor_status
    FROM provisional p
    LEFT JOIN public.release_price_anchor_overrides override
      ON override.parent_sku = p.parent_sku
     AND override.format_code = p.format_code
    LEFT JOIN public.release_offer_evidence_view confirmed
      ON confirmed.release_offer_price_id = override.release_offer_price_id
)
SELECT
    selected.parent_sku,
    selected.format_code,
    selected.anchor_status,
    evidence.release_offer_price_id,
    evidence.offer_date,
    evidence.release_price_p,
    evidence.source_wine,
    evidence.source_product_url
FROM selected
JOIN public.release_offer_evidence_view evidence
  ON evidence.release_offer_price_id = selected.release_offer_price_id;

CREATE VIEW public.release_price_market_view
WITH (security_invoker = TRUE)
AS
SELECT
    anchor.parent_sku,
    anchor.format_code,
    anchor.anchor_status,
    anchor.release_offer_price_id,
    anchor.offer_date,
    anchor.release_price_p,
    anchor.source_wine,
    anchor.source_product_url,
    catalogue.name,
    catalogue.vintage,
    catalogue.region,
    catalogue.colour,
    catalogue.producer,
    catalogue.product_url,
    catalogue.case_size,
    catalogue.bottle_volume_ml,
    catalogue.is_listed,
    catalogue.ask AS lowest_ask_p,
    catalogue.highest_bid_p,
    catalogue.market_price_p,
    catalogue.last_rest_checked_at,
    catalogue.ask - anchor.release_price_p AS ask_vs_release_p,
    round(
        100 * (catalogue.ask - anchor.release_price_p)::NUMERIC
        / NULLIF(anchor.release_price_p, 0),
        1
    ) AS ask_vs_release_pct,
    catalogue.highest_bid_p - anchor.release_price_p AS bid_vs_release_p,
    round(
        100 * (catalogue.highest_bid_p - anchor.release_price_p)::NUMERIC
        / NULLIF(anchor.release_price_p, 0),
        1
    ) AS bid_vs_release_pct,
    floor(catalogue.highest_bid_p * (1 - fee.seller_commission_rate))::INT
        AS seller_net_highest_bid_p,
    (ceil(anchor.release_price_p / ((1 - fee.seller_commission_rate) * 100)) * 100)::INT
        AS recoup_bid_p,
    fee.seller_commission_rate
FROM public.release_price_anchor_view anchor
LEFT JOIN public.catalogue_view catalogue
  ON catalogue.parent_sku = anchor.parent_sku
 AND catalogue.format_code = anchor.format_code
CROSS JOIN LATERAL (
    SELECT seller_commission_rate
    FROM public.bbx_fee_schedule
    WHERE effective_from <= current_date
    ORDER BY effective_from DESC
    LIMIT 1
) fee;

COMMENT ON VIEW public.release_price_market_view IS
    'Private release-price anchors compared with current exact-format BBX bid and ask values. Recoup bids use the effective seller commission and exclude storage.';

REVOKE ALL ON
    public.release_offer_evidence_view,
    public.release_price_anchor_view,
    public.release_price_market_view
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON
    public.release_offer_evidence_view,
    public.release_price_anchor_view,
    public.release_price_market_view
TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_release_price_anchor(
    p_release_offer_price_id BIGINT,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_evidence RECORD;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_evidence
    FROM public.release_offer_evidence_view
    WHERE release_offer_price_id = p_release_offer_price_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'published release evidence not found' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.release_price_anchor_overrides (
        parent_sku, format_code, release_offer_price_id, note, confirmed_by
    ) VALUES (
        v_evidence.parent_sku,
        v_evidence.format_code,
        p_release_offer_price_id,
        nullif(trim(p_note), ''),
        (SELECT auth.uid())
    )
    ON CONFLICT (parent_sku, format_code) DO UPDATE
    SET
        release_offer_price_id = EXCLUDED.release_offer_price_id,
        note = EXCLUDED.note,
        confirmed_by = EXCLUDED.confirmed_by,
        confirmed_at = now();

    RETURN jsonb_build_object(
        'parent_sku', v_evidence.parent_sku,
        'format_code', v_evidence.format_code,
        'release_offer_price_id', p_release_offer_price_id,
        'anchor_status', 'confirmed'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_release_price_anchor(BIGINT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_release_price_anchor(BIGINT, TEXT)
    TO authenticated;
