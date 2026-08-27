BEGIN;

SELECT plan(26);

INSERT INTO auth.users (id)
VALUES
    ('10000000-0000-0000-0000-000000000001'),
    ('10000000-0000-0000-0000-000000000002');

INSERT INTO public.app_owners (user_id)
VALUES ('10000000-0000-0000-0000-000000000001');

INSERT INTO private.scan_runs (
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

INSERT INTO private.products (
    parent_sku,
    name,
    vintage,
    region,
    colour,
    producer,
    product_url,
    first_seen_run_id,
    first_seen_at,
    last_seen_run_id,
    last_seen_at,
    last_rest_checked_at
)
VALUES (
    '20000000001',
    'Test wine',
    2019,
    'Bordeaux',
    'Red',
    'Test producer',
    '/products/test-wine',
    '20000000-0000-0000-0000-000000000001',
    now(),
    '20000000-0000-0000-0000-000000000001',
    now(),
    '2026-07-25 12:00:00+00'
);

INSERT INTO private.skus (
    parent_sku,
    format_code,
    case_size,
    bottle_volume_ml,
    least_listing_price_p,
    market_price_p,
    highest_bid_p,
    is_listed,
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
    42000,
    40000,
    31000,
    TRUE,
    '20000000-0000-0000-0000-000000000001',
    now(),
    '20000000-0000-0000-0000-000000000001',
    now()
);

-- catalogue_view now reads a cache (20260827120000), so the fixture rows above
-- are not visible to it -- or to anything downstream -- until it is rebuilt.
SELECT private.rebuild_catalogue_caches();

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
    has_table_privilege('anon', 'public.bbr_cellar_market_view', 'SELECT'),
    FALSE,
    'anonymous users have no cellar market view privilege'
);

SELECT is(
    has_table_privilege(
        'authenticated',
        'public.bbr_cellar_market_view',
        'SELECT'
    ),
    TRUE,
    'authenticated users have the select grant required for owner RLS'
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
                "bbx_lowest_price_p": 10000,
                "bbx_highest_bid_p": 9000,
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

SELECT is(
    (SELECT count(*)::INT FROM public.bbr_cellar_market_view),
    1,
    'the owner can read the current cellar market view'
);

SELECT is(
    (
        SELECT highest_bid_p
        FROM public.bbr_cellar_market_view
    ),
    31000,
    'the cellar view uses the current scanner bid instead of the imported bid'
);

SELECT is(
    (
        SELECT lowest_ask_p
        FROM public.bbr_cellar_market_view
    ),
    42000,
    'the cellar view uses the current scanner ask instead of the imported ask'
);

RESET ROLE;
UPDATE private.skus
SET highest_bid_p = 33000
WHERE parent_sku = '20000000001'
  AND format_code = '06-00750';
-- In production the sweep writes private.skus and refreshes the caches in the
-- same run, so the cellar view still tracks the scanner without a new cellar
-- import -- which is what this asserts. The test has to do both halves too.
SELECT private.rebuild_catalogue_caches();
SET LOCAL ROLE authenticated;

SELECT is(
    (
        SELECT highest_bid_p
        FROM public.bbr_cellar_market_view
    ),
    33000,
    'scanner price changes appear without another cellar import'
);

RESET ROLE;
UPDATE private.skus
SET gone_since = now()
WHERE parent_sku = '20000000001'
  AND format_code = '06-00750';
SELECT private.rebuild_catalogue_caches();
SET LOCAL ROLE authenticated;

SELECT is(
    (
        SELECT count(*)::INT
        FROM public.bbr_cellar_market_view
        WHERE parent_sku = '20000000001'
          AND lowest_ask_p IS NULL
          AND highest_bid_p IS NULL
    ),
    1,
    'a holding remains visible when its active catalogue row is absent'
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

SELECT is(
    (SELECT count(*)::INT FROM public.bbr_cellar_market_view),
    0,
    'RLS also hides the cellar market view from a non-owner'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
