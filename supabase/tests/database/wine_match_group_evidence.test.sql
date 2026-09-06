BEGIN;
SELECT plan(17);

INSERT INTO auth.users (id) VALUES ('11111111-1111-1111-1111-111111111111');
INSERT INTO public.app_owners (user_id) VALUES ('11111111-1111-1111-1111-111111111111');
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    TRUE
);

INSERT INTO private.products (parent_sku, name, vintage, first_seen_at, last_seen_at)
VALUES ('20178004817', '2017 Chateau Lynch-Bages', 2017, now(), now());
INSERT INTO private.skus (
    parent_sku, format_code, case_size, bottle_volume_ml, first_seen_at, last_seen_at
) VALUES ('20178004817', '06-00750', 6, 750, now(), now());
SELECT private.rebuild_catalogue_caches();

-- Release fixture ---------------------------------------------------------

INSERT INTO public.release_offer_imports (
    id, content_checksum, original_filename, byte_size, storage_object_path,
    imported_by, parser_version, status, accepted_at, accepted_by
) VALUES (
    '33333333-3333-3333-3333-333333333331', repeat('a', 64), 'offers.csv', 100,
    'release-offers/test.csv', '11111111-1111-1111-1111-111111111111',
    'test', 'accepted', now(), '11111111-1111-1111-1111-111111111111'
);
INSERT INTO public.release_offer_source_rows (
    import_id, source_row_number, raw_row, offer_date, source_wine,
    source_vintage, source_match_key, source_price_text, content_fingerprint
) VALUES
    ('33333333-3333-3333-3333-333333333331', 1, '{}', DATE '2018-01-01',
     '2017 Ch. Lynch-Bages, Pauillac', 2017, 'ch lynch bages pauillac',
     '£600 per 6 in bond', repeat('b', 64)),
    ('33333333-3333-3333-3333-333333333331', 2, '{}', DATE '2018-01-01',
     '2016 Ch. Margaux', 2016, 'ch margaux', '£500 per 6', repeat('e', 64));
INSERT INTO public.release_offer_prices (
    import_id, source_row_number, fragment_index, raw_price_text, amount_p,
    currency, case_size, bottle_volume_ml, format_code, tax_basis, parse_status,
    price_fingerprint
) VALUES (
    '33333333-3333-3333-3333-333333333331', 1, 1, '£600 per 6 in bond',
    60000, 'GBP', 6, 750, '06-00750', 'in_bond', 'valid', repeat('c', 64)
);
INSERT INTO public.release_offer_match_runs (id, started_by, status, total_group_count, remaining_group_count)
VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111', 'running', 2, 2
);
INSERT INTO public.release_offer_match_run_groups (
    run_id, match_group_key, source_match_key, source_vintage, source_wine,
    source_row_count, status
) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2017|ch lynch bages pauillac',
     'ch lynch bages pauillac', 2017, '2017 Ch. Lynch-Bages, Pauillac', 1, 'pending'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2016|ch margaux',
     'ch margaux', 2016, '2016 Ch. Margaux', 1, 'pending');

-- A pending group has no evidence row: the run-group trigger only fires on a
-- non-pending transition (begin_*_match_run inserts thousands of pending rows).
SELECT is_empty(
    $$ SELECT 1 FROM public.wine_match_group_evidence
       WHERE source = 'release_offer' AND match_group_key = '2017|ch lynch bages pauillac' $$,
    'a pending group carries no evidence row'
);

-- Recording a rank-1 result fires the trigger and fills the row -----------

SELECT lives_ok(
    $$ SELECT public.record_release_offer_algolia_result(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '2017|ch lynch bages pauillac',
        '[{"rank":1,"parent_sku":"20178004817","name":"2017 Chateau Lynch-Bages, Pauillac, Bordeaux","vintage":2017,"match_score":0.75,"matched_words":["ch","lynch","bages","pauillac"],"typo_count":0,"algorithm_version":"wine-identity-v2.0.0","evidence_score":1,"score_margin":null,"review_band":"likely","risk_flags":[],"match_reasons":["canonical_name_exact","vintage_agreement"],"comparison_evidence":{"canonical_exact":true}}]'::JSONB,
        ARRAY[]::TEXT[], TRUE, now()
    ) $$,
    'release result recording succeeds'
);

SELECT results_eq(
    $$ SELECT suggestion_count, last_run_status, last_error_at, review_band,
              review_priority, coverage_tier, token_coverage, second_wine_conflict,
              top_candidate_parent_sku
       FROM public.wine_match_group_evidence
       WHERE source = 'release_offer' AND match_group_key = '2017|ch lynch bages pauillac' $$,
    $$ VALUES (1, 'processed', NULL::timestamptz, 'likely', 10::SMALLINT, 'full',
              1::double precision, FALSE, '20178004817') $$,
    'the trigger recomputes the full evidence row from the recorded result'
);

SELECT is(
    (SELECT suggestion_count FROM public.release_offer_match_review_view
     WHERE match_group_key = '2017|ch lynch bages pauillac'),
    1,
    'release_offer_match_review_view reads suggestion_count from the table'
);
SELECT is(
    (SELECT last_run_status FROM public.release_offer_match_review_view
     WHERE match_group_key = '2017|ch lynch bages pauillac'),
    'processed',
    'release_offer_match_review_view reads last_run_status from the table'
);
SELECT is(
    (SELECT unresolved_row_count FROM public.release_offer_match_review_view
     WHERE match_group_key = '2017|ch lynch bages pauillac'),
    1,
    'the resolution count stays live in the view, not the table'
);

SELECT results_eq(
    $$ SELECT suggestion_count, review_band, review_priority, evidence_score,
              coverage_tier, second_wine_conflict, top_candidate_parent_sku
       FROM public.wine_match_review_view
       WHERE source = 'release_offer' AND match_group_key = '2017|ch lynch bages pauillac' $$,
    $$ VALUES (1, 'likely', 10::SMALLINT, 1.0000::numeric, 'full', FALSE, '20178004817') $$,
    'wine_match_review_view exposes the same v2 evidence'
);

SELECT is(
    (SELECT with_suggestions FROM public.wine_match_queue_summary(NULL)),
    1::bigint,
    'wine_match_queue_summary still counts the workable group'
);

-- Error recording sets the failed status through the same trigger --------

SELECT lives_ok(
    $$ SELECT public.record_release_offer_algolia_error(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2016|ch margaux', 'Algolia timed out'
    ) $$,
    'release error recording succeeds'
);
SELECT is(
    (SELECT last_run_status FROM public.wine_match_group_evidence
     WHERE source = 'release_offer' AND match_group_key = '2016|ch margaux'),
    'failed',
    'the error trigger records the failed status'
);
SELECT ok(
    (SELECT last_error_at IS NOT NULL FROM public.wine_match_group_evidence
     WHERE source = 'release_offer' AND match_group_key = '2016|ch margaux'),
    'the error trigger records last_error_at'
);
SELECT is(
    (SELECT last_run_status FROM public.wine_match_review_view
     WHERE source = 'release_offer' AND match_group_key = '2016|ch margaux'),
    'failed',
    'wine_match_review_view surfaces the failed status'
);

-- Full rebuild reproduces the incrementally-maintained state ------------

SELECT private.rebuild_wine_match_group_evidence();
SELECT results_eq(
    $$ SELECT suggestion_count, last_run_status, review_band, review_priority,
              coverage_tier, top_candidate_parent_sku
       FROM public.wine_match_group_evidence
       WHERE source = 'release_offer' AND match_group_key = '2017|ch lynch bages pauillac' $$,
    $$ VALUES (1, 'processed', 'likely', 10::SMALLINT, 'full', '20178004817') $$,
    'rebuild reproduces the processed group'
);
SELECT is(
    (SELECT last_run_status FROM public.wine_match_group_evidence
     WHERE source = 'release_offer' AND match_group_key = '2016|ch margaux'),
    'failed',
    'rebuild reproduces the failed group'
);

-- CellarTracker parity -------------------------------------------------

INSERT INTO public.cellar_imports (
    id, source_type, content_checksum, original_filename, byte_size,
    storage_object_path, uploaded_by, parser_version, status, accepted_at, accepted_by
) VALUES (
    '22222222-2222-2222-2222-222222222221', 'cellartracker_inventory',
    repeat('d', 64), 'cellar.csv', 100, 'cellartracker/test.csv',
    '11111111-1111-1111-1111-111111111111', 'test', 'accepted', now(),
    '11111111-1111-1111-1111-111111111111'
);
INSERT INTO public.cellar_import_rows (import_id, source_row_number, raw_row, match_status)
VALUES ('22222222-2222-2222-2222-222222222221', 1, '{}', 'unmatched');
INSERT INTO public.cellartracker_evidence (
    import_id, source_row_number, source_wine, source_match_key, vintage,
    bottle_volume_ml, quantity_home, quantity_bbr, total_quantity,
    fully_consumed, producer
) VALUES (
    '22222222-2222-2222-2222-222222222221', 1, 'Chateau Lynch-Bages',
    'chateau lynch bages', 2017, 750, 6, 0, 6, FALSE, 'Chateau Lynch-Bages'
);
INSERT INTO public.cellartracker_match_runs (
    id, snapshot_import_id, started_by, status, total_group_count, remaining_group_count
) VALUES (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222221',
    '11111111-1111-1111-1111-111111111111', 'running', 1, 1
);
INSERT INTO public.cellartracker_match_run_groups (
    run_id, match_group_key, source_match_key, source_vintage, source_wine,
    source_producer, source_row_count, status
) VALUES (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2017|chateau lynch bages',
    'chateau lynch bages', 2017, 'Chateau Lynch-Bages', 'Chateau Lynch-Bages', 1, 'pending'
);
SELECT lives_ok(
    $$ SELECT public.record_cellartracker_algolia_result(
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2017|chateau lynch bages',
        '[{"rank":1,"parent_sku":"20178004817","name":"2017 Chateau Lynch-Bages","vintage":2017,"match_score":1,"matched_words":["chateau","lynch","bages"],"typo_count":0,"algorithm_version":"wine-identity-v2.0.0","evidence_score":1,"score_margin":null,"review_band":"likely","risk_flags":[],"match_reasons":["canonical_name_exact"],"comparison_evidence":{"canonical_exact":true}}]'::JSONB,
        NULL, now()) $$,
    'CellarTracker result recording succeeds'
);
SELECT results_eq(
    $$ SELECT suggestion_count, last_run_status, review_band, coverage_tier,
              top_candidate_parent_sku
       FROM public.wine_match_group_evidence
       WHERE source = 'cellartracker' AND match_group_key = '2017|chateau lynch bages' $$,
    $$ VALUES (1, 'processed', 'likely', 'full', '20178004817') $$,
    'the CellarTracker trigger fills its evidence row'
);
SELECT is(
    (SELECT review_band FROM public.wine_match_review_view
     WHERE source = 'cellartracker' AND match_group_key = '2017|chateau lynch bages'),
    'likely',
    'wine_match_review_view exposes CellarTracker v2 evidence'
);

SELECT * FROM finish();
ROLLBACK;
