BEGIN;

SELECT plan(16);

INSERT INTO auth.users (id)
VALUES
    ('10000000-0000-0000-0000-000000000001'),
    ('10000000-0000-0000-0000-000000000002');

INSERT INTO public.app_owners (user_id)
VALUES ('10000000-0000-0000-0000-000000000001');

-- Three complete, validated snapshots, each holding one position with a
-- distinguishable Parent ID so it is always clear which snapshot the current
-- view is answering from. They are accepted below through the real RPC, so the
-- supersession chain is built the way production would build it.

INSERT INTO public.cellar_imports (
    id, source_type, content_checksum, original_filename, byte_size,
    storage_object_path, uploaded_by, parser_version, status,
    source_row_count, parsed_row_count, matched_row_count,
    unmatched_row_count, error_row_count
)
SELECT
    v.id::UUID, 'bbr_holdings', repeat(v.c, 64),
    format('my-cellar-view-%s.csv', v.d), 1000,
    format('10000000-0000-0000-0000-000000000001/%s/source.csv', v.id),
    '10000000-0000-0000-0000-000000000001', 'bbr-v2', 'validated',
    1, 1, 0, 1, 0
FROM (
    VALUES
        ('80000000-0000-0000-0000-000000000001', 'a', '2026-05-01'),
        ('80000000-0000-0000-0000-000000000002', 'b', '2026-06-01'),
        ('80000000-0000-0000-0000-000000000003', 'c', '2026-07-01')
) AS v(id, c, d);

INSERT INTO public.cellar_import_rows (
    import_id, source_row_number, raw_row, match_status
)
SELECT id, 1, '{}'::JSONB, 'unmatched'
FROM public.cellar_imports
WHERE source_type = 'bbr_holdings';

INSERT INTO public.bbr_holding_evidence (
    import_id, source_row_number, parent_sku, format_code, catalogue_matched,
    product_code, description, bottle_volume_ml, quantity_bottles,
    eligible_for_bbx, case_size
)
SELECT
    v.id::UUID, 1, v.sku, '06-00750', FALSE,
    'fixture', 'Fixture wine', 750, 6, TRUE, 6
FROM (
    VALUES
        ('80000000-0000-0000-0000-000000000001', '90000000001'),
        ('80000000-0000-0000-0000-000000000002', '90000000002'),
        ('80000000-0000-0000-0000-000000000003', '90000000003')
) AS v(id, sku);

SELECT is(
    has_table_privilege('anon', 'public.bbr_snapshot_view', 'SELECT'),
    FALSE,
    'anonymous users have no snapshot calendar privilege'
);

SELECT is(
    has_table_privilege('authenticated', 'public.bbr_snapshot_view', 'SELECT'),
    TRUE,
    'authenticated users have the select grant required for owner RLS'
);

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;

-- A database with dated evidence but no nomination ---------------------------

SELECT is(
    (
        SELECT (public.accept_bbr_snapshot(
            '80000000-0000-0000-0000-000000000001', DATE '2026-05-01', 'historical'
        ))->>'accepted_role'
    ),
    'historical',
    'a historical snapshot is accepted into an empty chronology'
);

SELECT is(
    (SELECT count(*)::INT FROM public.current_bbr_holdings),
    0,
    'with nothing nominated, current holdings are empty rather than guessed at'
);

SELECT is(
    (
        SELECT snapshot_state
        FROM public.bbr_snapshot_view
        WHERE import_id = '80000000-0000-0000-0000-000000000001'
    ),
    'historical',
    'the calendar records it as dated evidence, not as current'
);

-- The first nomination -------------------------------------------------------

SELECT is(
    (
        SELECT (public.accept_bbr_snapshot(
            '80000000-0000-0000-0000-000000000002', DATE '2026-06-01', 'current'
        ))->>'accepted_role'
    ),
    'current',
    'a later snapshot is nominated as current'
);

SELECT is(
    (SELECT count(*)::INT FROM public.current_bbr_holdings),
    1,
    'current holdings come from one snapshot, not from every accepted one'
);

SELECT is(
    (SELECT parent_sku FROM public.current_bbr_holdings),
    '90000000002',
    'they are the nominated snapshot''s positions, not the historical one''s'
);

SELECT is(
    (SELECT effective_date FROM public.current_bbr_holdings),
    DATE '2026-06-01',
    'the view carries the day the nominated file describes'
);

SELECT ok(
    (
        SELECT h.confirmed_at = i.accepted_at
        FROM public.current_bbr_holdings AS h
        JOIN public.cellar_imports AS i ON i.id = h.import_id
    ),
    'confirmed_at still means when the owner accepted it'
);

-- Supersession ---------------------------------------------------------------

SELECT is(
    (
        SELECT (public.accept_bbr_snapshot(
            '80000000-0000-0000-0000-000000000003', DATE '2026-07-01', 'current'
        ))->>'superseded_import_id'
    ),
    '80000000-0000-0000-0000-000000000002',
    'a newer current declaration replaces the nomination'
);

SELECT is(
    (SELECT parent_sku FROM public.current_bbr_holdings),
    '90000000003',
    'current authority follows the nomination rather than acceptance order'
);

SELECT is(
    (
        SELECT snapshot_state
        FROM public.bbr_snapshot_view
        WHERE import_id = '80000000-0000-0000-0000-000000000002'
    ),
    'superseded_current',
    'the replaced declaration is recorded as having once been current'
);

SELECT is(
    (
        SELECT string_agg(
            to_char(effective_date, 'YYYY-MM-DD') || ':' || snapshot_state,
            ' '
            ORDER BY effective_date
        )
        FROM public.bbr_snapshot_view
    ),
    '2026-05-01:historical 2026-06-01:superseded_current 2026-07-01:nominated_current',
    'the calendar carries every accepted snapshot in effective-date order'
);

-- The owner boundary ---------------------------------------------------------

RESET ROLE;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;

SELECT is(
    (SELECT count(*)::INT FROM public.bbr_snapshot_view),
    0,
    'RLS hides the snapshot calendar from a non-owner'
);

SELECT is(
    (SELECT count(*)::INT FROM public.current_bbr_holdings),
    0,
    'RLS still hides current holdings from a non-owner'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
