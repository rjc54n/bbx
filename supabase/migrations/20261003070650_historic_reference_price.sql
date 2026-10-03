-- Historic reference price, Slice 1.
--
-- One owner-facing historic benchmark per wine, in whole GBP pence per 75 cl
-- bottle. Evidence remains in its existing source tables. A decision stores a
-- value rather than a source-row pointer, so re-importing or removing a source
-- row cannot silently replace an owner assertion.

CREATE VIEW public.historic_reference_candidate_view
WITH (security_invoker = TRUE)
AS
SELECT
    observation.parent_sku,
    round(
        observation.purchase_price_per_case_p::NUMERIC
        / NULLIF(observation.case_size, 0)
    )::INT AS price_per_75cl_p,
    observation.purchase_price_per_case_p AS source_price_p,
    'bbr'::TEXT AS source_kind,
    observation.import_id::TEXT AS source_import_id,
    observation.source_row_number,
    observation.format_code AS source_format_code,
    observation.case_size AS source_case_size,
    observation.effective_date AS reference_date,
    'BBR snapshot observation date'::TEXT AS date_meaning,
    observation.description AS source_wine,
    NULL::BIGINT AS release_offer_price_id
FROM public.bbr_position_observations observation
WHERE observation.parent_sku IS NOT NULL
  AND observation.format_code ~ '^[0-9]+-00750$'
  AND observation.case_size > 0
  AND observation.purchase_price_per_case_p > 0

UNION ALL

SELECT
    offer.parent_sku,
    round(
        offer.release_price_p::NUMERIC
        / NULLIF(split_part(offer.format_code, '-', 1)::INT, 0)
    )::INT AS price_per_75cl_p,
    offer.release_price_p AS source_price_p,
    'offer'::TEXT AS source_kind,
    offer.import_id::TEXT AS source_import_id,
    offer.source_row_number,
    offer.format_code AS source_format_code,
    split_part(offer.format_code, '-', 1)::INT AS source_case_size,
    offer.offer_date AS reference_date,
    'Historic offer date'::TEXT AS date_meaning,
    offer.source_wine,
    offer.release_offer_price_id
FROM public.release_offer_evidence_view offer
WHERE offer.parent_sku IS NOT NULL
  AND offer.format_code ~ '^[0-9]+-00750$'
  AND offer.release_price_p > 0
  AND offer.offer_date IS NOT NULL

UNION ALL

SELECT
    record.parent_sku,
    record.purchase_price_per_bottle_p AS price_per_75cl_p,
    record.purchase_price_per_bottle_p AS source_price_p,
    'cellartracker'::TEXT AS source_kind,
    record.import_id::TEXT AS source_import_id,
    record.source_row_number,
    NULL::TEXT AS source_format_code,
    NULL::INT AS source_case_size,
    NULL::DATE AS reference_date,
    'No price date recorded'::TEXT AS date_meaning,
    record.source_wine,
    NULL::BIGINT AS release_offer_price_id
FROM public.current_cellartracker_records record
WHERE record.parent_sku IS NOT NULL
  AND record.link_status = 'linked'
  AND record.bottle_volume_ml = 750
  AND record.purchase_price_per_bottle_p > 0;

REVOKE ALL ON public.historic_reference_candidate_view
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.historic_reference_candidate_view TO authenticated;

CREATE TABLE public.reference_price_decisions (
    parent_sku TEXT PRIMARY KEY,
    price_per_75cl_p INT NOT NULL CHECK (price_per_75cl_p > 0),
    reference_date DATE,
    note TEXT CHECK (char_length(note) <= 1000),
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.reference_price_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reference_price_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reference_price_decisions TO authenticated;
CREATE POLICY "Owner reads reference price decisions"
    ON public.reference_price_decisions
    FOR SELECT TO authenticated
    USING ((SELECT private.is_app_owner()));

-- The existing entries are all distinct 6 x 75 cl references at the review
-- baseline. A duplicate parent means the former format-level model expressed
-- conflicting owner choices. Let the primary key fail in that case rather than
-- manufacture a wine-level decision.
INSERT INTO public.reference_price_decisions (
    parent_sku, price_per_75cl_p, reference_date, note, decided_at, decided_by
)
SELECT
    split_part(anchor.wine_ref, ':', 2),
    round(anchor.release_price_p::NUMERIC / split_part(anchor.format_code, '-', 1)::NUMERIC)::INT,
    anchor.offer_date,
    anchor.source_note,
    anchor.decided_at,
    anchor.decided_by
FROM public.owner_release_anchors anchor
WHERE anchor.wine_ref LIKE 'parent:%'
  AND anchor.format_code ~ '^[0-9]+-00750$';

CREATE FUNCTION public.set_reference_price(
    p_parent_sku TEXT,
    p_price_per_75cl_p INT,
    p_reference_date DATE DEFAULT NULL,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF p_parent_sku IS NULL OR btrim(p_parent_sku) = ''
       OR p_price_per_75cl_p IS NULL OR p_price_per_75cl_p <= 0 THEN
        RAISE EXCEPTION 'a parent SKU and positive per-75cl price are required'
            USING ERRCODE = '22023';
    END IF;
    IF p_note IS NOT NULL AND char_length(p_note) > 1000 THEN
        RAISE EXCEPTION 'reference note must be at most 1000 characters'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.reference_price_decisions AS decision (
        parent_sku, price_per_75cl_p, reference_date, note, decided_by
    ) VALUES (
        btrim(p_parent_sku), p_price_per_75cl_p, p_reference_date,
        nullif(btrim(p_note), ''), (SELECT auth.uid())
    )
    ON CONFLICT (parent_sku) DO UPDATE
    SET price_per_75cl_p = excluded.price_per_75cl_p,
        reference_date = excluded.reference_date,
        note = excluded.note,
        decided_at = now(),
        decided_by = excluded.decided_by;

    RETURN jsonb_build_object(
        'parent_sku', btrim(p_parent_sku),
        'price_per_75cl_p', p_price_per_75cl_p,
        'reference_date', p_reference_date
    );
END;
$$;

CREATE FUNCTION public.clear_reference_price(p_parent_sku TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count INT;
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;
    IF p_parent_sku IS NULL OR btrim(p_parent_sku) = '' THEN
        RAISE EXCEPTION 'a parent SKU is required' USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.reference_price_decisions
    WHERE parent_sku = btrim(p_parent_sku);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('cleared', v_count > 0);
END;
$$;

REVOKE ALL ON FUNCTION
    public.set_reference_price(TEXT, INT, DATE, TEXT),
    public.clear_reference_price(TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.set_reference_price(TEXT, INT, DATE, TEXT),
    public.clear_reference_price(TEXT)
    TO authenticated;

CREATE VIEW public.resolved_reference_price_view
WITH (security_invoker = TRUE)
AS
WITH candidates AS MATERIALIZED (
    SELECT * FROM public.historic_reference_candidate_view
), automatic_choice AS (
    SELECT DISTINCT ON (parent_sku)
        parent_sku, price_per_75cl_p, source_kind, source_import_id,
        source_row_number, source_format_code, source_case_size,
        reference_date, date_meaning, source_wine, release_offer_price_id
    FROM candidates
    ORDER BY parent_sku,
        CASE source_kind WHEN 'bbr' THEN 1 WHEN 'cellartracker' THEN 2 ELSE 3 END,
        reference_date NULLS LAST, price_per_75cl_p,
        CASE WHEN source_kind = 'offer' THEN release_offer_price_id END,
        source_import_id, source_row_number
), selected AS (
    SELECT
        decision.parent_sku,
        decision.price_per_75cl_p,
        'owner'::TEXT AS resolution_kind,
        'owner'::TEXT AS source_kind,
        NULL::TEXT AS source_import_id,
        NULL::INT AS source_row_number,
        NULL::TEXT AS source_format_code,
        NULL::INT AS source_case_size,
        decision.reference_date,
        'Owner-entered reference date'::TEXT AS date_meaning,
        decision.note AS source_wine,
        NULL::BIGINT AS release_offer_price_id,
        decision.decided_at
    FROM public.reference_price_decisions decision

    UNION ALL

    SELECT
        automatic.parent_sku,
        automatic.price_per_75cl_p,
        'automatic'::TEXT AS resolution_kind,
        automatic.source_kind,
        automatic.source_import_id,
        automatic.source_row_number,
        automatic.source_format_code,
        automatic.source_case_size,
        automatic.reference_date,
        automatic.date_meaning,
        automatic.source_wine,
        automatic.release_offer_price_id,
        NULL::TIMESTAMPTZ AS decided_at
    FROM automatic_choice automatic
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.reference_price_decisions decision
        WHERE decision.parent_sku = automatic.parent_sku
    )
), evidence_stats AS (
    SELECT
        parent_sku,
        min(price_per_75cl_p) AS evidence_min_p,
        max(price_per_75cl_p) AS evidence_max_p,
        count(*)::INT AS evidence_candidate_count,
        max(price_per_75cl_p) FILTER (WHERE source_kind = 'bbr')
            - min(price_per_75cl_p) FILTER (WHERE source_kind = 'bbr') AS bbr_range_p,
        min(price_per_75cl_p) FILTER (WHERE source_kind = 'cellartracker')
            AS cellartracker_min_p,
        max(price_per_75cl_p) FILTER (WHERE source_kind = 'cellartracker')
            AS cellartracker_max_p,
        (array_agg(price_per_75cl_p ORDER BY reference_date,
            price_per_75cl_p, source_import_id, source_row_number)
            FILTER (WHERE source_kind = 'bbr'))[1] AS bbr_choice_p
    FROM candidates
    GROUP BY parent_sku
), candidate_support AS (
    SELECT
        selected.parent_sku,
        bool_or(abs(candidate.price_per_75cl_p - selected.price_per_75cl_p) <= 1)
            AS has_current_support
    FROM selected
    JOIN candidates candidate ON candidate.parent_sku = selected.parent_sku
    GROUP BY selected.parent_sku
)
SELECT
    selected.parent_sku,
    selected.price_per_75cl_p,
    selected.resolution_kind,
    selected.source_kind,
    selected.source_import_id,
    selected.source_row_number,
    selected.source_format_code,
    selected.source_case_size,
    selected.reference_date,
    selected.date_meaning,
    selected.source_wine,
    selected.release_offer_price_id,
    selected.decided_at,
    stats.evidence_min_p,
    stats.evidence_max_p,
    coalesce(stats.evidence_candidate_count, 0) AS evidence_candidate_count,
    coalesce(stats.evidence_max_p - stats.evidence_min_p > 1, FALSE)
        AS has_competing_evidence,
    coalesce(stats.bbr_range_p > 1, FALSE)
        OR coalesce(
            stats.cellartracker_min_p < stats.bbr_choice_p - 1
            OR stats.cellartracker_max_p > stats.bbr_choice_p + 1,
            FALSE
        )
        AS needs_review,
    coalesce(support.has_current_support, FALSE) AS has_current_support
FROM selected
LEFT JOIN evidence_stats stats ON stats.parent_sku = selected.parent_sku
LEFT JOIN candidate_support support ON support.parent_sku = selected.parent_sku;

REVOKE ALL ON public.resolved_reference_price_view
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.resolved_reference_price_view TO authenticated;
