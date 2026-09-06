BEGIN;
SELECT plan(19);

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
) VALUES (
    '33333333-3333-3333-3333-333333333331', 1, '{}', DATE '2018-01-01',
    '2017 Ch. Lynch-Bages, Pauillac', 2017, 'ch lynch bages pauillac',
    '£600 per 6 in bond', repeat('b', 64)
);
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
    '11111111-1111-1111-1111-111111111111', 'running', 1, 1
);
INSERT INTO public.release_offer_match_run_groups (
    run_id, match_group_key, source_match_key, source_vintage, source_wine,
    source_row_count, status
) VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2017|ch lynch bages pauillac',
    'ch lynch bages pauillac', 2017, '2017 Ch. Lynch-Bages, Pauillac', 1, 'pending'
);

SELECT lives_ok(
    $$ SELECT public.record_release_offer_algolia_result(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '2017|ch lynch bages pauillac',
        '[{"rank":1,"parent_sku":"20178004817","name":"2017 Chateau Lynch-Bages, Pauillac, Bordeaux","vintage":2017,"match_score":0.75,"algorithm_version":"wine-identity-v2.0.0","evidence_score":1,"score_margin":null,"review_band":"likely","risk_flags":[],"match_reasons":["approved_alias_normalised","canonical_name_exact","vintage_agreement"],"comparison_evidence":{"canonical_exact":true}}]'::JSONB,
        ARRAY[]::TEXT[], TRUE, now()
    ) $$,
    'release result recording accepts a complete v2 candidate'
);
SELECT is(
    (SELECT algorithm_version FROM public.release_offer_match_suggestions
      WHERE match_group_key = '2017|ch lynch bages pauillac' AND rank = 1),
    'wine-identity-v2.0.0',
    'release suggestions store the algorithm version'
);
SELECT is(
    (SELECT algorithm_version FROM public.release_offer_match_runs
      WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    'wine-identity-v2.0.0',
    'the release run records the candidate algorithm version'
);
SELECT is(
    (SELECT impact_band FROM public.release_offer_match_suggestions
      WHERE match_group_key = '2017|ch lynch bages pauillac' AND rank = 1),
    'current_market',
    'release impact combines valid price evidence with observed eligibility'
);
SELECT is(
    (SELECT review_priority FROM public.release_offer_match_suggestions
      WHERE match_group_key = '2017|ch lynch bages pauillac' AND rank = 1),
    10::SMALLINT,
    'the database calculates likely current-market priority'
);
SELECT is(
    (SELECT (comparison_evidence->>'valid_in_bond_fragment_count')::INT
     FROM public.release_offer_match_suggestions
     WHERE match_group_key = '2017|ch lynch bages pauillac' AND rank = 1),
    1,
    'release comparison evidence records the valid in-bond fragment count'
);
SELECT is(
    (SELECT (comparison_evidence->>'valid_format_count')::INT
     FROM public.release_offer_match_suggestions
     WHERE match_group_key = '2017|ch lynch bages pauillac' AND rank = 1),
    1,
    'release comparison evidence records the distinct format count'
);
SELECT is_empty(
    $$ SELECT 1 FROM public.release_offer_product_resolutions
       WHERE import_id = '33333333-3333-3333-3333-333333333331' $$,
    'a likely alias match does not auto-link without exact Parent ID evidence'
);
SELECT is(
    (public.record_release_offer_algolia_result(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '2017|ch lynch bages pauillac', '[]', ARRAY[]::TEXT[], FALSE, now()
    )->>'already_processed')::BOOLEAN,
    TRUE,
    'recording the same processed run group is idempotent'
);

UPDATE public.release_offer_match_run_groups
SET status = 'pending', processed_at = NULL
WHERE run_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

SELECT throws_ok(
    $$ SELECT public.record_release_offer_algolia_result(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2017|ch lynch bages pauillac',
        '[{"rank":2,"parent_sku":"20178004817","name":"Wine","algorithm_version":"v2","evidence_score":0.8,"score_margin":0.1,"review_band":"likely","comparison_evidence":{}}]'::JSONB,
        ARRAY[]::TEXT[], FALSE, now()) $$,
    '22023', 'score_margin is only valid for rank 1',
    'a non-rank-1 score margin is rejected'
);
SELECT throws_ok(
    $$ SELECT public.record_release_offer_algolia_result(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2017|ch lynch bages pauillac',
        '[{"rank":1,"parent_sku":"20178004817","name":"Wine","algorithm_version":"v2","evidence_score":0.8,"review_band":"certain","comparison_evidence":{}}]'::JSONB,
        ARRAY[]::TEXT[], FALSE, now()) $$,
    '23514', NULL,
    'an unknown review band is rejected'
);
SELECT throws_ok(
    $$ SELECT public.record_release_offer_algolia_result(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2017|ch lynch bages pauillac',
        '[{"rank":1,"parent_sku":"20178004817","name":"Wine","algorithm_version":"v2","evidence_score":0.8,"review_band":"likely","comparison_evidence":[]}]'::JSONB,
        ARRAY[]::TEXT[], FALSE, now()) $$,
    '23514', NULL,
    'non-object comparison evidence is rejected'
);
SELECT throws_ok(
    $$ SELECT public.record_release_offer_algolia_result(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2017|ch lynch bages pauillac',
        '[{},{},{},{},{},{}]'::JSONB, ARRAY[]::TEXT[], FALSE, now()) $$,
    '22023', 'p_candidates must be an array of at most five results',
    'more than five candidates are rejected'
);

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
        '[{"rank":1,"parent_sku":"20178004817","name":"2017 Chateau Lynch-Bages","vintage":2017,"match_score":1,"algorithm_version":"wine-identity-v2.0.0","evidence_score":1,"score_margin":null,"review_band":"likely","risk_flags":[],"match_reasons":["canonical_name_exact"],"comparison_evidence":{"canonical_exact":true}}]'::JSONB,
        NULL, now()) $$,
    'CellarTracker result recording accepts a complete v2 candidate'
);
SELECT is(
    (SELECT impact_band FROM public.cellartracker_match_suggestions
      WHERE match_group_key = '2017|chateau lynch bages' AND rank = 1),
    'current_market',
    'CellarTracker impact combines positive quantity with observed eligibility'
);
SELECT is(
    (SELECT algorithm_version FROM public.cellartracker_match_runs
      WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    'wine-identity-v2.0.0',
    'the CellarTracker run records the candidate algorithm version'
);
SELECT is(
    (SELECT review_priority FROM public.cellartracker_match_suggestions
      WHERE match_group_key = '2017|chateau lynch bages' AND rank = 1),
    10::SMALLINT,
    'CellarTracker priority is calculated by the database'
);
SELECT is(
    (SELECT (comparison_evidence->>'total_quantity')::INT
     FROM public.cellartracker_match_suggestions
     WHERE match_group_key = '2017|chateau lynch bages' AND rank = 1),
    6,
    'CellarTracker comparison evidence records current quantity'
);
SELECT is_empty(
    $$ SELECT 1 FROM public.cellartracker_product_resolutions
       WHERE import_id = '22222222-2222-2222-2222-222222222221' $$,
    'a likely v2 score does not widen CellarTracker auto-linking'
);

SELECT * FROM finish();
ROLLBACK;
