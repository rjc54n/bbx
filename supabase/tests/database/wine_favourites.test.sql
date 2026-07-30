-- Favourite propagation across links.
--
-- The rules under test are the ones that make a favourite a wine-level opinion
-- rather than a source-record one: a star set before a link is promoted when the
-- link lands, a star survives an unlink by falling back to the match group, and
-- neither a link nor a record deletion can be broken by the favourite triggers.
--
-- Two CellarTracker imports are used because current_cellartracker_records only
-- exposes the latest accepted snapshot: import 2 is the current one, so the
-- re-import test proves a pending star outlives the snapshot it was set on.
-- accepted_at is dated 2099 so the fixtures win over any real local snapshot.

BEGIN;

SELECT plan(15);

INSERT INTO auth.users (id)
VALUES ('11111111-1111-1111-1111-111111111111');

INSERT INTO public.app_owners (user_id)
VALUES ('11111111-1111-1111-1111-111111111111');

-- CellarTracker snapshots.

INSERT INTO public.cellar_imports (
    id, source_type, content_checksum, original_filename, byte_size,
    storage_object_path, uploaded_by, parser_version, status,
    accepted_at, accepted_by
)
VALUES
    (
        '22222222-2222-2222-2222-222222222221', 'cellartracker_inventory',
        repeat('a', 64), 'ct-one.csv', 1024, 'cellartracker/test-one.csv',
        '11111111-1111-1111-1111-111111111111', 'test', 'accepted',
        TIMESTAMPTZ '2099-01-01', '11111111-1111-1111-1111-111111111111'
    ),
    (
        '22222222-2222-2222-2222-222222222222', 'cellartracker_inventory',
        repeat('b', 64), 'ct-two.csv', 1024, 'cellartracker/test-two.csv',
        '11111111-1111-1111-1111-111111111111', 'test', 'accepted',
        TIMESTAMPTZ '2099-06-01', '11111111-1111-1111-1111-111111111111'
    );

INSERT INTO public.cellar_import_rows (import_id, source_row_number, raw_row, match_status)
VALUES
    ('22222222-2222-2222-2222-222222222221', 1, '{}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222221', 2, '{}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222221', 3, '{}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222221', 4, '{}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222221', 5, '{}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222222', 1, '{}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222222', 2, '{}'::JSONB, 'unmatched');

INSERT INTO public.cellartracker_evidence (
    import_id, source_row_number, source_wine, source_match_key, vintage,
    bottle_volume_ml, purchase_price_per_bottle_p, quantity_home, quantity_bbr,
    total_quantity, fully_consumed, producer
)
VALUES
    ('22222222-2222-2222-2222-222222222221', 1, 'Promote Wine', 'promote wine', 2010, 750, 4000, 6, 0, 6, FALSE, 'Test Producer'),
    ('22222222-2222-2222-2222-222222222221', 2, 'Demote Wine', 'demote wine', 2011, 750, 4100, 6, 0, 6, FALSE, 'Test Producer'),
    ('22222222-2222-2222-2222-222222222221', 3, 'Edit Wine', 'edit wine', 2012, 750, 4200, 6, 0, 6, FALSE, 'Test Producer'),
    ('22222222-2222-2222-2222-222222222221', 4, 'Delete Wine', 'delete wine', 2013, 750, 4300, 6, 0, 6, FALSE, 'Test Producer'),
    ('22222222-2222-2222-2222-222222222221', 5, 'Reimport Wine', 'reimport wine', 2016, 750, 4600, 6, 0, 6, FALSE, 'Test Producer'),
    ('22222222-2222-2222-2222-222222222222', 1, 'Reimport Wine', 'reimport wine', 2016, 750, 4600, 6, 0, 6, FALSE, 'Test Producer'),
    ('22222222-2222-2222-2222-222222222222', 2, 'View Wine', 'view wine', 2017, 750, 5000, 12, 0, 12, FALSE, 'Test Producer');

-- Release-offer snapshot.

INSERT INTO public.release_offer_imports (
    id, content_checksum, original_filename, byte_size,
    storage_object_path, imported_by, parser_version, status,
    accepted_at, accepted_by
)
VALUES (
    '33333333-3333-3333-3333-333333333331',
    repeat('c', 64), 'offers.csv', 1024, 'release-offers/test-one.csv',
    '11111111-1111-1111-1111-111111111111', 'test', 'accepted',
    TIMESTAMPTZ '2099-01-01', '11111111-1111-1111-1111-111111111111'
);

INSERT INTO public.release_offer_source_rows (
    import_id, source_row_number, raw_row, offer_date, source_wine,
    source_vintage, source_match_key, source_price_text, content_fingerprint
)
VALUES (
    '33333333-3333-3333-3333-333333333331', 1, '{}'::JSONB, DATE '2026-01-15',
    'Offer Wine 2014', 2014, 'offer wine', '£900 per 6', repeat('d', 64)
);

-- 1-2. The release-prices-scoped table is gone, replaced at wine grain.

SELECT has_table('public', 'wine_favourites', 'wine_favourites replaces the release-price table');
SELECT hasnt_table('public', 'release_price_favourites', 'the source-scoped favourites table is dropped');

-- 3-4. Star an unlinked CellarTracker row, then link it: the star promotes.

INSERT INTO public.pending_favourites (user_id, source, match_group_key)
VALUES ('11111111-1111-1111-1111-111111111111', 'cellartracker', '2010|promote wine');

INSERT INTO public.cellartracker_product_resolutions (
    import_id, source_row_number, status, parent_sku, match_method, resolved_by
)
VALUES (
    '22222222-2222-2222-2222-222222222221', 1, 'linked', '20100000001',
    'manual', '11111111-1111-1111-1111-111111111111'
);

SELECT is(
    (SELECT count(*)::INT FROM public.wine_favourites WHERE parent_sku = '20100000001'),
    1,
    'linking promotes a pending favourite to the wine'
);
SELECT is(
    (SELECT count(*)::INT FROM public.pending_favourites WHERE match_group_key = '2010|promote wine'),
    0,
    'the pending favourite is consumed by promotion'
);

-- 5. Linking an unstarred row favourites nothing.

INSERT INTO public.cellartracker_product_resolutions (
    import_id, source_row_number, status, parent_sku, match_method, resolved_by
)
VALUES (
    '22222222-2222-2222-2222-222222222222', 2, 'linked', '20170000007',
    'manual', '11111111-1111-1111-1111-111111111111'
);

SELECT is(
    (SELECT count(*)::INT FROM public.wine_favourites WHERE parent_sku = '20170000007'),
    0,
    'linking an unstarred record does not create a favourite'
);

-- 6-7. Unlink demotes to a pending favourite and keeps the wine favourite.

INSERT INTO public.cellartracker_product_resolutions (
    import_id, source_row_number, status, parent_sku, match_method, resolved_by
)
VALUES (
    '22222222-2222-2222-2222-222222222221', 2, 'linked', '20110000002',
    'manual', '11111111-1111-1111-1111-111111111111'
);

INSERT INTO public.wine_favourites (user_id, parent_sku)
VALUES ('11111111-1111-1111-1111-111111111111', '20110000002');

DELETE FROM public.cellartracker_product_resolutions
WHERE import_id = '22222222-2222-2222-2222-222222222221' AND source_row_number = 2;

SELECT is(
    (SELECT count(*)::INT FROM public.pending_favourites WHERE match_group_key = '2011|demote wine'),
    1,
    'unlinking writes the star back to the match group'
);
SELECT is(
    (SELECT count(*)::INT FROM public.wine_favourites WHERE parent_sku = '20110000002'),
    1,
    'unlinking never removes the wine favourite'
);

-- 8-9. A corrected link favourites the new wine and leaves the old one, which
--      the Favourites tab then shows with no linked records.

INSERT INTO public.cellartracker_product_resolutions (
    import_id, source_row_number, status, parent_sku, match_method, resolved_by
)
VALUES (
    '22222222-2222-2222-2222-222222222221', 3, 'linked', '20120000003',
    'manual', '11111111-1111-1111-1111-111111111111'
);

INSERT INTO public.wine_favourites (user_id, parent_sku)
VALUES ('11111111-1111-1111-1111-111111111111', '20120000003');

UPDATE public.cellartracker_product_resolutions
SET parent_sku = '20120000004'
WHERE import_id = '22222222-2222-2222-2222-222222222221' AND source_row_number = 3;

SELECT is(
    (SELECT count(*)::INT FROM public.wine_favourites WHERE parent_sku = '20120000004'),
    1,
    'a corrected link carries the favourite onto the new wine'
);
SELECT is(
    (SELECT count(*)::INT FROM public.wine_favourites WHERE parent_sku = '20120000003'),
    1,
    'the mis-linked wine keeps its favourite rather than being silently dropped'
);

-- 10-11. Deleting a record must not fail, and must not strand a null-keyed
--        pending row: the FK cascade removes the evidence row first, so the
--        match group is legitimately unknown by then.

INSERT INTO public.cellartracker_product_resolutions (
    import_id, source_row_number, status, parent_sku, match_method, resolved_by
)
VALUES (
    '22222222-2222-2222-2222-222222222221', 4, 'linked', '20130000005',
    'manual', '11111111-1111-1111-1111-111111111111'
);

INSERT INTO public.wine_favourites (user_id, parent_sku)
VALUES ('11111111-1111-1111-1111-111111111111', '20130000005');

SELECT lives_ok(
    $$DELETE FROM public.cellartracker_evidence
      WHERE import_id = '22222222-2222-2222-2222-222222222221' AND source_row_number = 4$$,
    'deleting a favourited record is not blocked by the favourite triggers'
);
SELECT is(
    (SELECT count(*)::INT FROM public.pending_favourites WHERE match_group_key = '2013|delete wine'),
    0,
    'a deleted record leaves no pending favourite behind'
);

-- 12. The release-offer path promotes on the same rules.

INSERT INTO public.pending_favourites (user_id, source, match_group_key)
VALUES ('11111111-1111-1111-1111-111111111111', 'release_offer', '2014|offer wine');

INSERT INTO public.release_offer_product_resolutions (
    import_id, source_row_number, status, parent_sku, match_method, resolved_by
)
VALUES (
    '33333333-3333-3333-3333-333333333331', 1, 'linked', '20140000006',
    'manual', '11111111-1111-1111-1111-111111111111'
);

SELECT is(
    (SELECT count(*)::INT FROM public.wine_favourites WHERE parent_sku = '20140000006'),
    1,
    'release-offer links promote a pending favourite too'
);

-- 13. A pending favourite set on one snapshot still resolves against the next,
--     which is the reason it keys on match_group_key.

INSERT INTO public.pending_favourites (user_id, source, match_group_key)
VALUES ('11111111-1111-1111-1111-111111111111', 'cellartracker', '2016|reimport wine');

SELECT is(
    (SELECT record_count FROM public.pending_favourite_view
      WHERE match_group_key = '2016|reimport wine'),
    1,
    'a pending favourite survives a new snapshot and resolves against it'
);

-- 14. The Favourites tab sees holdings for a favourited, linked wine.

INSERT INTO public.wine_favourites (user_id, parent_sku)
VALUES ('11111111-1111-1111-1111-111111111111', '20170000007');

SELECT is(
    (SELECT cellartracker_bottles_home FROM public.favourite_wine_view
      WHERE parent_sku = '20170000007'),
    12,
    'favourite_wine_view reports CellarTracker holdings for the wine'
);

-- 15. A pending favourite whose group no longer appears is flagged, not hidden.

INSERT INTO public.pending_favourites (user_id, source, match_group_key)
VALUES ('11111111-1111-1111-1111-111111111111', 'cellartracker', '2015|ghost wine');

SELECT is(
    (SELECT is_stale FROM public.pending_favourite_view
      WHERE match_group_key = '2015|ghost wine'),
    TRUE,
    'a pending favourite with no matching rows is reported as stale'
);

SELECT * FROM finish();
ROLLBACK;
