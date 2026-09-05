-- BBR holdings history: serialise every snapshot acceptance, whatever its role.
--
-- Plan: docs/BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md, slice 4. Forward fix
-- to 20260905140000_bbr_snapshot_acceptance.sql, which is deployed and is not
-- edited.
--
-- The defect. accept_bbr_snapshot serialised itself by locking the nominated
-- current row, and a lock on a row is no lock at all when the row does not
-- exist or is not the row the other transaction will act on:
--
--   * With no nomination yet, FOR UPDATE finds nothing and locks nothing, so a
--     current and a historical acceptance can run right through each other. The
--     historical one reads "no nomination", skips its post-dating check, and
--     commits a snapshot dated after the current snapshot the other transaction
--     is committing.
--   * With a nomination, the second transaction blocks on the row but has
--     already read the chronology around it -- the latest accepted date and the
--     occupied effective dates -- before waiting. It then acts on the state it
--     saw before the wait, not the state it wakes up to.
--
-- Both leave the same wreckage: a historical snapshot dated after the nominated
-- current one, which every derived projection reads as ownership history running
-- backwards.
--
-- The fix. One transaction-scoped advisory lock, taken by both roles, before any
-- chronology is read. Acceptance is an owner action a few times a year, so full
-- serialisation costs nothing worth measuring, and it makes the invariant a
-- property of the function rather than of which rows happen to exist. Every
-- chronology read then happens under the lock, so what the function validates is
-- what it commits against.
--
-- Nothing else changes: the validations, the conditional idempotency, the
-- evidence-completeness invariant, the supersession behaviour, the error
-- messages and hints, and the privileges are all as deployed.

CREATE OR REPLACE FUNCTION public.accept_bbr_snapshot(
    p_import_id UUID,
    p_effective_date DATE,
    p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    -- A fixed key, shared by both roles and by nothing else in this database:
    -- 'bbr_snapshot_acceptance' hashed once, at authoring time, so the value is
    -- stable for the life of the schema rather than dependent on hashtext's
    -- behaviour in whichever server version is running.
    --   SELECT hashtext('bbr_snapshot_acceptance');  -->  2078936990
    c_acceptance_lock CONSTANT BIGINT := 2078936990;

    v_import public.cellar_imports%ROWTYPE;
    v_nominated public.cellar_imports%ROWTYPE;
    v_evidence_rows INT;
    v_latest_accepted DATE;
    v_superseded UUID;
    v_now TIMESTAMPTZ := now();
BEGIN
    IF NOT private.is_app_owner() THEN
        RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
    END IF;

    IF p_role IS NULL OR p_role NOT IN ('current', 'historical') THEN
        RAISE EXCEPTION 'a role of current or historical must be stated'
            USING ERRCODE = '22023',
                  HINT = 'There is deliberately no default, so that an old recovered file cannot replace current holdings by accident.';
    END IF;

    IF p_effective_date IS NULL THEN
        RAISE EXCEPTION 'an effective date is required to accept a snapshot'
            USING ERRCODE = '22023';
    END IF;

    -- The whole chronology, under one lock, before it is read. Argument
    -- validation above touches no accepted snapshot, so nothing that decides
    -- the outcome has been read yet. Taking the advisory lock ahead of any row
    -- lock also fixes the acquisition order for every acceptance, so two of
    -- them queue rather than deadlock.
    PERFORM pg_catalog.pg_advisory_xact_lock(c_acceptance_lock);

    SELECT *
    INTO v_import
    FROM public.cellar_imports
    WHERE id = p_import_id
      AND source_type = 'bbr_holdings'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'import not found' USING ERRCODE = 'P0002';
    END IF;

    -- Conditional idempotency: a repeated call with the same declaration is
    -- the retry of an interrupted request and succeeds. A repeat with
    -- different values is a different intention, and silently reporting
    -- success would misrepresent the chronology. Read under the lock, so a
    -- caller that queued behind the transaction which accepted this very
    -- import sees the accepted row rather than the staged one.
    IF v_import.status = 'accepted' THEN
        IF v_import.effective_date = p_effective_date
           AND v_import.accepted_role = p_role THEN
            RETURN jsonb_build_object(
                'import_id', v_import.id,
                'status', v_import.status,
                'effective_date', v_import.effective_date,
                'accepted_role', v_import.accepted_role,
                'superseded_import_id', v_import.superseded_by,
                'already_accepted', TRUE
            );
        END IF;

        RAISE EXCEPTION
            'this import is already accepted as the % snapshot for %',
            v_import.accepted_role,
            to_char(v_import.effective_date, 'YYYY-MM-DD')
        USING ERRCODE = '22023',
              HINT = 'Acceptance is recorded once. Amend the stored declaration rather than accepting it again with different values.';
    END IF;

    IF v_import.status <> 'validated' OR v_import.error_row_count > 0 THEN
        RAISE EXCEPTION 'only a validated import without row errors can be accepted'
            USING ERRCODE = '22023';
    END IF;

    -- Evidence completeness (D6). One invariant closing three holes: an import
    -- staged before evidence stopped depending on catalogue coverage, a
    -- partially staged import, and any future divergence between the staging
    -- and acceptance paths. It fails closed rather than quietly accepting a
    -- snapshot that is missing positions, which no later slice could detect.
    SELECT count(*)::INT
    INTO v_evidence_rows
    FROM public.bbr_holding_evidence
    WHERE import_id = p_import_id;

    IF v_evidence_rows <> v_import.parsed_row_count THEN
        RAISE EXCEPTION
            'this import holds ownership evidence for % of its % valid rows',
            v_evidence_rows,
            v_import.parsed_row_count
        USING ERRCODE = '22023',
              HINT = 'It was staged before ownership evidence stopped depending on catalogue coverage. Upload the file again, which stages it completely.';
    END IF;

    -- D2: one accepted snapshot per effective date. The partial unique index
    -- enforces this; checking it here is what turns a duplicate key error into
    -- an explanation.
    IF EXISTS (
        SELECT 1
        FROM public.cellar_imports
        WHERE source_type = 'bbr_holdings'
          AND status = 'accepted'
          AND effective_date = p_effective_date
    ) THEN
        RAISE EXCEPTION
            'an accepted snapshot already describes %',
            to_char(p_effective_date, 'YYYY-MM-DD')
        USING ERRCODE = '22023',
              HINT = 'One accepted snapshot per date. Correct the date, or amend the snapshot that already holds it.';
    END IF;

    -- The nomination, re-read under the lock. FOR UPDATE stays: the advisory
    -- lock is what serialises acceptances, and the row lock still guards the
    -- supersession write against anything outside this function.
    SELECT *
    INTO v_nominated
    FROM public.cellar_imports
    WHERE source_type = 'bbr_holdings'
      AND status = 'accepted'
      AND accepted_role = 'current'
      AND superseded_at IS NULL
    FOR UPDATE;

    IF p_role = 'current' THEN
        SELECT max(effective_date)
        INTO v_latest_accepted
        FROM public.cellar_imports
        WHERE source_type = 'bbr_holdings'
          AND status = 'accepted';

        IF v_latest_accepted IS NOT NULL
           AND p_effective_date < v_latest_accepted THEN
            RAISE EXCEPTION
                'a current snapshot cannot pre-date the accepted snapshot for %',
                to_char(v_latest_accepted, 'YYYY-MM-DD')
            USING ERRCODE = '22023',
                  HINT = 'Correct the date, accept this file as historical, or supply a later current declaration.';
        END IF;

        IF v_nominated.id IS NOT NULL THEN
            UPDATE public.cellar_imports
            SET
                superseded_at = v_now,
                superseded_by = p_import_id
            WHERE id = v_nominated.id;

            v_superseded := v_nominated.id;
        END IF;
    ELSE
        IF v_nominated.id IS NOT NULL
           AND p_effective_date > v_nominated.effective_date THEN
            RAISE EXCEPTION
                'a historical snapshot cannot post-date the nominated current snapshot of %',
                to_char(v_nominated.effective_date, 'YYYY-MM-DD')
            USING ERRCODE = '22023',
                  HINT = 'Correct its date, nominate it as current, or first accept a later current declaration.';
        END IF;
    END IF;

    UPDATE public.cellar_imports
    SET
        status = 'accepted',
        accepted_at = v_now,
        accepted_by = (SELECT auth.uid()),
        effective_date = p_effective_date,
        accepted_role = p_role
    WHERE id = p_import_id
    RETURNING * INTO v_import;

    RETURN jsonb_build_object(
        'import_id', v_import.id,
        'status', v_import.status,
        'effective_date', v_import.effective_date,
        'accepted_role', v_import.accepted_role,
        'superseded_import_id', v_superseded,
        'already_accepted', FALSE
    );
END;
$$;

-- CREATE OR REPLACE keeps the existing privileges, so these restate rather than
-- change them. They are repeated because a future replacement of this function
-- that is not a replacement -- a DROP and CREATE -- would otherwise silently
-- restore the default PUBLIC execute privilege.

REVOKE ALL ON FUNCTION public.accept_bbr_snapshot(UUID, DATE, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_bbr_snapshot(UUID, DATE, TEXT)
    TO authenticated;
