BEGIN;
SELECT plan(39);

SELECT isnt(to_regclass('private._migrations'), NULL::regclass, 'application migration ledger is private');
SELECT isnt(to_regclass('private.scan_runs'), NULL::regclass, 'scan runs table is private');
SELECT isnt(to_regclass('private.products'), NULL::regclass, 'products table is private');
SELECT isnt(to_regclass('private.skus'), NULL::regclass, 'skus table is private');
SELECT isnt(to_regclass('private.offers'), NULL::regclass, 'offers table is private');
SELECT isnt(to_regclass('private.observation_events'), NULL::regclass, 'observation events table is private');

SELECT is(to_regclass('public._migrations'), NULL::regclass, 'application migration ledger is absent from public');
SELECT is(to_regclass('public.scan_runs'), NULL::regclass, 'scan runs table is absent from public');
SELECT is(to_regclass('public.products'), NULL::regclass, 'products table is absent from public');
SELECT is(to_regclass('public.skus'), NULL::regclass, 'skus table is absent from public');
SELECT is(to_regclass('public.offers'), NULL::regclass, 'offers table is absent from public');
SELECT is(to_regclass('public.observation_events'), NULL::regclass, 'observation events table is absent from public');

SELECT results_eq(
    $$
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY (ARRAY[
              'scan_health_view', 'product_detail_view', 'price_history_view',
              'candidate_view', 'catalogue_view', 'facet_ranges_view',
              'recent_price_change_view', 'facet_values_view', 'format_options_view'
          ])
          AND c.reloptions @> ARRAY['security_invoker=true']
        ORDER BY c.relname
    $$,
    $$
        VALUES
            ('candidate_view'::name),
            ('catalogue_view'::name),
            ('facet_ranges_view'::name),
            ('facet_values_view'::name),
            ('format_options_view'::name),
            ('price_history_view'::name),
            ('product_detail_view'::name),
            ('recent_price_change_view'::name),
            ('scan_health_view'::name)
    $$,
    'all reported public views use invoker security'
);

SELECT is(has_table_privilege('anon', 'private._migrations', 'SELECT'), FALSE, 'anon cannot read application migration ledger');
SELECT is(has_table_privilege('authenticated', 'private._migrations', 'SELECT'), FALSE, 'authenticated cannot read application migration ledger');
SELECT is(has_table_privilege('service_role', 'private._migrations', 'SELECT'), FALSE, 'service role cannot read application migration ledger');

SELECT is_empty(
    $$
        SELECT role_name, privilege
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) role_name
        CROSS JOIN unnest(ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ]) privilege
        WHERE has_table_privilege(role_name, 'private._migrations', privilege)
    $$,
    'application migration ledger has no Data API role privileges'
);

SELECT results_eq(
    $$
        SELECT role_name, table_name
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) role_name
        CROSS JOIN unnest(ARRAY[
            'scan_runs', 'products', 'skus', 'offers', 'observation_events'
        ]) table_name
        WHERE has_table_privilege(role_name, 'private.' || table_name, 'SELECT')
        ORDER BY role_name, table_name
    $$,
    $$
        SELECT role_name, table_name
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) role_name
        CROSS JOIN unnest(ARRAY[
            'scan_runs', 'products', 'skus', 'offers', 'observation_events'
        ]) table_name
        ORDER BY role_name, table_name
    $$,
    'view roles have only the required private read path'
);

SELECT is_empty(
    $$
        SELECT role_name, table_name, privilege
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) role_name
        CROSS JOIN unnest(ARRAY[
            'scan_runs', 'products', 'skus', 'offers', 'observation_events'
        ]) table_name
        CROSS JOIN unnest(ARRAY[
            'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ]) privilege
        WHERE has_table_privilege(role_name, 'private.' || table_name, privilege)
    $$,
    'view roles have no private scan-store write privileges'
);

INSERT INTO private.scan_runs (
    id, scope, run_date, status, started_at, finished_at,
    algolia_complete, algolia_hits_expected, algolia_hits_collected
) VALUES (
    '41000000-0000-0000-0000-000000000001', 'security-test', DATE '2026-07-29',
    'completed', now() - INTERVAL '1 minute', now(), TRUE, 1, 1
);

INSERT INTO private.products (
    parent_sku, name, vintage, region, subregion, colour, country, producer,
    product_url, first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at
) VALUES (
    '41000000001', 'Security test wine 2020', 2020, 'Bordeaux', 'Pauillac',
    'Red', 'France', 'Test producer', '/products-41000000001-security-test-wine',
    '41000000-0000-0000-0000-000000000001', now(),
    '41000000-0000-0000-0000-000000000001', now()
);

INSERT INTO private.skus (
    parent_sku, format_code, case_size, bottle_volume_ml,
    least_listing_price_p, market_price_p, last_transaction_p, highest_bid_p,
    qty_available, source_agreement, is_listed,
    first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at
) VALUES (
    '41000000001', '06-00750', 6, 750, 9000, 10000, 9500, 8500,
    3, 'confirmed', TRUE,
    '41000000-0000-0000-0000-000000000001', now(),
    '41000000-0000-0000-0000-000000000001', now()
);

INSERT INTO private.offers (
    bbx_listing_id, parent_sku, format_code, match_confidence,
    case_size, bottle_volume_ml, price_per_case_p,
    first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at
) VALUES (
    'security-test-offer', '41000000001', '06-00750', 'inferred',
    6, 750, 9500,
    '41000000-0000-0000-0000-000000000001', now(),
    '41000000-0000-0000-0000-000000000001', now()
);

INSERT INTO private.observation_events (
    scan_run_id, observed_at, entity_type, entity_key, event_type,
    field_name, old_value_raw, new_value_raw
) VALUES (
    '41000000-0000-0000-0000-000000000001', now(), 'sku',
    '41000000001|06-00750', 'price_changed', 'least_listing_price_p',
    '9100', '9000'
);

SET LOCAL ROLE anon;
SELECT lives_ok('SELECT 1 FROM public.scan_health_view LIMIT 1', 'anon can read scan health');
SELECT lives_ok('SELECT 1 FROM public.product_detail_view LIMIT 1', 'anon can read product detail');
SELECT lives_ok('SELECT 1 FROM public.price_history_view LIMIT 1', 'anon can read price history');
SELECT lives_ok('SELECT 1 FROM public.candidate_view LIMIT 1', 'anon can read candidates');
SELECT lives_ok('SELECT 1 FROM public.catalogue_view LIMIT 1', 'anon can read catalogue');
SELECT lives_ok('SELECT 1 FROM public.facet_ranges_view LIMIT 1', 'anon can read facet ranges');
SELECT lives_ok('SELECT 1 FROM public.recent_price_change_view LIMIT 1', 'anon can read recent price changes');
SELECT lives_ok('SELECT 1 FROM public.facet_values_view LIMIT 1', 'anon can read facet values');
SELECT lives_ok('SELECT 1 FROM public.format_options_view LIMIT 1', 'anon can read format options');
SELECT is(
    (SELECT ask FROM public.catalogue_view WHERE parent_sku = '41000000001'),
    9000,
    'catalogue projection retains its ask value'
);
SELECT is(
    (SELECT status FROM public.scan_health_view WHERE run_id = '41000000-0000-0000-0000-000000000001'),
    'completed',
    'scan health projection retains its status value'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT lives_ok('SELECT 1 FROM public.scan_health_view LIMIT 1', 'authenticated can read scan health');
SELECT lives_ok('SELECT 1 FROM public.product_detail_view LIMIT 1', 'authenticated can read product detail');
SELECT lives_ok('SELECT 1 FROM public.price_history_view LIMIT 1', 'authenticated can read price history');
SELECT lives_ok('SELECT 1 FROM public.candidate_view LIMIT 1', 'authenticated can read candidates');
SELECT lives_ok('SELECT 1 FROM public.catalogue_view LIMIT 1', 'authenticated can read catalogue');
SELECT lives_ok('SELECT 1 FROM public.facet_ranges_view LIMIT 1', 'authenticated can read facet ranges');
SELECT lives_ok('SELECT 1 FROM public.recent_price_change_view LIMIT 1', 'authenticated can read recent price changes');
SELECT lives_ok('SELECT 1 FROM public.facet_values_view LIMIT 1', 'authenticated can read facet values');
SELECT lives_ok('SELECT 1 FROM public.format_options_view LIMIT 1', 'authenticated can read format options');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
