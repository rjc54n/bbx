BEGIN;

SELECT plan(18);

INSERT INTO auth.users (id)
VALUES
    ('10000000-0000-0000-0000-000000000001'),
    ('10000000-0000-0000-0000-000000000002');

INSERT INTO public.app_owners (user_id)
VALUES ('10000000-0000-0000-0000-000000000001');

INSERT INTO public.scan_runs (
    id,
    scope,
    run_date,
    status,
    started_at
)
VALUES (
    '20000000-0000-0000-0000-000000000001',
    'test',
    DATE '2026-07-25',
    'completed',
    now()
);

INSERT INTO public.products (
    parent_sku,
    name,
    first_seen_run_id,
    first_seen_at,
    last_seen_run_id,
    last_seen_at
)
VALUES (
    '20000000001',
    'Test wine',
    '20000000-0000-0000-0000-000000000001',
    now(),
    '20000000-0000-0000-0000-000000000001',
    now()
);

INSERT INTO public.skus (
    parent_sku,
    format_code,
    case_size,
    bottle_volume_ml,
    first_seen_run_id,
    first_seen_at,
    last_seen_run_id,
    last_seen_at
)
VALUES (
    '20000000001',
    '06-00750',
    6,
    750,
    '20000000-0000-0000-0000-000000000001',
    now(),
    '20000000-0000-0000-0000-000000000001',
    now()
);

SELECT is(
    has_table_privilege('anon', 'public.cellar_imports', 'SELECT'),
    FALSE,
    'anonymous users have no cellar import table privilege'
);

SELECT is(
    has_table_privilege('authenticated', 'public.cellar_imports', 'SELECT'),
    TRUE,
    'authenticated users have the select grant required for RLS'
);

SELECT is(
    has_function_privilege(
        'anon',
        'public.stage_bbr_import(uuid,text,text,bigint,text,text,jsonb)',
        'EXECUTE'
    ),
    FALSE,
    'anonymous users cannot call the staging RPC'
);

SELECT is(
    has_function_privilege(
        'authenticated',
        'public.stage_bbr_import(uuid,text,text,bigint,text,text,jsonb)',
        'EXECUTE'
    ),
    TRUE,
    'authenticated users can call the owner-checked staging RPC'
);

SELECT is(
    (
        SELECT count(*)::INT
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname LIKE 'Owner can % cellar import objects'
    ),
    4,
    'the private import bucket has owner policies for all four operations'
);

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;

SELECT ok(
    (SELECT private.is_app_owner()),
    'the allowlisted identity passes the owner check'
);

SELECT is(
    (
        public.stage_bbr_import(
            '30000000-0000-0000-0000-000000000001',
            repeat('a', 64),
            'bbr-test.csv',
            1000,
            '10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/source.csv',
            'bbr-v1',
            '[
              {
                "source_row_number": 2,
                "raw_row": {"Parent ID": "20000000001"},
                "match_status": "matched",
                "validation_errors": [],
                "validation_warnings": [],
                "parent_sku": "20000000001",
                "format_code": "06-00750",
                "product_code": "test-1",
                "description": "Test wine",
                "bottle_volume_ml": 750,
                "quantity_bottles": 6,
                "eligible_for_bbx": true,
                "case_size": 6
              },
              {
                "source_row_number": 3,
                "raw_row": {"Parent ID": "20000000002"},
                "match_status": "unmatched",
                "validation_errors": [],
                "validation_warnings": ["Parent ID is not in the catalogue."],
                "parent_sku": "20000000002",
                "format_code": "06-00750",
                "product_code": "test-2",
                "description": "Unmatched wine",
                "bottle_volume_ml": 750,
                "quantity_bottles": 6,
                "eligible_for_bbx": true,
                "case_size": 6
              }
            ]'::JSONB
        )->>'status'
    ),
    'validated',
    'the owner can atomically stage a valid BBR import'
);

SELECT is(
    (
        SELECT source_row_count
        FROM public.cellar_imports
        WHERE id = '30000000-0000-0000-0000-000000000001'
    ),
    2,
    'the import records its source row count'
);

SELECT is(
    (
        SELECT matched_row_count
        FROM public.cellar_imports
        WHERE id = '30000000-0000-0000-0000-000000000001'
    ),
    1,
    'the import records its matched row count'
);

SELECT is(
    (
        SELECT unmatched_row_count
        FROM public.cellar_imports
        WHERE id = '30000000-0000-0000-0000-000000000001'
    ),
    1,
    'the import records its unmatched row count'
);

SELECT is(
    (
        SELECT count(*)::INT
        FROM public.bbr_holding_evidence
        WHERE import_id = '30000000-0000-0000-0000-000000000001'
    ),
    1,
    'only exact catalogue matches become normalised holding evidence'
);

SELECT ok(
    (
        SELECT parent_sku IS NULL
        FROM public.cellar_import_rows
        WHERE import_id = '30000000-0000-0000-0000-000000000001'
          AND source_row_number = 3
    ),
    'an unmatched candidate does not violate the catalogue foreign key'
);

SELECT is(
    (
        SELECT raw_row->>'Parent ID'
        FROM public.cellar_import_rows
        WHERE import_id = '30000000-0000-0000-0000-000000000001'
          AND source_row_number = 3
    ),
    '20000000002',
    'an unmatched candidate keeps its raw source identity'
);

SELECT is(
    (
        public.accept_bbr_import(
            '30000000-0000-0000-0000-000000000001'
        )->>'status'
    ),
    'accepted',
    'the owner can accept the validated snapshot'
);

SELECT is(
    (SELECT count(*)::INT FROM public.current_bbr_holdings),
    1,
    'the accepted snapshot supplies the current BBR holdings view'
);

RESET ROLE;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;

SELECT is(
    (SELECT private.is_app_owner()),
    FALSE,
    'a different authenticated identity fails the owner check'
);

SELECT is(
    (SELECT count(*)::INT FROM public.cellar_imports),
    0,
    'RLS hides import evidence from a non-owner'
);

SELECT is(
    (SELECT count(*)::INT FROM public.current_bbr_holdings),
    0,
    'RLS also hides the personal current-holdings view from a non-owner'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
