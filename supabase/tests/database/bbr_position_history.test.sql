-- BBR holdings history, slice 7: the three history projections.
--
-- The fixture is four synthetic snapshots, accepted through the real RPC in an
-- order that deliberately contradicts both their effective dates and their
-- upload order: 03-01 and 01-01 first, then the 04-01 nomination, then 02-01
-- historical after it. Every expectation below is computed from effective
-- dates alone, so a projection that reads acceptance or upload order instead
-- fails here rather than in production.
--
-- Account Payer and Beneficial Owner appear in no fixture and no view
-- (spec section 10). Nothing in this file constructs a raw_row beyond '{}'.

BEGIN;

SELECT plan(47);

INSERT INTO auth.users (id)
VALUES
    ('10000000-0000-0000-0000-000000000001'),
    ('10000000-0000-0000-0000-000000000002');

INSERT INTO public.app_owners (user_id)
VALUES ('10000000-0000-0000-0000-000000000001');

-- One catalogued product at one format. Parent ID 20000000001 is decorated at
-- 06-00750 and not at 12-00750, and 900000000xx is not in the catalogue at
-- all, so the left joins are exercised at both grains.

INSERT INTO private.scan_runs (id, scope, run_date, status, started_at)
VALUES (
    '20000000-0000-0000-0000-000000000001', 'test', DATE '2026-09-05',
    'completed', now()
);

INSERT INTO private.products (
    parent_sku, name, vintage, region, colour, producer, product_url,
    first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at,
    last_rest_checked_at
)
VALUES (
    '20000000001', 'Test wine', 2019, 'Bordeaux', 'Red', 'Test producer',
    '/products/test-wine',
    '20000000-0000-0000-0000-000000000001', now(),
    '20000000-0000-0000-0000-000000000001', now(),
    '2026-09-05 12:00:00+00'
);

INSERT INTO private.skus (
    parent_sku, format_code, case_size, bottle_volume_ml,
    least_listing_price_p, market_price_p, highest_bid_p, is_listed,
    first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at
)
VALUES (
    '20000000001', '06-00750', 6, 750, 42000, 40000, 31000, TRUE,
    '20000000-0000-0000-0000-000000000001', now(),
    '20000000-0000-0000-0000-000000000001', now()
);

-- catalogue_view reads a cache (20260827120000), so the rows above are not
-- visible to it -- or to the market view below -- until it is rebuilt.
SELECT private.rebuild_catalogue_caches();

-- Four snapshots. uploaded_at is scrambled against effective_date on purpose:
-- in upload order the dates run 02-01, 04-01, 03-01, 01-01.

INSERT INTO public.cellar_imports (
    id, source_type, content_checksum, original_filename, byte_size,
    storage_object_path, uploaded_by, uploaded_at, parser_version, status,
    source_row_count, parsed_row_count, matched_row_count,
    unmatched_row_count, error_row_count
)
SELECT
    v.id::UUID, 'bbr_holdings', repeat(v.c, 64),
    format('my-cellar-view-%s.csv', v.d), 1000,
    format('10000000-0000-0000-0000-000000000001/%s/source.csv', v.id),
    '10000000-0000-0000-0000-000000000001', v.uploaded::TIMESTAMPTZ,
    'bbr-v2', 'validated',
    v.rows, v.rows, v.matched, v.rows - v.matched, 0
FROM (
    VALUES
        ('a0000000-0000-0000-0000-000000000001', 'a', '2026-01-01',
         '2026-08-04 10:00:00+00', 3, 1),
        ('a0000000-0000-0000-0000-000000000002', 'b', '2026-02-01',
         '2026-08-01 10:00:00+00', 1, 1),
        ('a0000000-0000-0000-0000-000000000003', 'c', '2026-03-01',
         '2026-08-03 10:00:00+00', 2, 1),
        ('a0000000-0000-0000-0000-000000000004', 'd', '2026-04-01',
         '2026-08-02 10:00:00+00', 2, 1)
) AS v(id, c, d, uploaded, rows, matched);

-- The positions. Parent ID 20000000001 at 06-00750 is held throughout, with a
-- quantity change at 03-01 and a reported-price change at 04-01, and a
-- description that BBR restated in the last export. 90000000002 is present,
-- absent, then present again. 90000000003 is held once. 20000000001 at
-- 12-00750 arrives only in the last snapshot.

CREATE TEMP TABLE fixture_positions (
    import_id UUID,
    source_row_number INT,
    parent_sku TEXT,
    format_code TEXT,
    description TEXT,
    quantity_bottles INT,
    purchase_price_per_case_p INT,
    catalogue_matched BOOLEAN
) ON COMMIT DROP;

INSERT INTO fixture_positions VALUES
    ('a0000000-0000-0000-0000-000000000001', 1, '20000000001', '06-00750',
     'Test wine as first exported', 6, 10000, TRUE),
    ('a0000000-0000-0000-0000-000000000001', 2, '90000000002', '06-00750',
     'Uncatalogued wine', 6, 5000, FALSE),
    ('a0000000-0000-0000-0000-000000000001', 3, '90000000003', '06-00750',
     'Wine held once', 3, 7000, FALSE),
    ('a0000000-0000-0000-0000-000000000002', 1, '20000000001', '06-00750',
     'Test wine as first exported', 6, 10000, TRUE),
    ('a0000000-0000-0000-0000-000000000003', 1, '20000000001', '06-00750',
     'Test wine as first exported', 12, 10000, TRUE),
    ('a0000000-0000-0000-0000-000000000003', 2, '90000000002', '06-00750',
     'Uncatalogued wine', 6, 5500, FALSE),
    ('a0000000-0000-0000-0000-000000000004', 1, '20000000001', '06-00750',
     'Test wine as latterly exported', 12, 12000, TRUE),
    ('a0000000-0000-0000-0000-000000000004', 2, '20000000001', '12-00750',
     'Test wine, magnum case', 1, 30000, FALSE);

-- A matched row must name the catalogue SKU it matched; an unmatched one must
-- not, because the row's own foreign key is to the catalogue. That asymmetry
-- is exactly what slice 3 freed the evidence table from.
INSERT INTO public.cellar_import_rows (
    import_id, source_row_number, raw_row, match_status, parent_sku,
    format_code
)
SELECT
    import_id, source_row_number, '{}'::JSONB,
    CASE WHEN catalogue_matched THEN 'matched' ELSE 'unmatched' END,
    CASE WHEN catalogue_matched THEN parent_sku END,
    CASE WHEN catalogue_matched THEN format_code END
FROM fixture_positions;

INSERT INTO public.bbr_holding_evidence (
    import_id, source_row_number, parent_sku, format_code, catalogue_matched,
    product_code, description, vintage, bottle_volume_ml, quantity_bottles,
    eligible_for_bbx, purchase_price_per_case_p, case_size, current_status
)
SELECT
    import_id, source_row_number, parent_sku, format_code, catalogue_matched,
    'fixture', description, 2019, 750, quantity_bottles,
    TRUE, purchase_price_per_case_p,
    CASE WHEN format_code = '12-00750' THEN 12 ELSE 6 END,
    'In bond'
FROM fixture_positions;

-- Privileges ------------------------------------------------------------------

SELECT is(
    has_table_privilege('anon', 'public.bbr_position_observations', 'SELECT'),
    FALSE,
    'anonymous users have no observation privilege'
);

SELECT is(
    has_table_privilege(
        'authenticated', 'public.bbr_position_observations', 'SELECT'
    ),
    TRUE,
    'authenticated users have the observation grant required for owner RLS'
);

SELECT is(
    has_table_privilege('anon', 'public.bbr_positions_view', 'SELECT'),
    FALSE,
    'anonymous users have no consolidated position privilege'
);

SELECT is(
    has_table_privilege('authenticated', 'public.bbr_positions_view', 'SELECT'),
    TRUE,
    'authenticated users have the consolidated position grant'
);

SELECT is(
    has_table_privilege(
        'anon', 'public.bbr_cellar_positions_market_view', 'SELECT'
    ),
    FALSE,
    'anonymous users have no all-owned market privilege'
);

SELECT is(
    has_table_privilege(
        'authenticated', 'public.bbr_cellar_positions_market_view', 'SELECT'
    ),
    TRUE,
    'authenticated users have the all-owned market grant'
);

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;

-- Dated evidence with no nomination (D8) --------------------------------------
-- Accepted newest-first among the historicals, so acceptance order is already
-- fighting effective-date order before the current snapshot arrives.

SELECT is(
    (
        SELECT (public.accept_bbr_snapshot(
            'a0000000-0000-0000-0000-000000000003', DATE '2026-03-01',
            'historical'
        ))->>'accepted_role'
    ),
    'historical',
    'the 2026-03-01 snapshot is accepted as dated evidence'
);

SELECT is(
    (
        SELECT (public.accept_bbr_snapshot(
            'a0000000-0000-0000-0000-000000000001', DATE '2026-01-01',
            'historical'
        ))->>'accepted_role'
    ),
    'historical',
    'an earlier snapshot is accepted after it'
);

SELECT is(
    (
        SELECT string_agg(DISTINCT membership, ' ')
        FROM public.bbr_positions_view
    ),
    'unknown',
    'with no nomination every position is unknown, not former'
);

SELECT is(
    (
        SELECT count(*)::INT
        FROM public.bbr_positions_view
        WHERE current_quantity_bottles IS NOT NULL
    ),
    0,
    'no position claims a current quantity when none has been established'
);

SELECT is(
    (
        SELECT count(*)::INT
        FROM public.bbr_positions_view
        WHERE membership = 'former'
    ),
    0,
    'unknown is never reported as former (D8)'
);

SELECT is(
    (SELECT count(*)::INT FROM public.bbr_position_observations),
    5,
    'the dated observations are there, so the three assertions above are not vacuous'
);

-- The nomination, then a historical snapshot accepted after it ----------------

SELECT is(
    (
        SELECT (public.accept_bbr_snapshot(
            'a0000000-0000-0000-0000-000000000004', DATE '2026-04-01',
            'current'
        ))->>'accepted_role'
    ),
    'current',
    'the latest snapshot is nominated as current'
);

SELECT is(
    (
        SELECT (public.accept_bbr_snapshot(
            'a0000000-0000-0000-0000-000000000002', DATE '2026-02-01',
            'historical'
        ))->>'accepted_role'
    ),
    'historical',
    'a historical snapshot is accepted after the current one'
);

-- accepted_at cannot record call order here: every acceptance above shares one
-- transaction, so all four carry the same now(). What acceptance order can
-- still be caught doing is conferring currency on whatever was accepted last,
-- which is 2026-02-01.
SELECT is(
    (
        SELECT string_agg(
            to_char(effective_date, 'MM-DD') || ':' || snapshot_state,
            ' ' ORDER BY effective_date
        )
        FROM public.bbr_snapshot_view
    ),
    '01-01:historical 02-01:historical 03-01:historical 04-01:nominated_current',
    'the snapshot accepted last is historical; acceptance recency confers nothing'
);

SELECT is(
    (
        SELECT string_agg(
            to_char(effective_date, 'MM-DD'), ' ' ORDER BY uploaded_at
        )
        FROM public.bbr_snapshot_view
    ),
    '02-01 04-01 03-01 01-01',
    'upload order contradicts effective-date order too'
);

-- Observation grain -----------------------------------------------------------

SELECT is(
    (SELECT count(*)::INT FROM public.bbr_position_observations),
    8,
    'every evidence row of every accepted snapshot is an observation'
);

SELECT is(
    (
        SELECT count(*)::INT = count(DISTINCT (import_id, parent_sku, format_code))::INT
        FROM public.bbr_position_observations
    ),
    TRUE,
    'one observation per position per snapshot, which slice 3''s unique index guarantees'
);

SELECT is(
    (
        SELECT string_agg(
            to_char(effective_date, 'MM-DD') || ':' || quantity_bottles,
            ' ' ORDER BY effective_date
        )
        FROM public.bbr_position_observations
        WHERE parent_sku = '20000000001' AND format_code = '06-00750'
    ),
    '01-01:6 02-01:6 03-01:12 04-01:12',
    'observations run in effective-date order regardless of when they were accepted'
);

SELECT is(
    (
        SELECT string_agg(DISTINCT accepted_role, ' ' ORDER BY accepted_role)
        FROM public.bbr_position_observations
    ),
    'current historical',
    'each observation carries the role of the snapshot it came from'
);

-- Consolidated grain ----------------------------------------------------------

SELECT is(
    (SELECT count(*)::INT FROM public.bbr_positions_view),
    4,
    'four distinct positions across the chronology'
);

SELECT is(
    (
        SELECT membership FROM public.bbr_positions_view
        WHERE parent_sku = '20000000001' AND format_code = '06-00750'
    ),
    'current',
    'a position in the nominated snapshot is current'
);

SELECT is(
    (
        SELECT current_quantity_bottles FROM public.bbr_positions_view
        WHERE parent_sku = '20000000001' AND format_code = '06-00750'
    ),
    12,
    'current quantity comes from the nomination, not from the latest historical'
);

SELECT is(
    (
        SELECT first_seen FROM public.bbr_positions_view
        WHERE parent_sku = '20000000001' AND format_code = '06-00750'
    ),
    DATE '2026-01-01',
    'first seen is the earliest effective date carrying the position'
);

SELECT is(
    (
        SELECT last_seen FROM public.bbr_positions_view
        WHERE parent_sku = '20000000001' AND format_code = '06-00750'
    ),
    DATE '2026-04-01',
    'last seen is the latest one'
);

SELECT is(
    (
        SELECT absent_by FROM public.bbr_positions_view
        WHERE parent_sku = '20000000001' AND format_code = '06-00750'
    ),
    NULL::DATE,
    'a position in the most recent snapshot has no date it was absent by'
);

SELECT is(
    (
        SELECT reported_price_min_p FROM public.bbr_positions_view
        WHERE parent_sku = '20000000001' AND format_code = '06-00750'
    ),
    10000,
    'the reported price range takes its minimum across every observation'
);

SELECT is(
    (
        SELECT reported_price_max_p FROM public.bbr_positions_view
        WHERE parent_sku = '20000000001' AND format_code = '06-00750'
    ),
    12000,
    'and its maximum'
);

SELECT is(
    (
        SELECT observation_count FROM public.bbr_positions_view
        WHERE parent_sku = '20000000001' AND format_code = '06-00750'
    ),
    4,
    'the observation count is every snapshot the position appeared in'
);

SELECT is(
    (
        SELECT description FROM public.bbr_positions_view
        WHERE parent_sku = '20000000001' AND format_code = '06-00750'
    ),
    'Test wine as latterly exported',
    'source identity is as at the latest observation, not the earliest'
);

-- Presence, absence, reappearance ---------------------------------------------

SELECT is(
    (
        SELECT membership FROM public.bbr_positions_view
        WHERE parent_sku = '90000000002'
    ),
    'former',
    'a position missing from the nomination is former'
);

SELECT is(
    (
        SELECT current_quantity_bottles FROM public.bbr_positions_view
        WHERE parent_sku = '90000000002'
    ),
    0,
    'a former position holds zero current bottles, not its last observed count'
);

SELECT is(
    (
        SELECT last_seen FROM public.bbr_positions_view
        WHERE parent_sku = '90000000002'
    ),
    DATE '2026-03-01',
    'last seen survives an intervening absence and reappearance'
);

SELECT is(
    (
        SELECT absent_by FROM public.bbr_positions_view
        WHERE parent_sku = '90000000002'
    ),
    DATE '2026-04-01',
    'absent by is the first accepted date after the last observation'
);

SELECT is(
    (
        SELECT observation_count FROM public.bbr_positions_view
        WHERE parent_sku = '90000000002'
    ),
    2,
    'the snapshot it was absent from is not counted as an observation of it'
);

SELECT is(
    (
        SELECT absent_by FROM public.bbr_positions_view
        WHERE parent_sku = '90000000003'
    ),
    DATE '2026-02-01',
    'absent by is the earliest subsequent snapshot, not the most recent one'
);

-- Two formats under one Parent ID ---------------------------------------------

SELECT is(
    (
        SELECT string_agg(
            format_code || ':' || membership || ':' || current_quantity_bottles,
            ' ' ORDER BY format_code
        )
        FROM public.bbr_positions_view
        WHERE parent_sku = '20000000001'
    ),
    '06-00750:current:12 12-00750:current:1',
    'two formats under one Parent ID are independent positions'
);

SELECT is(
    (
        SELECT sum(current_quantity_bottles)::INT
        FROM public.bbr_positions_view
    ),
    13,
    'former positions contribute nothing to the current bottle total'
);

SELECT is(
    (
        SELECT string_agg(parent_sku || '/' || format_code, ' ' ORDER BY format_code)
        FROM public.bbr_positions_view
        WHERE membership = 'current'
    ),
    '20000000001/06-00750 20000000001/12-00750',
    'the current positions are exactly the nominated snapshot''s'
);

-- Market decoration -----------------------------------------------------------

SELECT is(
    (SELECT count(*)::INT FROM public.bbr_cellar_positions_market_view),
    (SELECT count(*)::INT FROM public.bbr_positions_view),
    'the market left join neither drops nor duplicates a position'
);

SELECT is(
    (
        SELECT catalogue_name FROM public.bbr_cellar_positions_market_view
        WHERE parent_sku = '20000000001' AND format_code = '06-00750'
    ),
    'Test wine',
    'a catalogued position is decorated with live catalogue values'
);

SELECT is(
    (
        SELECT market_price_p FROM public.bbr_cellar_positions_market_view
        WHERE parent_sku = '20000000001' AND format_code = '06-00750'
    ),
    40000,
    'and with the live scanner market price, not the price the file reported'
);

SELECT ok(
    (
        SELECT catalogue_name IS NULL AND membership = 'former'
        FROM public.bbr_cellar_positions_market_view
        WHERE parent_sku = '90000000002'
    ),
    'a Parent ID the catalogue does not carry is retained with null decoration'
);

SELECT ok(
    (
        SELECT catalogue_name IS NULL AND current_quantity_bottles = 1
        FROM public.bbr_cellar_positions_market_view
        WHERE parent_sku = '20000000001' AND format_code = '12-00750'
    ),
    'decoration misses at format grain without losing the position'
);

-- The owner boundary ----------------------------------------------------------

RESET ROLE;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;

SELECT is(
    (SELECT count(*)::INT FROM public.bbr_position_observations),
    0,
    'RLS hides the observations from a non-owner'
);

SELECT is(
    (SELECT count(*)::INT FROM public.bbr_positions_view),
    0,
    'RLS hides the consolidated positions from a non-owner'
);

SELECT is(
    (SELECT count(*)::INT FROM public.bbr_cellar_positions_market_view),
    0,
    'RLS hides the all-owned market view from a non-owner'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
