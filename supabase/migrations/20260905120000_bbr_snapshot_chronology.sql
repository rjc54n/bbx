-- BBR holdings history, slice 2: snapshot chronology and authority.
--
-- Plan: docs/BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md, slice 2 and
-- decisions D1 (current authority), D2 (effective date) and D6 (deployment
-- sequence).
--
-- public.cellar_imports is shared with cellartracker_inventory, so every rule
-- added here is source-scoped -- partial indexes and CHECK constraints that
-- only bind when source_type = 'bbr_holdings'. No table-wide NOT NULL.
--
-- The order below is load-bearing: columns, then the legacy backfill, then the
-- two consistency raises, and only then the constraints and indexes the
-- backfill has to satisfy. Adding the constraints first would fail on any
-- database that already holds an accepted BBR import, with no explanation.

-- 1. Columns. All nullable at the table level; the accepted-BBR rules arrive
--    as source-scoped constraints in step 4.

ALTER TABLE public.cellar_imports
    ADD COLUMN effective_date DATE,
    ADD COLUMN accepted_role  TEXT,
    ADD COLUMN superseded_at  TIMESTAMPTZ,
    ADD COLUMN superseded_by  UUID REFERENCES public.cellar_imports(id);

COMMENT ON COLUMN public.cellar_imports.effective_date IS
    'Owner-confirmed date the file described holdings. Date only (D2).';
COMMENT ON COLUMN public.cellar_imports.accepted_role IS
    'current or historical, fixed at acceptance and never edited (D1).';
COMMENT ON COLUMN public.cellar_imports.superseded_at IS
    'When a later current declaration replaced this one.';
COMMENT ON COLUMN public.cellar_imports.superseded_by IS
    'The import that replaced this one. Set with superseded_at or not at all.';

-- 2 and 3. Legacy backfill, correct for zero, one or many accepted imports,
--          and the inconsistencies that must fail here rather than later at
--          index creation.
--
-- A legacy import predates any confirmed date, so its effective date is
-- derived from the filename BBR writes as my-cellar-view-YYYY-MM-DD.csv. A
-- filename that yields no usable date is never guessed at: the migration stops
-- and names the import. On a clean database nothing matches and every
-- statement here is a no-op.

DO $$
DECLARE
    v_import  RECORD;
    v_derived DATE;
    v_offence TEXT;
BEGIN
    FOR v_import IN
        SELECT id, original_filename
        FROM public.cellar_imports
        WHERE source_type = 'bbr_holdings'
          AND status = 'accepted'
        ORDER BY accepted_at, id
    LOOP
        BEGIN
            v_derived := substring(
                v_import.original_filename FROM '\d{4}-\d{2}-\d{2}'
            )::DATE;
        EXCEPTION
            WHEN invalid_datetime_format OR datetime_field_overflow THEN
                v_derived := NULL;
        END;

        UPDATE public.cellar_imports
        SET effective_date = v_derived
        WHERE id = v_import.id;
    END LOOP;

    SELECT string_agg(id::TEXT, ', ' ORDER BY id)
    INTO v_offence
    FROM public.cellar_imports
    WHERE source_type = 'bbr_holdings'
      AND status = 'accepted'
      AND effective_date IS NULL;

    IF v_offence IS NOT NULL THEN
        RAISE EXCEPTION
            'no effective date can be derived from the filename of accepted BBR import(s) %',
            v_offence
        USING HINT =
            'Give each one a filename carrying its ISO date, or remove the import, then run this migration again.';
    END IF;

    SELECT string_agg(line, '; ' ORDER BY line)
    INTO v_offence
    FROM (
        SELECT format(
            '%s: %s',
            to_char(effective_date, 'YYYY-MM-DD'),
            string_agg(id::TEXT, ', ' ORDER BY id)
        ) AS line
        FROM public.cellar_imports
        WHERE source_type = 'bbr_holdings'
          AND status = 'accepted'
        GROUP BY effective_date
        HAVING count(*) > 1
    ) AS collisions;

    IF v_offence IS NOT NULL THEN
        RAISE EXCEPTION
            'accepted BBR imports derive the same effective date -- %',
            v_offence
        USING HINT =
            'One accepted snapshot per date (D2). Resolve the duplicates, then run this migration again.';
    END IF;
END;
$$;

-- Chain the accepted imports in effective-date order. The last is the
-- nomination; every earlier one keeps accepted_role = 'current' -- it was once
-- accepted as current -- and is marked superseded by its immediate successor.
-- superseded_at takes the successor's accepted_at, which under the previous
-- accepted_at-ordered current_bbr_holdings view is the moment the earlier
-- snapshot actually stopped being the operative one.

WITH ordered AS (
    SELECT
        id,
        lead(id) OVER chronology AS next_id,
        lead(accepted_at) OVER chronology AS next_accepted_at
    FROM public.cellar_imports
    WHERE source_type = 'bbr_holdings'
      AND status = 'accepted'
    WINDOW chronology AS (ORDER BY effective_date, accepted_at, id)
)
UPDATE public.cellar_imports AS i
SET
    accepted_role = 'current',
    superseded_at = o.next_accepted_at,
    superseded_by = o.next_id
FROM ordered AS o
WHERE i.id = o.id;

-- 4. Constraints, once the existing rows satisfy them.

ALTER TABLE public.cellar_imports
    ADD CONSTRAINT cellar_imports_accepted_role_check CHECK (
        accepted_role IS NULL
        OR accepted_role IN ('current', 'historical')
    ),
    ADD CONSTRAINT cellar_imports_accepted_bbr_dated_check CHECK (
        source_type <> 'bbr_holdings'
        OR status <> 'accepted'
        OR (effective_date IS NOT NULL AND accepted_role IS NOT NULL)
    ),
    -- IS NOT DISTINCT FROM, because a plain = would evaluate to NULL against a
    -- null role and let a superseded row with no role at all through.
    ADD CONSTRAINT cellar_imports_superseded_was_current_check CHECK (
        superseded_at IS NULL
        OR accepted_role IS NOT DISTINCT FROM 'current'
    ),
    ADD CONSTRAINT cellar_imports_supersession_paired_check CHECK (
        (superseded_at IS NULL) = (superseded_by IS NULL)
    );

-- 5. Indexes. The nominated current snapshot is
--    accepted_role = 'current' AND superseded_at IS NULL, and there is at most
--    one of it (D1). One accepted snapshot per effective date (D2).

CREATE UNIQUE INDEX cellar_imports_one_nominated_current_idx
    ON public.cellar_imports (source_type)
    WHERE source_type = 'bbr_holdings'
      AND status = 'accepted'
      AND accepted_role = 'current'
      AND superseded_at IS NULL;

CREATE UNIQUE INDEX cellar_imports_bbr_effective_date_idx
    ON public.cellar_imports (source_type, effective_date)
    WHERE source_type = 'bbr_holdings'
      AND status = 'accepted';

CREATE INDEX idx_cellar_imports_source_effective_date
    ON public.cellar_imports (source_type, effective_date DESC)
    WHERE status = 'accepted';

-- 6. Withdraw the undated acceptance path (D6). It supplies neither an
--    effective date nor a role, which is exactly the "an old recovered file
--    replaces current holdings by accident" hazard the spec forbids a default
--    for. Slice 4 introduces accept_bbr_snapshot in its place; the Accept
--    control is already disabled in the app.

CREATE OR REPLACE FUNCTION public.accept_bbr_import(p_import_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION
        'accept_bbr_import is withdrawn: a BBR snapshot is now accepted with an explicit effective date and role'
        USING
            ERRCODE = '0A000',
            HINT = 'Acceptance is paused for this release. It returns with a confirmed effective date and a stated role.';
END;
$$;

REVOKE ALL ON FUNCTION public.accept_bbr_import(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_bbr_import(UUID) TO authenticated;
