BEGIN;
SELECT plan(18);

INSERT INTO auth.users (id) VALUES ('11000000-0000-0000-0000-000000000001'), ('11000000-0000-0000-0000-000000000002');
INSERT INTO public.app_owners (user_id) VALUES ('11000000-0000-0000-0000-000000000001');
INSERT INTO public.scan_runs (id, scope, run_date, status, started_at) VALUES ('21000000-0000-0000-0000-000000000001', 'release-test', DATE '2026-07-27', 'completed', now());
INSERT INTO public.products (parent_sku, name, vintage, region, colour, producer, product_url, first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at, last_rest_checked_at)
VALUES ('21000000001', 'Test release wine 2018', 2018, 'Bordeaux', 'Red', 'Test producer', '/products-21000000001-test-release-wine', '21000000-0000-0000-0000-000000000001', now(), '21000000-0000-0000-0000-000000000001', now(), now());
INSERT INTO public.skus (parent_sku, format_code, case_size, bottle_volume_ml, least_listing_price_p, market_price_p, highest_bid_p, is_listed, first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at)
VALUES ('21000000001', '06-00750', 6, 750, 9000, 9500, 8000, TRUE, '21000000-0000-0000-0000-000000000001', now(), '21000000-0000-0000-0000-000000000001', now());

SELECT is(has_table_privilege('anon', 'public.release_offer_product_resolutions', 'SELECT'), FALSE, 'anon cannot read product resolutions');
SELECT is(has_table_privilege('authenticated', 'public.release_offer_product_resolutions', 'SELECT'), TRUE, 'authenticated has owner-gated read grant');
SELECT is(has_function_privilege('anon', 'public.delete_release_offer_import(uuid)', 'EXECUTE'), FALSE, 'anon cannot delete imports');

SELECT set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}', TRUE);
SET LOCAL ROLE authenticated;
SELECT is(public.begin_release_offer_import('31000000-0000-0000-0000-000000000001', repeat('a', 64), 'release-test.csv', 2000, '11000000-0000-0000-0000-000000000001/31000000-0000-0000-0000-000000000001/release-offers.csv', 'release-offers-v2')->>'status', 'staging', 'owner can begin manual CSV import');
SELECT is(public.stage_release_offer_batch('31000000-0000-0000-0000-000000000001', '[
 {"source_row_number":2,"raw_row":{"Wine":"Test release wine 2018"},"offer_date":"2019-01-01","source_wine":"Test release wine 2018","source_vintage":2018,"source_match_key":"test release wine","source_price_text":"£100 per 6 bottles in bond","source_product_id":"99999999999","content_fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","validation_errors":[],"validation_warnings":[],"prices":[{"fragment_index":1,"raw_price_text":"£100 per 6 bottles in bond","amount_p":10000,"currency":"GBP","case_size":6,"bottle_volume_ml":750,"format_code":"06-00750","tax_basis":"in_bond","parse_status":"valid","price_fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","validation_warnings":[]}]},
 {"source_row_number":3,"raw_row":{"Wine":"Test release wine 2018"},"offer_date":"2019-01-02","source_wine":"Test release wine 2018","source_vintage":2018,"source_match_key":"test release wine","source_price_text":"£110 per 6 bottles in bond","content_fingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","validation_errors":[],"validation_warnings":[],"prices":[{"fragment_index":1,"raw_price_text":"£110 per 6 bottles in bond","amount_p":11000,"currency":"GBP","case_size":6,"bottle_volume_ml":750,"format_code":"06-00750","tax_basis":"in_bond","parse_status":"valid","price_fingerprint":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","validation_warnings":[]}]}
]'::jsonb)->>'source_row_count', '2', 'raw rows stage separately from prices');
SELECT is(public.mark_release_offer_import_staged('31000000-0000-0000-0000-000000000001', 2, 2)->>'status', 'staged', 'ETL marks the import staged');
SELECT is(public.run_release_offer_matching('31000000-0000-0000-0000-000000000001')->>'linked_row_count', '2', 'direct off-catalogue ID and exact fallback link');
SELECT is((SELECT parent_sku FROM public.release_offer_product_resolutions WHERE import_id = '31000000-0000-0000-0000-000000000001' AND source_row_number = 2), '99999999999', 'direct ID does not require a catalogue row');
SELECT is((SELECT match_method FROM public.release_offer_product_resolutions WHERE import_id = '31000000-0000-0000-0000-000000000001' AND source_row_number = 3), 'exact_name_vintage', 'exact fallback is recorded');
SELECT is(public.ignore_release_offer_row('31000000-0000-0000-0000-000000000001', 3)->>'status', 'ignored', 'owner can ignore a row');
SELECT is(public.run_release_offer_matching('31000000-0000-0000-0000-000000000001')->>'ignored_row_count', '1', 'matching preserves ignored rows');
SELECT is(public.clear_release_offer_product_resolution('31000000-0000-0000-0000-000000000001', 3)->>'status', 'unresolved', 'clearing restores unresolved state');
SELECT is(public.set_release_offer_product_resolution('31000000-0000-0000-0000-000000000001', 3, '88888888888')->>'match_method', 'manual', 'manual link overrides automatic match');
SELECT is(public.accept_release_offer_import('31000000-0000-0000-0000-000000000001')->>'status', 'accepted', 'staged import can be accepted');
SELECT is(public.run_release_offer_matching('31000000-0000-0000-0000-000000000001')->>'import_id', '31000000-0000-0000-0000-000000000001', 'accepted imports can be rescanned');
SELECT is((SELECT count(*)::int FROM public.release_offer_evidence_view), 1, 'only accepted linked in-bond evidence is published');
SELECT is(public.delete_release_offer_import('31000000-0000-0000-0000-000000000001')->>'storage_object_path', '11000000-0000-0000-0000-000000000001/31000000-0000-0000-0000-000000000001/release-offers.csv', 'deletion returns stored object path');
SELECT is((SELECT count(*)::int FROM public.release_offer_source_rows WHERE import_id = '31000000-0000-0000-0000-000000000001'), 0, 'import deletion cascades raw rows and resolutions');
SELECT * FROM finish();
ROLLBACK;
