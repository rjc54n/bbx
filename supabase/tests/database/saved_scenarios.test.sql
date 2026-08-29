-- Step 5a (docs/WINE-RECORD-SPEC.md §12): saved scenarios. Covers the RLS-gated
-- CRUD on saved_scenarios (owner-only, own rows), the shape/name checks, and the
-- wine_scenario_view surface (identity + metric parity with wine_card_format_view).

BEGIN;
SELECT plan(17);

INSERT INTO auth.users (id) VALUES
    ('43000000-0000-0000-0000-000000000001'),
    ('43000000-0000-0000-0000-000000000002');
INSERT INTO public.app_owners (user_id) VALUES ('43000000-0000-0000-0000-000000000001');
INSERT INTO private.scan_runs (id, scope, run_date, status, started_at)
VALUES ('44000000-0000-0000-0000-000000000001', 'scenario-test', DATE '2026-08-17', 'completed', now());
INSERT INTO private.products (
    parent_sku, name, vintage, region, colour, producer,
    first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at, last_rest_checked_at
) VALUES (
    '44000000001', 'Scenario wine 2018', 2018, 'Bordeaux', 'Red', 'Test producer',
    '44000000-0000-0000-0000-000000000001', now(),
    '44000000-0000-0000-0000-000000000001', now(), now()
);
INSERT INTO private.skus (
    parent_sku, format_code, case_size, bottle_volume_ml,
    least_listing_price_p, market_price_p, highest_bid_p, is_listed,
    first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at
) VALUES (
    '44000000001', '06-00750', 6, 750, 45000, 47000, 40000, TRUE,
    '44000000-0000-0000-0000-000000000001', now(),
    '44000000-0000-0000-0000-000000000001', now()
);

-- catalogue_view now reads a cache (20260827120000), so the fixture rows above
-- are not visible to it -- or to anything downstream -- until it is rebuilt.
SELECT private.rebuild_catalogue_caches();
-- An owner anchor gives the format a release price, so the vs-release metrics
-- are non-null and the scenario/format parity assertion is meaningful.
INSERT INTO public.owner_release_anchors (wine_ref, format_code, release_price_p)
VALUES ('parent:44000000001', '06-00750', 40000);

-- Grants / RLS surface -------------------------------------------------------
SELECT is(has_table_privilege('anon', 'public.saved_scenarios', 'SELECT'), FALSE,
    'anon cannot read saved scenarios');
SELECT is(has_table_privilege('authenticated', 'public.saved_scenarios', 'INSERT'), TRUE,
    'authenticated may insert (RLS scopes to the owner)');
SELECT is(has_table_privilege('anon', 'public.wine_scenario_view', 'SELECT'), FALSE,
    'anon cannot read the scenario view');
SELECT is(has_table_privilege('authenticated', 'public.wine_scenario_view', 'SELECT'), TRUE,
    'authenticated may read the scenario view');

SELECT set_config('request.jwt.claims', '{"sub":"43000000-0000-0000-0000-000000000001","role":"authenticated"}', TRUE);
SET LOCAL ROLE authenticated;

-- CRUD as the owner ----------------------------------------------------------
SELECT lives_ok(
    $$ INSERT INTO public.saved_scenarios (user_id, name, definition)
       VALUES ('43000000-0000-0000-0000-000000000001', 'Under 10% over release',
               '{"filters":[{"field":"ask_vs_release_pct","kind":"range","max":10}],"sort":{"field":"ask_vs_release_pct","dir":"asc"}}'::jsonb) $$,
    'owner inserts a scenario for themselves');
SELECT is((SELECT count(*)::INT FROM public.saved_scenarios), 1, 'owner sees their scenario');
SELECT throws_ok(
    $$ INSERT INTO public.saved_scenarios (user_id, name, definition)
       VALUES ('43000000-0000-0000-0000-000000000001', '   ', '{}'::jsonb) $$,
    '23514', NULL, 'a blank name is rejected by the check');
SELECT throws_ok(
    $$ INSERT INTO public.saved_scenarios (user_id, name, definition)
       VALUES ('43000000-0000-0000-0000-000000000001', 'Bad shape', '[]'::jsonb) $$,
    '23514', NULL, 'a non-object definition is rejected by the check');
SELECT lives_ok(
    $$ UPDATE public.saved_scenarios SET name = 'Renamed'
       WHERE user_id = '43000000-0000-0000-0000-000000000001' $$,
    'owner updates their own scenario');

-- Scenario view: identity + metric parity ------------------------------------
SELECT is(
    (SELECT name FROM public.wine_scenario_view WHERE parent_sku = '44000000001' AND format_code = '06-00750'),
    'Scenario wine 2018', 'scenario view carries wine identity');
SELECT is(
    (SELECT ask_vs_release_pct FROM public.wine_scenario_view WHERE parent_sku = '44000000001' AND format_code = '06-00750'),
    (SELECT ask_vs_release_pct FROM public.wine_card_format_view WHERE parent_sku = '44000000001' AND format_code = '06-00750'),
    'scenario view ask_vs_release_pct matches the card format view');
SELECT is(
    (SELECT count(*) FROM public.wine_scenario_view),
    (SELECT count(*) FROM public.wine_card_format_view),
    'scenario view has exactly one row per card format');
-- Phase 1 unit boundary: 45000p per 6x750ml case -> 7500p per 75cl bottle.
SELECT is(
    (SELECT lowest_ask_per_75cl_p FROM public.wine_scenario_view
     WHERE parent_sku = '44000000001' AND format_code = '06-00750'),
    7500, 'scenario view exposes the ask per 75cl in pence');

-- A non-owner sees and writes nothing ----------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"43000000-0000-0000-0000-000000000002","role":"authenticated"}', TRUE);
SELECT is((SELECT count(*)::INT FROM public.saved_scenarios), 0, 'a non-owner cannot see owner scenarios');
SELECT throws_ok(
    $$ INSERT INTO public.saved_scenarios (user_id, name, definition)
       VALUES ('43000000-0000-0000-0000-000000000002', 'Sneaky', '{}'::jsonb) $$,
    '42501', NULL, 'a non-owner cannot insert a scenario');

-- Owner can delete their own row ---------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"43000000-0000-0000-0000-000000000001","role":"authenticated"}', TRUE);
SELECT lives_ok(
    $$ DELETE FROM public.saved_scenarios WHERE user_id = '43000000-0000-0000-0000-000000000001' $$,
    'owner deletes their own scenario');
SELECT is((SELECT count(*)::INT FROM public.saved_scenarios), 0, 'the scenario is gone after delete');

SELECT * FROM finish();
ROLLBACK;
