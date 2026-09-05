BEGIN;

SELECT plan(26);

INSERT INTO auth.users (id)
VALUES
    ('10000000-0000-0000-0000-000000000001'),
    ('10000000-0000-0000-0000-000000000002');

INSERT INTO public.app_owners (user_id)
VALUES ('10000000-0000-0000-0000-000000000001');

-- Validated BBR imports, each complete: one valid source row with one matching
-- ownership evidence row. 0001 is the exception -- it claims two valid rows and
-- carries evidence for one, which is the shape of an import staged before
-- evidence stopped depending on catalogue coverage. 0006 failed validation.

INSERT INTO public.cellar_imports (
    id, source_type, content_checksum, original_filename, byte_size,
    storage_object_path, uploaded_by, parser_version, status,
    source_row_count, parsed_row_count, matched_row_count,
    unmatched_row_count, error_row_count
)
SELECT
    v.id::UUID,
    'bbr_holdings',
    repeat(v.checksum_char, 64),
    format('my-cellar-view-fixture-%s.csv', v.checksum_char),
    1000,
    format('10000000-0000-0000-0000-000000000001/%s/source.csv', v.id),
    '10000000-0000-0000-0000-000000000001',
    'bbr-v2',
    v.status,
    v.parsed,
    v.parsed,
    0,
    v.parsed,
    v.errors
FROM (
    VALUES
        ('60000000-0000-0000-0000-000000000001', '1', 'validated', 2, 0),
        ('60000000-0000-0000-0000-000000000002', '2', 'validated', 1, 0),
        ('60000000-0000-0000-0000-000000000003', '3', 'validated', 1, 0),
        ('60000000-0000-0000-0000-000000000004', '4', 'validated', 1, 0),
        ('60000000-0000-0000-0000-000000000005', '5', 'validated', 1, 0),
        ('60000000-0000-0000-0000-000000000006', '6', 'failed', 1, 1)
) AS v(id, checksum_char, status, parsed, errors);

INSERT INTO public.cellar_import_rows (
    import_id, source_row_number, raw_row, match_status
)
SELECT i.id, 1, '{}'::JSONB, 'unmatched'
FROM public.cellar_imports AS i
WHERE i.source_type = 'bbr_holdings';

-- 0001's second source row, the one whose evidence was never written.
INSERT INTO public.cellar_import_rows (
    import_id, source_row_number, raw_row, match_status
)
VALUES ('60000000-0000-0000-0000-000000000001', 2, '{}'::JSONB, 'unmatched');

INSERT INTO public.bbr_holding_evidence (
    import_id, source_row_number, parent_sku, format_code, catalogue_matched,
    product_code, description, bottle_volume_ml, quantity_bottles,
    eligible_for_bbx, case_size
)
SELECT i.id, 1, '90000000001', '06-00750', FALSE,
       'fixture-1', 'Fixture wine', 750, 6, TRUE, 6
FROM public.cellar_imports AS i
WHERE i.source_type = 'bbr_holdings';

SELECT is(
    has_function_privilege(
        'anon', 'public.accept_bbr_snapshot(uuid,date,text)', 'EXECUTE'
    ),
    FALSE,
    'anonymous users cannot call the acceptance RPC'
);

SELECT is(
    has_function_privilege(
        'authenticated', 'public.accept_bbr_snapshot(uuid,date,text)', 'EXECUTE'
    ),
    TRUE,
    'authenticated users can call the owner-checked acceptance RPC'
);

SELECT is(
    has_function_privilege(
        'anon', 'public.set_bbr_import_effective_date(uuid,date)', 'EXECUTE'
    ),
    FALSE,
    'anonymous users cannot call the effective-date RPC'
);

SELECT is(
    has_function_privilege(
        'authenticated',
        'public.set_bbr_import_effective_date(uuid,date)',
        'EXECUTE'
    ),
    TRUE,
    'authenticated users can call the owner-checked effective-date RPC'
);

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;

SELECT is(
    (
        SELECT (public.set_bbr_import_effective_date(
            '60000000-0000-0000-0000-000000000002',
            DATE '2026-06-01'
        ))->>'effective_date'
    ),
    '2026-06-01',
    'the owner records a proposed effective date before acceptance'
);

-- Refusals that need no accepted snapshot to exist yet -----------------------

SELECT throws_ok(
    $$
    SELECT public.accept_bbr_snapshot(
        '60000000-0000-0000-0000-000000000002', DATE '2026-06-01', NULL
    )
    $$,
    '22023',
    'a role of current or historical must be stated',
    'acceptance has no default role'
);

SELECT throws_ok(
    $$
    SELECT public.accept_bbr_snapshot(
        '60000000-0000-0000-0000-000000000002', DATE '2026-06-01', 'nominated'
    )
    $$,
    '22023',
    'a role of current or historical must be stated',
    'an invented role is refused'
);

SELECT throws_ok(
    $$
    SELECT public.accept_bbr_snapshot(
        '60000000-0000-0000-0000-000000000002', NULL, 'current'
    )
    $$,
    '22023',
    'an effective date is required to accept a snapshot',
    'acceptance without an effective date is refused'
);

SELECT throws_ok(
    $$
    SELECT public.accept_bbr_snapshot(
        '60000000-0000-0000-0000-0000000000ff', DATE '2026-06-01', 'current'
    )
    $$,
    'P0002',
    'import not found',
    'an unknown import is refused'
);

SELECT throws_ok(
    $$
    SELECT public.accept_bbr_snapshot(
        '60000000-0000-0000-0000-000000000006', DATE '2026-06-01', 'current'
    )
    $$,
    '22023',
    'only a validated import without row errors can be accepted',
    'an import that failed validation is refused'
);

SELECT throws_ok(
    $$
    SELECT public.accept_bbr_snapshot(
        '60000000-0000-0000-0000-000000000001', DATE '2026-06-01', 'current'
    )
    $$,
    '22023',
    'this import holds ownership evidence for 1 of its 2 valid rows',
    'an import staged before evidence coverage changed cannot be accepted'
);

-- The first nomination -------------------------------------------------------

SELECT is(
    (
        SELECT (public.accept_bbr_snapshot(
            '60000000-0000-0000-0000-000000000002', DATE '2026-06-01', 'current'
        ))->>'accepted_role'
    ),
    'current',
    'the owner accepts a complete snapshot as the current declaration'
);

SELECT is(
    (
        SELECT count(*)::INT
        FROM public.cellar_imports
        WHERE source_type = 'bbr_holdings'
          AND status = 'accepted'
          AND accepted_role = 'current'
          AND superseded_at IS NULL
    ),
    1,
    'that snapshot becomes the sole nomination'
);

SELECT is(
    (
        SELECT (public.accept_bbr_snapshot(
            '60000000-0000-0000-0000-000000000002', DATE '2026-06-01', 'current'
        ))->>'already_accepted'
    ),
    'true',
    'repeating the same declaration is an idempotent retry'
);

SELECT throws_ok(
    $$
    SELECT public.accept_bbr_snapshot(
        '60000000-0000-0000-0000-000000000002', DATE '2026-06-02', 'current'
    )
    $$,
    '22023',
    'this import is already accepted as the current snapshot for 2026-06-01',
    'repeating it with a different date is a conflict, not a silent success'
);

-- Chronology rules against a nominated current snapshot ----------------------

SELECT is(
    (
        SELECT (public.accept_bbr_snapshot(
            '60000000-0000-0000-0000-000000000003', DATE '2026-05-01', 'historical'
        ))->>'accepted_role'
    ),
    'historical',
    'an earlier snapshot is accepted as dated evidence only'
);

SELECT throws_ok(
    $$
    SELECT public.accept_bbr_snapshot(
        '60000000-0000-0000-0000-000000000005', DATE '2026-07-01', 'historical'
    )
    $$,
    '22023',
    'a historical snapshot cannot post-date the nominated current snapshot of 2026-06-01',
    'a historical snapshot cannot claim to be newer than current holdings'
);

SELECT throws_ok(
    $$
    SELECT public.accept_bbr_snapshot(
        '60000000-0000-0000-0000-000000000005', DATE '2026-05-15', 'current'
    )
    $$,
    '22023',
    'a current snapshot cannot pre-date the accepted snapshot for 2026-06-01',
    'current holdings cannot be replaced by an older file'
);

SELECT throws_ok(
    $$
    SELECT public.accept_bbr_snapshot(
        '60000000-0000-0000-0000-000000000005', DATE '2026-06-01', 'current'
    )
    $$,
    '22023',
    'an accepted snapshot already describes 2026-06-01',
    'a second accepted snapshot cannot describe a day already spoken for'
);

-- Supersession ---------------------------------------------------------------

SELECT is(
    (
        SELECT (public.accept_bbr_snapshot(
            '60000000-0000-0000-0000-000000000004', DATE '2026-07-01', 'current'
        ))->>'superseded_import_id'
    ),
    '60000000-0000-0000-0000-000000000002',
    'a later current declaration reports the nomination it replaced'
);

SELECT ok(
    (
        SELECT superseded_at IS NOT NULL
            AND superseded_by = '60000000-0000-0000-0000-000000000004'
            AND accepted_role = 'current'
        FROM public.cellar_imports
        WHERE id = '60000000-0000-0000-0000-000000000002'
    ),
    'the replaced snapshot is superseded in the same transaction and keeps its role'
);

SELECT is(
    (
        SELECT id::TEXT
        FROM public.cellar_imports
        WHERE source_type = 'bbr_holdings'
          AND status = 'accepted'
          AND accepted_role = 'current'
          AND superseded_at IS NULL
    ),
    '60000000-0000-0000-0000-000000000004',
    'exactly one nomination survives, and it is the newer declaration'
);

SELECT is(
    (
        SELECT count(*)::INT
        FROM public.cellar_imports
        WHERE source_type = 'bbr_holdings'
          AND status = 'accepted'
    ),
    3,
    'the earlier declarations remain accepted rather than being rewritten'
);

SELECT throws_ok(
    $$
    SELECT public.set_bbr_import_effective_date(
        '60000000-0000-0000-0000-000000000002', DATE '2026-06-03'
    )
    $$,
    '22023',
    'this import is already accepted as the snapshot for 2026-06-01',
    'an accepted snapshot''s date is not editable through the staging RPC'
);

-- The owner boundary ---------------------------------------------------------

RESET ROLE;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
    $$
    SELECT public.accept_bbr_snapshot(
        '60000000-0000-0000-0000-000000000005', DATE '2026-08-01', 'current'
    )
    $$,
    '42501',
    'not authorised',
    'a non-owner cannot accept a snapshot'
);

SELECT throws_ok(
    $$
    SELECT public.set_bbr_import_effective_date(
        '60000000-0000-0000-0000-000000000005', DATE '2026-08-01'
    )
    $$,
    '42501',
    'not authorised',
    'a non-owner cannot set an effective date'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
