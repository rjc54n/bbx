BEGIN;
SELECT plan(10);

INSERT INTO auth.users (id) VALUES
    ('79000000-0000-0000-0000-000000000001'),
    ('79000000-0000-0000-0000-000000000002');
INSERT INTO public.app_owners (user_id)
VALUES ('79000000-0000-0000-0000-000000000001');

INSERT INTO private.products (
    parent_sku, name, vintage, first_seen_at, last_seen_at
) VALUES (
    '90000000003', 'Reference test wine', 2010, now(), now()
);
INSERT INTO private.skus (
    parent_sku, format_code, case_size, bottle_volume_ml,
    least_listing_price_p, highest_bid_p, first_seen_at, last_seen_at
) VALUES
    ('90000000003', '06-00750', 6, 750, 9000, 6000, now(), now()),
    ('90000000003', '12-00750', 12, 750, 24000, 18000, now(), now()),
    ('90000000003', '01-01500', 1, 1500, 1000, 500, now(), now());
SELECT private.rebuild_catalogue_caches();

INSERT INTO public.reference_price_decisions (
    parent_sku, price_per_75cl_p, decided_by
) VALUES (
    '90000000003', 1750, '79000000-0000-0000-0000-000000000001'
);

SELECT is((SELECT count(*)::INT FROM public.wine_scenario_mv
           WHERE parent_sku = '90000000003'), 3,
    'scenario market cache includes three live formats');
SELECT is((SELECT count(*)::INT FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           WHERE c.relname = 'wine_scenario_mv' AND a.attnum > 0
             AND a.attname LIKE '%reference%'), 0,
    'scenario cache contains no private reference column');
SELECT is(has_table_privilege('anon', 'public.wine_scenario_reference_view', 'SELECT'),
    FALSE, 'anonymous users cannot read the reference scenario view');

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"79000000-0000-0000-0000-000000000001","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;

SELECT is((SELECT reference_price_per_75cl_p
           FROM public.wine_scenario_reference_view
           WHERE parent_sku = '90000000003' AND format_code = '06-00750'),
    1750, 'six-bottle listing uses the wine reference per bottle');
SELECT is((SELECT reference_price_per_75cl_p
           FROM public.wine_scenario_reference_view
           WHERE parent_sku = '90000000003' AND format_code = '12-00750'),
    1750, 'twelve-bottle listing uses the same reference per bottle');
SELECT is((SELECT ask_vs_reference_pct
           FROM public.wine_scenario_reference_view
           WHERE parent_sku = '90000000003' AND format_code = '06-00750'),
    -14.3::NUMERIC, 'six-bottle ask is compared per bottle');
SELECT is((SELECT ask_vs_reference_pct
           FROM public.wine_scenario_reference_view
           WHERE parent_sku = '90000000003' AND format_code = '12-00750'),
    14.3::NUMERIC, 'twelve-bottle ask is compared per bottle');
SELECT ok((SELECT reference_price_per_75cl_p IS NULL
                   AND ask_vs_reference_pct IS NULL
           FROM public.wine_scenario_reference_view
           WHERE parent_sku = '90000000003' AND format_code = '01-01500'),
    'magnum row receives no historic reference comparison');

SELECT public.set_reference_price('90000000003', 1800);
SELECT is((SELECT reference_price_per_75cl_p
           FROM public.wine_scenario_reference_view
           WHERE parent_sku = '90000000003' AND format_code = '06-00750'),
    1800, 'owner edit appears without refreshing the market cache');

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"79000000-0000-0000-0000-000000000002","role":"authenticated"}',
    TRUE
);
SELECT is((SELECT count(*)::INT FROM public.wine_scenario_reference_view
           WHERE parent_sku = '90000000003'), 0,
    'non-owner cannot read the reference scenario view');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
