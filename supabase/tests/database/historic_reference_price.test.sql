BEGIN;

SELECT plan(21);

INSERT INTO auth.users (id) VALUES
    ('71000000-0000-0000-0000-000000000001'),
    ('71000000-0000-0000-0000-000000000002');
INSERT INTO public.app_owners (user_id)
VALUES ('71000000-0000-0000-0000-000000000001');

-- Two accepted BBR snapshots cover the review case and the Poujeaux reference.
INSERT INTO public.cellar_imports (
    id, source_type, content_checksum, original_filename, byte_size,
    storage_object_path, uploaded_by, parser_version, status,
    source_row_count, parsed_row_count, unmatched_row_count, error_row_count,
    accepted_at, accepted_by, effective_date, accepted_role
) VALUES
    ('72000000-0000-0000-0000-000000000001', 'bbr_holdings', repeat('a', 64),
     'my-cellar-view-2020-02-01.csv', 100, 'reference-test/bbr-one.csv',
     '71000000-0000-0000-0000-000000000001', 'test', 'accepted',
     2, 2, 2, 0, TIMESTAMPTZ '2026-01-01',
     '71000000-0000-0000-0000-000000000001', DATE '2020-02-01', 'historical'),
    ('72000000-0000-0000-0000-000000000002', 'bbr_holdings', repeat('b', 64),
     'my-cellar-view-2020-03-01.csv', 100, 'reference-test/bbr-two.csv',
     '71000000-0000-0000-0000-000000000001', 'test', 'accepted',
     1, 1, 1, 0, TIMESTAMPTZ '2026-01-02',
     '71000000-0000-0000-0000-000000000001', DATE '2020-03-01', 'historical');

INSERT INTO public.cellar_import_rows (
    import_id, source_row_number, raw_row, match_status
) VALUES
    ('72000000-0000-0000-0000-000000000001', 1, '{}'::JSONB, 'unmatched'),
    ('72000000-0000-0000-0000-000000000001', 2, '{}'::JSONB, 'unmatched'),
    ('72000000-0000-0000-0000-000000000002', 1, '{}'::JSONB, 'unmatched');

INSERT INTO public.bbr_holding_evidence (
    import_id, source_row_number, parent_sku, format_code, catalogue_matched,
    product_code, description, bottle_volume_ml, quantity_bottles,
    eligible_for_bbx, purchase_price_per_case_p, case_size, current_status
) VALUES
    ('72000000-0000-0000-0000-000000000001', 1, '20108123480', '12-00750', FALSE,
     'poujeaux', '2010 Chateau Poujeaux', 750, 12, TRUE, 21000, 12, 'In bond'),
    ('72000000-0000-0000-0000-000000000001', 2, '20100000001', '06-00750', FALSE,
     'changing', 'Changing BBR wine', 750, 6, TRUE, 6000, 6, 'In bond'),
    ('72000000-0000-0000-0000-000000000002', 1, '20100000001', '06-00750', FALSE,
     'changing', 'Changing BBR wine', 750, 6, TRUE, 7200, 6, 'In bond');

-- The current CellarTracker snapshot supplies one agreeing Poujeaux price and
-- one CellarTracker-only wine.
INSERT INTO public.cellar_imports (
    id, source_type, content_checksum, original_filename, byte_size,
    storage_object_path, uploaded_by, parser_version, status,
    source_row_count, parsed_row_count, unmatched_row_count, error_row_count,
    accepted_at, accepted_by
) VALUES (
    '73000000-0000-0000-0000-000000000001', 'cellartracker_inventory', repeat('c', 64),
    'reference-ct.csv', 100, 'reference-test/ct.csv',
    '71000000-0000-0000-0000-000000000001', 'test', 'accepted',
    2, 2, 2, 0, TIMESTAMPTZ '2099-01-01',
    '71000000-0000-0000-0000-000000000001'
);
INSERT INTO public.cellar_import_rows (import_id, source_row_number, raw_row, match_status)
VALUES
    ('73000000-0000-0000-0000-000000000001', 1, '{}'::JSONB, 'unmatched'),
    ('73000000-0000-0000-0000-000000000001', 2, '{}'::JSONB, 'unmatched');
INSERT INTO public.cellartracker_evidence (
    import_id, source_row_number, source_wine, source_match_key, vintage,
    bottle_volume_ml, purchase_price_per_bottle_p, quantity_home, quantity_bbr,
    total_quantity, fully_consumed, producer
) VALUES
    ('73000000-0000-0000-0000-000000000001', 1, '2010 Chateau Poujeaux',
     'poujeaux', 2010, 750, 1751, 12, 0, 12, FALSE, 'BBR'),
    ('73000000-0000-0000-0000-000000000001', 2, 'CellarTracker only wine',
     'ct only', 2011, 750, 1555, 6, 0, 6, FALSE, 'BBR');
INSERT INTO public.cellartracker_product_resolutions (
    import_id, source_row_number, status, parent_sku, match_method, resolved_by
) VALUES
    ('73000000-0000-0000-0000-000000000001', 1, 'linked', '20108123480', 'manual',
     '71000000-0000-0000-0000-000000000001'),
    ('73000000-0000-0000-0000-000000000001', 2, 'linked', '20110000002', 'manual',
     '71000000-0000-0000-0000-000000000001');

-- No BBR or CellarTracker evidence exists for this wine. Its earlier offer
-- wins even though the later offer is cheaper.
INSERT INTO public.release_offer_imports (
    id, content_checksum, original_filename, byte_size, storage_object_path,
    imported_by, parser_version, status, accepted_at, accepted_by
) VALUES (
    '74000000-0000-0000-0000-000000000001', repeat('d', 64), 'reference-offers.csv',
    100, 'reference-test/offers.csv', '71000000-0000-0000-0000-000000000001',
    'test', 'accepted', TIMESTAMPTZ '2099-01-01', '71000000-0000-0000-0000-000000000001'
);
INSERT INTO public.release_offer_source_rows (
    import_id, source_row_number, raw_row, offer_date, source_wine,
    source_vintage, source_match_key, source_price_text, content_fingerprint
) VALUES
    ('74000000-0000-0000-0000-000000000001', 1, '{}'::JSONB, DATE '2012-01-01',
     'Offer-only wine', 2012, 'offer only', 'GBP 180 per 6', repeat('e', 64)),
    ('74000000-0000-0000-0000-000000000001', 2, '{}'::JSONB, DATE '2013-01-01',
     'Offer-only wine', 2012, 'offer only', 'GBP 120 per 6', repeat('f', 64));
INSERT INTO public.release_offer_prices (
    import_id, source_row_number, fragment_index, raw_price_text, amount_p,
    currency, case_size, bottle_volume_ml, format_code, tax_basis,
    parse_status, price_fingerprint
) VALUES
    ('74000000-0000-0000-0000-000000000001', 1, 1, 'GBP 180 per 6', 18000,
     'GBP', 6, 750, '06-00750', 'in_bond', 'valid', repeat('1', 64)),
    ('74000000-0000-0000-0000-000000000001', 2, 1, 'GBP 120 per 6', 12000,
     'GBP', 6, 750, '06-00750', 'in_bond', 'valid', repeat('2', 64));
INSERT INTO public.release_offer_product_resolutions (
    import_id, source_row_number, status, parent_sku, match_method, resolved_by
) VALUES
    ('74000000-0000-0000-0000-000000000001', 1, 'linked', '20120000003', 'manual',
     '71000000-0000-0000-0000-000000000001'),
    ('74000000-0000-0000-0000-000000000001', 2, 'linked', '20120000003', 'manual',
     '71000000-0000-0000-0000-000000000001');

SELECT is(has_table_privilege('anon', 'public.reference_price_decisions', 'SELECT'), FALSE,
    'anonymous users cannot read decisions');
SELECT is(has_table_privilege('anon', 'public.resolved_reference_price_view', 'SELECT'), FALSE,
    'anonymous users cannot read the resolver');
SELECT is(has_function_privilege('anon', 'public.set_reference_price(text,integer,date,text)', 'EXECUTE'), FALSE,
    'anonymous users cannot set a reference');

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;

SELECT is(
    (SELECT price_per_75cl_p FROM public.historic_reference_candidate_view
     WHERE parent_sku = '20108123480' AND source_kind = 'bbr'),
    1750, 'Poujeaux BBR case price is converted to GBP 17.50 per bottle'
);
SELECT is(
    (SELECT source_price_p FROM public.historic_reference_candidate_view
     WHERE parent_sku = '20108123480' AND source_kind = 'bbr'),
    21000, 'the candidate retains its original case price'
);
SELECT results_eq(
    $$ SELECT price_per_75cl_p, source_kind, needs_review, has_competing_evidence
       FROM public.resolved_reference_price_view WHERE parent_sku = '20108123480' $$,
    $$ VALUES (1750, 'bbr'::TEXT, FALSE, FALSE) $$,
    'BBR wins when CellarTracker agrees within one penny'
);
SELECT results_eq(
    $$ SELECT price_per_75cl_p, source_kind, needs_review
       FROM public.resolved_reference_price_view WHERE parent_sku = '20100000001' $$,
    $$ VALUES (1000, 'bbr'::TEXT, TRUE) $$,
    'the earliest changing BBR observation is selected and flagged'
);
SELECT results_eq(
    $$ SELECT price_per_75cl_p, source_kind
       FROM public.resolved_reference_price_view WHERE parent_sku = '20110000002' $$,
    $$ VALUES (1555, 'cellartracker'::TEXT) $$,
    'CellarTracker is selected when there is no BBR observation'
);
SELECT results_eq(
    $$ SELECT price_per_75cl_p, source_kind, has_competing_evidence
       FROM public.resolved_reference_price_view WHERE parent_sku = '20120000003' $$,
    $$ VALUES (3000, 'offer'::TEXT, TRUE) $$,
    'the earliest offer wins and the price range remains visible as competing evidence'
);
SELECT is(
    public.set_reference_price('20108123480', 1800, DATE '2020-02-01', 'manual correction')->>'price_per_75cl_p',
    '1800', 'the owner can set a wine-level reference price'
);
SELECT results_eq(
    $$ SELECT price_per_75cl_p, resolution_kind, has_current_support
       FROM public.resolved_reference_price_view WHERE parent_sku = '20108123480' $$,
    $$ VALUES (1800, 'owner'::TEXT, FALSE) $$,
    'an unsupported owner assertion remains visible without changing itself'
);
SELECT is(
    public.clear_reference_price('20108123480')->>'cleared', 'true',
    'the owner can clear the manual reference'
);
SELECT is(
    (SELECT price_per_75cl_p FROM public.resolved_reference_price_view
     WHERE parent_sku = '20108123480'),
    1750, 'clearing restores the automatic BBR reference'
);

RESET ROLE;
UPDATE public.cellartracker_evidence
SET purchase_price_per_bottle_p = 1600
WHERE import_id = '73000000-0000-0000-0000-000000000001'
  AND source_row_number = 2;
SET LOCAL ROLE authenticated;
SELECT is(
    (SELECT price_per_75cl_p FROM public.resolved_reference_price_view
     WHERE parent_sku = '20110000002'),
    1600, 'a corrected CellarTracker price reaches the resolver'
);

RESET ROLE;
UPDATE public.cellartracker_product_resolutions
SET parent_sku = '20110000004'
WHERE import_id = '73000000-0000-0000-0000-000000000001'
  AND source_row_number = 2;
SET LOCAL ROLE authenticated;
SELECT is(
    (SELECT count(*)::INT FROM public.resolved_reference_price_view
     WHERE parent_sku = '20110000002'),
    0, 'a relink removes the former wine reference'
);
SELECT is(
    (SELECT price_per_75cl_p FROM public.resolved_reference_price_view
     WHERE parent_sku = '20110000004'),
    1600, 'a relink moves the corrected price to the new wine'
);

RESET ROLE;
INSERT INTO public.cellartracker_record_decisions (
    match_group_key, source_wine, is_excluded, excluded_at
) VALUES (
    '2011|ct only', 'CellarTracker only wine', TRUE, now()
)
ON CONFLICT (match_group_key, source_wine) DO UPDATE
SET is_excluded = TRUE, excluded_at = now();
SET LOCAL ROLE authenticated;
SELECT is(
    (SELECT count(*)::INT FROM public.resolved_reference_price_view
     WHERE parent_sku = '20110000004'),
    0, 'excluding the CellarTracker record removes the reference'
);

SELECT is(
    (SELECT count(*)::INT
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('catalogue_view', 'catalogue_mv')
       AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname IN ('reference_price_p', 'release_price_p',
                         'purchase_price_per_bottle_p')),
    0, 'public catalogue read models contain no private reference price'
);

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"71000000-0000-0000-0000-000000000002","role":"authenticated"}',
    TRUE
);
SELECT throws_ok(
    $$ SELECT public.set_reference_price('20108123480', 1800) $$,
    '42501', 'not authorised', 'a non-owner cannot set a reference'
);
SELECT is(
    (SELECT count(*)::INT FROM public.resolved_reference_price_view), 0,
    'a non-owner cannot read resolved private references'
);
SELECT is(
    (SELECT count(*)::INT FROM public.historic_reference_candidate_view), 0,
    'a non-owner cannot read source candidates'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
