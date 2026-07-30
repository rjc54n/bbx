-- Owner decisions survive the next upload.
--
-- The promise under test: after the owner links a wine, corrects a price or
-- excludes a bad record, accepting the next CellarTracker snapshot re-applies
-- all three rather than arriving blank. Exclusions are checked from both ends
-- -- hidden from the read views, but still present as evidence, so restoring
-- is one call rather than a re-import.
--
-- Two CellarTracker imports are used because current_cellartracker_records
-- exposes only the latest accepted snapshot. Import 1 is where the decisions
-- are made; import 2 is staged and then accepted, which is the moment the
-- carry-forward has to work. accepted_at is dated 2099 so the fixtures win
-- over any real local snapshot.

BEGIN;

SELECT plan(24);

INSERT INTO auth.users (id)
VALUES ('11111111-1111-1111-1111-111111111111');

INSERT INTO public.app_owners (user_id)
VALUES ('11111111-1111-1111-1111-111111111111');

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    TRUE
);

-- Snapshot one is accepted; snapshot two is staged, ready to accept.

INSERT INTO public.cellar_imports (
    id, source_type, content_checksum, original_filename, byte_size,
    storage_object_path, uploaded_by, parser_version, status,
    source_row_count, parsed_row_count, error_row_count,
    accepted_at, accepted_by
)
VALUES
    (
        '22222222-2222-2222-2222-222222222221', 'cellartracker_inventory',
        repeat('a', 64), 'ct-one.csv', 1024, 'cellartracker/test-one.csv',
        '11111111-1111-1111-1111-111111111111', 'test', 'accepted',
        4, 4, 0,
        TIMESTAMPTZ '2099-01-01', '11111111-1111-1111-1111-111111111111'
    ),
    (
        '22222222-2222-2222-2222-222222222222', 'cellartracker_inventory',
        repeat('b', 64), 'ct-two.csv', 1024, 'cellartracker/test-two.csv',
        '11111111-1111-1111-1111-111111111111', 'test', 'validated',
        5, 5, 0,
        NULL, NULL
    );

INSERT INTO public.cellar_import_rows (import_id, source_row_number, raw_row, match_status)
VALUES
    ('22222222-2222-2222-2222-222222222221', 1, '{"Price":"40.00"}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222221', 2, '{"Price":"41.00"}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222221', 3, '{"Price":"42.00"}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222221', 4, '{"Price":"43.00"}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222222', 1, '{"Price":"40.00"}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222222', 2, '{"Price":"41.00"}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222222', 3, '{"Price":"42.00"}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222222', 4, '{"Price":"43.00"}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222222', 5, '{"Price":"44.00"}'::JSONB, 'unmatched');

-- Row 1 is linked, row 2 has its price corrected, row 3 is excluded and row 4
-- is left alone. Snapshot two repeats all four and adds a fifth. Row 2 keeps
-- the same source price in snapshot two; row 4 is the control.
INSERT INTO public.cellartracker_evidence (
    import_id, source_row_number, source_wine, source_match_key, vintage,
    bottle_volume_ml, purchase_price_per_bottle_p, quantity_home, quantity_bbr,
    total_quantity, fully_consumed, producer
)
VALUES
    ('22222222-2222-2222-2222-222222222221', 1, 'Linked Wine', 'linked wine', 2010, 750, 4000, 6, 0, 6, FALSE, 'Test Producer'),
    ('22222222-2222-2222-2222-222222222221', 2, 'Priced Wine', 'priced wine', 2011, 750, 4100, 6, 0, 6, FALSE, 'Test Producer'),
    ('22222222-2222-2222-2222-222222222221', 3, 'Excluded Wine', 'excluded wine', 2012, 750, 4200, 6, 0, 6, FALSE, 'Test Producer'),
    ('22222222-2222-2222-2222-222222222221', 4, 'Untouched Wine', 'untouched wine', 2013, 750, 4300, 6, 0, 6, FALSE, 'Test Producer'),
    ('22222222-2222-2222-2222-222222222222', 1, 'Linked Wine', 'linked wine', 2010, 750, 4000, 6, 0, 6, FALSE, 'Test Producer'),
    ('22222222-2222-2222-2222-222222222222', 2, 'Priced Wine', 'priced wine', 2011, 750, 4100, 6, 0, 6, FALSE, 'Test Producer'),
    ('22222222-2222-2222-2222-222222222222', 3, 'Excluded Wine', 'excluded wine', 2012, 750, 4200, 6, 0, 6, FALSE, 'Test Producer'),
    ('22222222-2222-2222-2222-222222222222', 4, 'Untouched Wine', 'untouched wine', 2013, 750, 4300, 6, 0, 6, FALSE, 'Test Producer'),
    ('22222222-2222-2222-2222-222222222222', 5, 'Brand New Wine', 'brand new wine', 2014, 750, 4400, 6, 0, 6, FALSE, 'Test Producer');

-- Release offers: one accepted import, and a second one repeating the same
-- offer so the exclusion can be tested across imports by content fingerprint.

INSERT INTO public.release_offer_imports (
    id, content_checksum, original_filename, byte_size,
    storage_object_path, imported_by, parser_version, status,
    accepted_at, accepted_by
)
VALUES
    (
        '33333333-3333-3333-3333-333333333331',
        repeat('c', 64), 'offers-one.csv', 1024, 'release-offers/test-one.csv',
        '11111111-1111-1111-1111-111111111111', 'test', 'accepted',
        TIMESTAMPTZ '2099-01-01', '11111111-1111-1111-1111-111111111111'
    ),
    (
        '33333333-3333-3333-3333-333333333332',
        repeat('e', 64), 'offers-two.csv', 1024, 'release-offers/test-two.csv',
        '11111111-1111-1111-1111-111111111111', 'test', 'accepted',
        TIMESTAMPTZ '2099-02-01', '11111111-1111-1111-1111-111111111111'
    );

INSERT INTO public.release_offer_source_rows (
    import_id, source_row_number, raw_row, offer_date, source_wine,
    source_vintage, source_match_key, source_price_text, content_fingerprint
)
VALUES
    (
        '33333333-3333-3333-3333-333333333331', 1, '{}'::JSONB, DATE '2026-01-15',
        'Offer Wine 2014', 2014, 'offer wine', '£900 per 6', repeat('d', 64)
    ),
    (
        '33333333-3333-3333-3333-333333333331', 2, '{}'::JSONB, DATE '2026-01-15',
        'Kept Wine 2015', 2015, 'kept wine', '£600 per 6', repeat('f', 64)
    ),
    -- The same offer, arriving again in a later file: same fingerprint.
    (
        '33333333-3333-3333-3333-333333333332', 1, '{}'::JSONB, DATE '2026-01-15',
        'Offer Wine 2014', 2014, 'offer wine', '£900 per 6', repeat('d', 64)
    );

INSERT INTO private.products (parent_sku, name, vintage, first_seen_at, last_seen_at)
VALUES ('20140000001', 'Offer Wine 2014', 2014, now(), now())
ON CONFLICT (parent_sku) DO NOTHING;

INSERT INTO private.skus (
    parent_sku, format_code, case_size, bottle_volume_ml, first_seen_at, last_seen_at
)
VALUES ('20140000001', '06-00750', 6, 750, now(), now())
ON CONFLICT (parent_sku, format_code) DO NOTHING;

INSERT INTO public.release_offer_prices (
    import_id, source_row_number, fragment_index, raw_price_text,
    amount_p, currency, case_size, bottle_volume_ml, format_code,
    tax_basis, parse_status, price_fingerprint
)
VALUES
    (
        '33333333-3333-3333-3333-333333333331', 1, 1, '£900 per 6',
        90000, 'GBP', 6, 750, '06-00750', 'in_bond', 'valid', repeat('1', 64)
    ),
    (
        '33333333-3333-3333-3333-333333333331', 2, 1, '£600 per 6',
        60000, 'GBP', 6, 750, '06-00750', 'in_bond', 'valid', repeat('2', 64)
    );

INSERT INTO public.release_offer_product_resolutions (
    import_id, source_row_number, status, parent_sku, match_method, resolved_by
)
VALUES
    (
        '33333333-3333-3333-3333-333333333331', 1, 'linked', '20140000001',
        'manual', '11111111-1111-1111-1111-111111111111'
    ),
    (
        '33333333-3333-3333-3333-333333333331', 2, 'linked', '20140000001',
        'manual', '11111111-1111-1111-1111-111111111111'
    );

-- 1-2. The delete functions are replaced by exclusion, which is reversible.

SELECT hasnt_function('public', 'delete_cellartracker_record', ARRAY['uuid', 'integer'],
    'deleting a CellarTracker record outright is no longer possible');
SELECT hasnt_function('public', 'delete_release_offer_record', ARRAY['uuid', 'integer'],
    'deleting a release-offer record outright is no longer possible');

-- 3. A link made on the current snapshot is recorded as a durable decision.

INSERT INTO public.cellartracker_product_resolutions (
    import_id, source_row_number, status, parent_sku, match_method, resolved_by
)
VALUES (
    '22222222-2222-2222-2222-222222222221', 1, 'linked', '20100000001',
    'manual', '11111111-1111-1111-1111-111111111111'
);

SELECT is(
    (SELECT parent_sku FROM public.cellartracker_record_decisions
     WHERE match_group_key = '2010|linked wine' AND source_wine = 'Linked Wine'),
    '20100000001',
    'linking a record records the decision against the match group'
);

-- 4-5. A price correction records both the new value and the file value it
-- replaced, so a later import can tell a stale source from a changed one.

SELECT lives_ok(
    $$SELECT public.update_cellartracker_record_price(
        '22222222-2222-2222-2222-222222222221', 2, 3900
    )$$,
    'the owner can correct a price on the accepted snapshot'
);

SELECT results_eq(
    $$SELECT purchase_price_per_bottle_p, source_price_per_bottle_p
      FROM public.cellartracker_record_decisions
      WHERE match_group_key = '2011|priced wine'$$,
    $$VALUES (3900, 4100)$$,
    'the correction keeps the source value it replaced'
);

-- 6-8. Excluding a record hides it without destroying it.

SELECT lives_ok(
    $$SELECT public.exclude_cellartracker_record(
        '22222222-2222-2222-2222-222222222221', 3
    )$$,
    'the owner can exclude a record from the accepted snapshot'
);

SELECT is(
    (SELECT count(*)::INT FROM public.current_cellartracker_records
     WHERE source_wine = 'Excluded Wine'),
    0,
    'an excluded record is hidden from the CellarTracker surface'
);

SELECT is(
    (SELECT count(*)::INT FROM public.cellartracker_evidence
     WHERE import_id = '22222222-2222-2222-2222-222222222221'
       AND source_row_number = 3),
    1,
    'the evidence row survives exclusion, so the decision is reversible'
);

-- 9. The excluded record is listed for restore, flagged as still in the file.

SELECT results_eq(
    $$SELECT source_wine, in_current_snapshot
      FROM public.cellartracker_excluded_record_view$$,
    $$VALUES ('Excluded Wine'::TEXT, TRUE)$$,
    'an excluded record is listed for restore'
);

-- 10. Excluded records are not offered for matching.

SELECT is(
    (SELECT count(*)::INT FROM public.cellartracker_match_review_view
     WHERE match_group_key = '2012|excluded wine'),
    0,
    'an excluded record is not queued for matching'
);

-- 11. The preview reports what accepting the next snapshot would carry.

SELECT results_eq(
    $$SELECT
        (public.preview_cellartracker_import('22222222-2222-2222-2222-222222222222') ->> 'link_count')::INT,
        (public.preview_cellartracker_import('22222222-2222-2222-2222-222222222222') ->> 'price_count')::INT,
        (public.preview_cellartracker_import('22222222-2222-2222-2222-222222222222') ->> 'excluded_count')::INT,
        (public.preview_cellartracker_import('22222222-2222-2222-2222-222222222222') ->> 'new_record_count')::INT$$,
    $$VALUES (1, 1, 1, 2)$$,
    'the preview reports one link, one price, one exclusion and two undecided records'
);

-- 12-16. Accepting the next snapshot carries the decisions forward.

SELECT lives_ok(
    $$SELECT public.accept_cellartracker_import('22222222-2222-2222-2222-222222222222')$$,
    'the next snapshot can be accepted'
);

-- accept_cellartracker_import stamps accepted_at with now(), which loses to
-- the 2099 fixture date on snapshot one. Dating it forward makes snapshot two
-- the current one, which is what the read-view assertions below are about.
UPDATE public.cellar_imports
SET accepted_at = TIMESTAMPTZ '2099-06-01'
WHERE id = '22222222-2222-2222-2222-222222222222';

SELECT is(
    (SELECT parent_sku FROM public.cellartracker_product_resolutions
     WHERE import_id = '22222222-2222-2222-2222-222222222222' AND source_row_number = 1),
    '20100000001',
    'the link is re-applied to the new snapshot'
);

SELECT is(
    (SELECT purchase_price_per_bottle_p FROM public.cellartracker_evidence
     WHERE import_id = '22222222-2222-2222-2222-222222222222' AND source_row_number = 2),
    3900,
    'the price correction is re-applied to the new snapshot'
);

SELECT is(
    (SELECT count(*)::INT FROM public.current_cellartracker_records
     WHERE source_wine = 'Excluded Wine'),
    0,
    'a record excluded on the previous snapshot stays excluded on the new one'
);

SELECT is(
    (SELECT count(*)::INT FROM public.current_cellartracker_records
     WHERE source_wine = 'Brand New Wine'),
    1,
    'a record with no prior decision arrives untouched'
);

-- 17. Restoring puts an excluded record back on the current snapshot.

SELECT is(
    (SELECT public.restore_cellartracker_record('2012|excluded wine', 'Excluded Wine') ->> 'restored'),
    'true',
    'an excluded record can be restored'
);

SELECT is(
    (SELECT count(*)::INT FROM public.current_cellartracker_records
     WHERE source_wine = 'Excluded Wine'),
    1,
    'the restored record reappears on the current snapshot'
);

-- 18-22. Release-offer exclusion is keyed on content, so it holds across files.

SELECT lives_ok(
    $$SELECT public.exclude_release_offer_record(
        '33333333-3333-3333-3333-333333333331', 1
    )$$,
    'the owner can exclude an accepted release-offer record'
);

SELECT is(
    (SELECT count(*)::INT FROM public.release_offer_review_view
     WHERE source_wine = 'Offer Wine 2014'),
    0,
    'both copies of an excluded offer are hidden, including the later import'
);

SELECT is(
    (SELECT count(*)::INT FROM public.release_offer_evidence_view
     WHERE source_wine = 'Offer Wine 2014'),
    0,
    'an excluded offer no longer supplies a release price'
);

SELECT is(
    (SELECT count(*)::INT FROM public.release_offer_evidence_view
     WHERE source_wine = 'Kept Wine 2015'),
    1,
    'excluding one offer leaves the rest of the import intact'
);

SELECT is(
    (SELECT count(*)::INT FROM public.release_offer_review_view
     WHERE source_wine = 'Offer Wine 2014'
       AND '33333333-3333-3333-3333-333333333332' = import_id),
    0,
    'a later file repeating an excluded offer does not reintroduce it'
);

-- 24. An anchor confirmed on an offer that is later excluded falls back to the
-- provisional pick, and reports itself as provisional rather than confirmed.

INSERT INTO public.release_price_anchor_overrides (
    parent_sku, format_code, release_offer_price_id, confirmed_by
)
SELECT '20140000001', '06-00750', price.id, '11111111-1111-1111-1111-111111111111'
FROM public.release_offer_prices price
WHERE price.import_id = '33333333-3333-3333-3333-333333333331'
  AND price.source_row_number = 1;

SELECT results_eq(
    $$SELECT anchor_status, source_wine
      FROM public.release_price_anchor_view
      WHERE parent_sku = '20140000001'$$,
    $$VALUES ('provisional'::TEXT, 'Kept Wine 2015'::TEXT)$$,
    'an anchor confirmed on an excluded offer falls back and is reported provisional'
);

SELECT * FROM finish();

ROLLBACK;
