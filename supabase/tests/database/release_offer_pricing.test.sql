BEGIN;
SELECT plan(48);

INSERT INTO auth.users (id) VALUES
    ('11000000-0000-0000-0000-000000000001'),
    ('11000000-0000-0000-0000-000000000002');
INSERT INTO public.app_owners (user_id) VALUES ('11000000-0000-0000-0000-000000000001');
INSERT INTO private.scan_runs (id, scope, run_date, status, started_at)
VALUES ('21000000-0000-0000-0000-000000000001', 'release-test', DATE '2026-07-28', 'completed', now());
INSERT INTO private.products (
    parent_sku, name, vintage, region, colour, producer, product_url,
    first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at, last_rest_checked_at
) VALUES (
    '21000000001', 'Test release wine 2018', 2018, 'Bordeaux', 'Red',
    'Test producer', '/products-21000000001-test-release-wine',
    '21000000-0000-0000-0000-000000000001', now(),
    '21000000-0000-0000-0000-000000000001', now(), now()
);
INSERT INTO private.skus (
    parent_sku, format_code, case_size, bottle_volume_ml,
    least_listing_price_p, market_price_p, highest_bid_p, is_listed,
    first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at
) VALUES (
    '21000000001', '06-00750', 6, 750, 9000, 9500, 8000, TRUE,
    '21000000-0000-0000-0000-000000000001', now(),
    '21000000-0000-0000-0000-000000000001', now()
);

SELECT is(has_table_privilege('anon', 'public.release_offer_match_runs', 'SELECT'), FALSE, 'anon cannot read match runs');
SELECT is(has_table_privilege('authenticated', 'public.release_offer_match_runs', 'SELECT'), TRUE, 'authenticated receives owner-gated match-run read access');
SELECT is(has_table_privilege('authenticated', 'public.release_offer_resolution_events', 'INSERT'), FALSE, 'authenticated cannot forge resolution audit events');
SELECT is(has_function_privilege('anon', 'public.begin_release_offer_match_run()', 'EXECUTE'), FALSE, 'anon cannot start matching');
SELECT is(has_function_privilege('anon', 'public.exclude_release_offer_match_group(text)', 'EXECUTE'), FALSE, 'anon cannot exclude historic offer records');

SELECT set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}', TRUE);
SET LOCAL ROLE authenticated;

SELECT is(public.begin_release_offer_import(
    '31000000-0000-0000-0000-000000000001', repeat('a', 64), 'release-test.csv', 3000,
    '11000000-0000-0000-0000-000000000001/31000000-0000-0000-0000-000000000001/release-offers.csv',
    'release-offers-v2'
)->>'status', 'staging', 'owner can begin manual CSV import');

SELECT is(public.stage_release_offer_batch('31000000-0000-0000-0000-000000000001', '[
 {"source_row_number":2,"raw_row":{"Wine":"Direct wine 2018"},"offer_date":"2019-01-01","source_wine":"Direct wine 2018","source_vintage":2018,"source_match_key":"direct wine","source_price_text":"£100 per 6 bottles in bond","source_product_id":"99999999999","content_fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","validation_errors":[],"validation_warnings":[],"prices":[{"fragment_index":1,"raw_price_text":"£100 per 6 bottles in bond","amount_p":10000,"currency":"GBP","case_size":6,"bottle_volume_ml":750,"format_code":"06-00750","tax_basis":"in_bond","parse_status":"valid","price_fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","validation_warnings":[]}]},
 {"source_row_number":3,"raw_row":{"Wine":"Test release wine 2018"},"offer_date":"2019-01-02","source_wine":"Test release wine 2018","source_vintage":2018,"source_match_key":"test release wine","source_price_text":"£110 per 6 bottles in bond","content_fingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","validation_errors":[],"validation_warnings":[],"prices":[{"fragment_index":1,"raw_price_text":"£110 per 6 bottles in bond","amount_p":11000,"currency":"GBP","case_size":6,"bottle_volume_ml":750,"format_code":"06-00750","tax_basis":"in_bond","parse_status":"valid","price_fingerprint":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","validation_warnings":[]}]},
 {"source_row_number":4,"raw_row":{"Wine":"Off catalogue wine 2018"},"offer_date":"2019-01-03","source_wine":"Off catalogue wine 2018","source_vintage":2018,"source_match_key":"off catalogue wine","source_price_text":"£120 per 6 bottles in bond","content_fingerprint":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","validation_errors":[],"validation_warnings":[],"prices":[{"fragment_index":1,"raw_price_text":"£120 per 6 bottles in bond","amount_p":12000,"currency":"GBP","case_size":6,"bottle_volume_ml":750,"format_code":"06-00750","tax_basis":"in_bond","parse_status":"valid","price_fingerprint":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","validation_warnings":[]}]},
 {"source_row_number":5,"raw_row":{"Wine":"Vintageless wine"},"offer_date":"2019-01-04","source_wine":"Vintageless wine","source_vintage":null,"source_match_key":"vintageless wine","source_price_text":"£130 per 6 bottles in bond","content_fingerprint":"1111111111111111111111111111111111111111111111111111111111111111","validation_errors":[],"validation_warnings":[],"prices":[{"fragment_index":1,"raw_price_text":"£130 per 6 bottles in bond","amount_p":13000,"currency":"GBP","case_size":6,"bottle_volume_ml":750,"format_code":"06-00750","tax_basis":"in_bond","parse_status":"valid","price_fingerprint":"2222222222222222222222222222222222222222222222222222222222222222","validation_warnings":[]}]},
 {"source_row_number":6,"raw_row":{"Wine":"Typo wyne 2018"},"offer_date":"2019-01-05","source_wine":"Typo wyne 2018","source_vintage":2018,"source_match_key":"typo wyne","source_price_text":"£140 per 6 bottles in bond","content_fingerprint":"3333333333333333333333333333333333333333333333333333333333333333","validation_errors":[],"validation_warnings":[],"prices":[{"fragment_index":1,"raw_price_text":"£140 per 6 bottles in bond","amount_p":14000,"currency":"GBP","case_size":6,"bottle_volume_ml":750,"format_code":"06-00750","tax_basis":"in_bond","parse_status":"valid","price_fingerprint":"4444444444444444444444444444444444444444444444444444444444444444","validation_warnings":[]}]}
]'::jsonb)->>'source_row_count', '5', 'raw rows stage separately from prices');
SELECT is(public.mark_release_offer_import_staged('31000000-0000-0000-0000-000000000001', 5, 5)->>'status', 'staged', 'ETL marks the import staged');
SELECT is(public.accept_release_offer_import('31000000-0000-0000-0000-000000000001')->>'status', 'accepted', 'accepted evidence becomes eligible for matching');

SELECT is(public.begin_release_offer_match_run()->>'supplied_id_link_count', '1', 'supplied Parent ID links first');
SELECT is(public.begin_release_offer_match_run()->>'resumed', 'true', 'an active run resumes rather than duplicating work');
SELECT is((SELECT match_method FROM public.release_offer_product_resolutions WHERE import_id = '31000000-0000-0000-0000-000000000001' AND source_row_number = 2), 'supplied_id', 'supplied link method is recorded');
SELECT is((SELECT match_method FROM public.release_offer_product_resolutions WHERE import_id = '31000000-0000-0000-0000-000000000001' AND source_row_number = 3), 'local_exact', 'unique local name and vintage links automatically');
SELECT is((SELECT remaining_group_count FROM public.release_offer_match_runs ORDER BY started_at DESC LIMIT 1), 3, 'only unresolved groups enter Algolia processing');

SELECT is(public.record_release_offer_algolia_result(
    (SELECT id FROM public.release_offer_match_runs ORDER BY started_at DESC LIMIT 1),
    '2018|off catalogue wine',
    '[{"rank":1,"parent_sku":"88888888888","name":"Off catalogue wine 2018","vintage":2018,"producer":"External producer","region":"Burgundy","stock_origin":"BBR","purchase_mode":"Delivery","matched_words":["off","catalogue","wine"],"typo_count":0}]'::jsonb,
    ARRAY['88888888888'], TRUE, now()
)->>'linked_row_count', '1', 'one exhaustively checked Algolia exact result auto-links');
SELECT is((SELECT match_method FROM public.release_offer_product_resolutions WHERE source_row_number = 4), 'algolia_exact', 'Algolia exact method is recorded');
SELECT is((SELECT is_biddable FROM public.release_offer_match_suggestion_view WHERE parent_sku = '88888888888'), FALSE, 'off-biddable candidates remain linkable');

SELECT is(public.record_release_offer_algolia_result(
    (SELECT id FROM public.release_offer_match_runs ORDER BY started_at DESC LIMIT 1),
    'unknown|vintageless wine',
    '[{"rank":1,"parent_sku":"77777777777","name":"Vintageless wine 2018","vintage":2018}]'::jsonb,
    ARRAY['77777777777'], TRUE, now()
)->>'linked_row_count', '0', 'missing-vintage groups never auto-link');
SELECT is(public.record_release_offer_algolia_result(
    (SELECT id FROM public.release_offer_match_runs ORDER BY started_at DESC LIMIT 1),
    '2018|typo wyne',
    '[{"rank":1,"parent_sku":"66666666666","name":"Typo wine 2018","vintage":2018,"typo_count":1}]'::jsonb,
    ARRAY[]::TEXT[], TRUE, now()
)->>'linked_row_count', '0', 'non-exact Algolia results remain provisional');
SELECT is((SELECT status FROM public.release_offer_match_runs ORDER BY started_at DESC LIMIT 1), 'completed', 'run completes after every group is recorded');

SELECT is(public.confirm_release_offer_match_group('2018|typo wyne', '66666666666')->>'linked_row_count', '1', 'owner confirms a provisional group candidate');
SELECT is(public.suppress_release_offer_match_group('unknown|vintageless wine')->>'suppressed_row_count', '1', 'owner suppresses an unresolved group');
SELECT is(public.unlink_release_offer_match_group('2018|typo wyne')->>'unlinked_row_count', '1', 'unlink returns linked group rows to retryable state');
SELECT is(public.restore_release_offer_match_group('unknown|vintageless wine')->>'restored_row_count', '1', 'restore returns suppressed rows to retryable state');
SELECT is(public.confirm_release_offer_match_group('unknown|vintageless wine', '55555555555', 'manual')->>'linked_row_count', '1', 'manual group link supports an off-catalogue Parent ID');
SELECT is(public.edit_release_offer_match_group('unknown|vintageless wine', '55555555556')->>'edited_row_count', '1', 'linked group Parent ID can be edited');
SELECT cmp_ok((SELECT count(*) FROM public.release_offer_resolution_events), '>=', 8::BIGINT, 'resolution changes append audit events');

SELECT is(public.begin_release_offer_match_run()->>'remaining_group_count', '1', 'a later retry selects unresolved rows only');
SELECT is((SELECT count(*)::INT FROM public.release_offer_match_run_groups WHERE run_id = (SELECT id FROM public.release_offer_match_runs ORDER BY started_at DESC LIMIT 1)), 1, 'linked and suppressed records are excluded from the new run');
SELECT is(public.record_release_offer_algolia_error(
    (SELECT id FROM public.release_offer_match_runs ORDER BY started_at DESC LIMIT 1),
    '2018|typo wyne', 'simulated Algolia failure'
)->>'status', 'failed', 'Algolia failures are recorded against their group');
SELECT is((SELECT status FROM public.release_offer_match_runs ORDER BY started_at DESC LIMIT 1), 'partial', 'a run with failed groups is explicitly partial');
SELECT is((SELECT count(*)::INT FROM public.release_offer_match_suggestions WHERE match_group_key = '2018|typo wyne'), 1, 'a failed retry preserves earlier suggestions');
SELECT is(public.begin_release_offer_match_run()->>'resumed', 'true', 'retry resumes a partial run');
SELECT is(public.record_release_offer_algolia_result(
    (SELECT id FROM public.release_offer_match_runs ORDER BY started_at DESC LIMIT 1),
    '2018|typo wyne', '[]'::jsonb, ARRAY[]::TEXT[], TRUE, now()
)->>'linked_row_count', '0', 'resumed group can complete without inventing a link');
SELECT is((SELECT count(*)::INT FROM public.release_offer_evidence_view), 4, 'accepted linked in-bond evidence remains published');
SELECT is(public.exclude_release_offer_match_group('2018|typo wyne')->>'excluded_row_count', '1', 'owner can exclude a historic-offer group');
SELECT is((SELECT count(*)::INT FROM public.release_offer_review_view WHERE source_row_number = 6), 0, 'excluding a group hides its source record');
-- The row and its prices are retained so the exclusion can be undone, and so a
-- later file repeating the same content stays out by fingerprint.
SELECT is((SELECT count(*)::INT FROM public.release_offer_source_rows WHERE source_row_number = 6), 1, 'excluding a group keeps the evidence for restore');
SELECT is((SELECT count(*)::INT FROM public.release_offer_resolution_events WHERE source_row_number = 6 AND event_type = 'deleted'), 1, 'excluding a group leaves an append-only audit event');

-- Owner-vs-imported head-to-head (P1-1, docs/REVIEW-RESPONSE-2026-08-20.md).
-- Format 06-00750 of 21000000001 carries a confirmed imported anchor of 11000
-- (row 3). An owner price must outrank it on every surface that reads the
-- resolved anchor -- release-price detail and favourites (release_price_market_view),
-- the wine card (wine_card_format_view) and scenarios (wine_scenario_view) --
-- without mutating the imported evidence the confirm/reset UI still drives.
SELECT is(
    (SELECT release_price_p FROM public.release_price_anchor_view
     WHERE parent_sku = '21000000001' AND format_code = '06-00750'),
    11000, 'the imported anchor is 11000 before any owner override');
SELECT is(
    public.set_owner_release_anchor('21000000001', '06-00750', 9900)->>'superseded_source_price_p',
    '11000', 'setting an owner price snapshots the imported anchor it supersedes');
SELECT is(
    (SELECT release_price_p FROM public.release_price_anchor_view
     WHERE parent_sku = '21000000001' AND format_code = '06-00750'),
    11000, 'the imported anchor view is unchanged by the owner override');
SELECT is(
    (SELECT count(*) FROM public.resolved_release_anchor_view
     WHERE parent_sku = '21000000001' AND format_code = '06-00750'),
    1::BIGINT, 'the resolved view returns a single anchor, not both branches');
SELECT is(
    (SELECT anchor_status || ':' || release_price_p FROM public.resolved_release_anchor_view
     WHERE parent_sku = '21000000001' AND format_code = '06-00750'),
    'owner:9900', 'the resolved view returns the owner price and status');
SELECT is(
    (SELECT release_price_p FROM public.release_price_market_view
     WHERE parent_sku = '21000000001' AND format_code = '06-00750'),
    9900, 'release-price detail and favourites (market view) show the owner price');
SELECT is(
    (SELECT release_price_p FROM public.wine_card_format_view
     WHERE parent_sku = '21000000001' AND format_code = '06-00750'),
    9900, 'the wine card shows the owner price');
SELECT is(
    (SELECT release_price_p FROM public.wine_scenario_view
     WHERE parent_sku = '21000000001' AND format_code = '06-00750'),
    9900, 'the scenario view shows the owner price');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated"}', TRUE);
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT public.begin_release_offer_match_run()', '42501', 'not authorised', 'non-owner cannot start matching');

SELECT * FROM finish();
ROLLBACK;
