BEGIN;

SELECT plan(42);

INSERT INTO auth.users (id)
VALUES
    ('11000000-0000-0000-0000-000000000001'),
    ('11000000-0000-0000-0000-000000000002');

INSERT INTO public.app_owners (user_id)
VALUES ('11000000-0000-0000-0000-000000000001');

INSERT INTO public.scan_runs (id, scope, run_date, status, started_at)
VALUES (
    '21000000-0000-0000-0000-000000000001',
    'release-test',
    DATE '2026-07-26',
    'completed',
    now()
);

INSERT INTO public.products (
    parent_sku, name, vintage, region, colour, producer, product_url,
    first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at,
    last_rest_checked_at
)
VALUES (
    '21000000001', 'Test release wine 2018', 2018, 'Bordeaux', 'Red',
    'Test producer', '/products-21000000001-test-release-wine',
    '21000000-0000-0000-0000-000000000001', now(),
    '21000000-0000-0000-0000-000000000001', now(),
    '2026-07-26 12:00:00+00'
);

INSERT INTO public.skus (
    parent_sku, format_code, case_size, bottle_volume_ml,
    least_listing_price_p, market_price_p, highest_bid_p, is_listed,
    first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at
)
VALUES (
    '21000000001', '06-00750', 6, 750, 9000, 9500, 8000, TRUE,
    '21000000-0000-0000-0000-000000000001', now(),
    '21000000-0000-0000-0000-000000000001', now()
);

SELECT is(
    has_table_privilege('anon', 'public.release_offer_imports', 'SELECT'),
    FALSE,
    'anonymous users have no release import table privilege'
);
SELECT is(
    has_table_privilege('anon', 'public.release_price_market_view', 'SELECT'),
    FALSE,
    'anonymous users have no release market view privilege'
);
SELECT is(
    has_table_privilege('authenticated', 'public.release_price_market_view', 'SELECT'),
    TRUE,
    'authenticated users have the select grant required for owner RLS'
);
SELECT is(
    has_table_privilege('anon', 'public.release_offer_ingestion_cursors', 'SELECT'),
    FALSE,
    'anonymous users cannot read the Gmail ingestion cursor'
);
SELECT is(
    has_table_privilege('authenticated', 'public.release_offer_ingestion_cursors', 'SELECT'),
    TRUE,
    'authenticated users have the cursor select grant required for owner RLS'
);
SELECT is(
    has_function_privilege(
        'anon',
        'public.begin_release_offer_import(uuid,text,text,text,bigint,text,text)',
        'EXECUTE'
    ),
    FALSE,
    'anonymous users cannot begin a release import'
);
SELECT is(
    has_function_privilege(
        'authenticated',
        'public.begin_release_offer_import(uuid,text,text,text,bigint,text,text)',
        'EXECUTE'
    ),
    TRUE,
    'authenticated users can call the owner-checked import RPC'
);

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;

SELECT ok((SELECT private.is_app_owner()), 'the allowlisted identity is the owner');

SELECT is(
    public.begin_release_offer_import(
        '31000000-0000-0000-0000-000000000001',
        'historic_csv',
        repeat('b', 64),
        'release-test.csv',
        2000,
        '11000000-0000-0000-0000-000000000001/31000000-0000-0000-0000-000000000001/release-offers.csv',
        'release-offers-v1'
    )->>'status',
    'staging',
    'the owner can begin a private release import'
);

SELECT is(
    (
        public.stage_release_offer_batch(
            '31000000-0000-0000-0000-000000000001',
            '[
              {
                "source_row_number": 2,
                "raw_row": {"Wine": "Test release wine 2018"},
                "offer_date": "2019-01-01",
                "source_wine": "Test release wine 2018",
                "source_vintage": 2018,
                "source_match_key": "test release wine",
                "source_price_text": "£100 per 6 bottles in bond",
                "source_product_id": "21000000001",
                "content_fingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "validation_errors": [],
                "validation_warnings": [],
                "prices": [{
                  "fragment_index": 1,
                  "raw_price_text": "£100 per 6 bottles in bond",
                  "amount_p": 10000,
                  "currency": "GBP",
                  "case_size": 6,
                  "bottle_volume_ml": 750,
                  "format_code": "06-00750",
                  "tax_basis": "in_bond",
                  "parse_status": "valid",
                  "price_fingerprint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                  "validation_warnings": []
                }]
              },
              {
                "source_row_number": 3,
                "raw_row": {"Wine": "Test release wine 2018 duplicate"},
                "offer_date": "2019-01-01",
                "source_wine": "Test release wine 2018",
                "source_vintage": 2018,
                "source_match_key": "test release wine",
                "source_price_text": "£100 per 6 bottles in bond",
                "source_product_id": "21000000001",
                "content_fingerprint": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                "validation_errors": [],
                "validation_warnings": [],
                "prices": [{
                  "fragment_index": 1,
                  "raw_price_text": "£100 per 6 bottles in bond",
                  "amount_p": 10000,
                  "currency": "GBP",
                  "case_size": 6,
                  "bottle_volume_ml": 750,
                  "format_code": "06-00750",
                  "tax_basis": "in_bond",
                  "parse_status": "valid",
                  "price_fingerprint": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                  "validation_warnings": []
                }]
              },
              {
                "source_row_number": 4,
                "raw_row": {"Wine": "Unknown wine 2018"},
                "offer_date": "2019-01-02",
                "source_wine": "Unknown wine 2018",
                "source_vintage": 2018,
                "source_match_key": "unknown wine",
                "source_price_text": "£110 per 6 bottles in bond",
                "content_fingerprint": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                "validation_errors": [],
                "validation_warnings": [],
                "prices": [{
                  "fragment_index": 1,
                  "raw_price_text": "£110 per 6 bottles in bond",
                  "amount_p": 11000,
                  "currency": "GBP",
                  "case_size": 6,
                  "bottle_volume_ml": 750,
                  "format_code": "06-00750",
                  "tax_basis": "in_bond",
                  "parse_status": "valid",
                  "price_fingerprint": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                  "validation_warnings": []
                }]
              }
            ]'::JSONB
        )->>'source_row_count'
    )::INT,
    3,
    'the batch stages all source rows'
);

SELECT is(
    (
        public.stage_release_offer_batch(
            '31000000-0000-0000-0000-000000000001',
            jsonb_build_array(jsonb_build_object(
                'source_row_number', 5,
                'raw_row', jsonb_build_object('Wine', 'Long historic price list'),
                'offer_date', '2019-01-03',
                'source_wine', 'Long historic price list',
                'source_match_key', 'long historic price list',
                'source_price_text', repeat('x', 2225),
                'content_fingerprint', repeat('1', 64),
                'validation_errors', '[]'::JSONB,
                'validation_warnings', '[]'::JSONB,
                'prices', '[]'::JSONB
            ))
        )->>'source_row_count'
    )::INT,
    4,
    'a long historic price list does not stop a resumable import'
);

SELECT is(
    public.finalise_release_offer_import(
        '31000000-0000-0000-0000-000000000001', 4, 3
    )->>'status',
    'validated',
    'a complete error-free import validates'
);
SELECT is((SELECT matched_row_count FROM public.release_offer_imports WHERE id = '31000000-0000-0000-0000-000000000001'), 2, 'exact product identifiers match');
SELECT is((SELECT unmatched_row_count FROM public.release_offer_imports WHERE id = '31000000-0000-0000-0000-000000000001'), 2, 'unresolved source rows remain visible');
SELECT is((SELECT count(*)::INT FROM public.release_offer_source_rows WHERE import_id = '31000000-0000-0000-0000-000000000001'), 4, 'duplicate source evidence is preserved');

SELECT is(public.accept_release_offer_import('31000000-0000-0000-0000-000000000001')->>'status', 'accepted', 'the owner can accept validated evidence');
SELECT is((SELECT count(*)::INT FROM public.release_offer_prices WHERE publication_status = 'published'), 2, 'only eligible matched price rows are published');
SELECT is((SELECT count(*)::INT FROM public.release_offer_evidence_view), 1, 'duplicate economic events collapse in the analytical evidence view');
SELECT is((SELECT anchor_status FROM public.release_price_anchor_view), 'provisional', 'the oldest evidence starts as a provisional anchor');
SELECT is((SELECT lowest_ask_p FROM public.release_price_market_view), 9000, 'the comparison uses the current scanner ask');
SELECT is((SELECT ask_vs_release_pct FROM public.release_price_market_view), (-10.0)::NUMERIC, 'the ask discount is calculated against release');
SELECT is((SELECT recoup_bid_p FROM public.release_price_market_view), 11200, 'the whole-pound recoup bid covers a 10 percent seller commission');
SELECT is((SELECT seller_net_highest_bid_p FROM public.release_price_market_view), 7200, 'the current bid seller net uses the fee schedule');

SELECT is(
    public.resolve_release_offer_row(
        '31000000-0000-0000-0000-000000000001', 4, '21000000001'
    )->>'match_status',
    'matched',
    'the owner can manually resolve an unmatched source row'
);
SELECT is((SELECT count(*)::INT FROM public.release_offer_evidence_view), 2, 'resolution after acceptance publishes newly eligible evidence');

SELECT is(
    public.confirm_release_price_anchor(
        (SELECT max(release_offer_price_id) FROM public.release_offer_evidence_view),
        'Confirmed test release'
    )->>'anchor_status',
    'confirmed',
    'the owner can confirm a selected exact evidence row'
);
SELECT is((SELECT anchor_status FROM public.release_price_anchor_view), 'confirmed', 'the confirmed evidence overrides the provisional anchor');

-- A resolved BBR Parent ID may name a wine that is not (yet) in our biddable
-- catalogue. Tier-1 matching and publication must not require a
-- catalogue_view/skus row: the anchor still publishes and surfaces via
-- release_price_market_view's LEFT JOIN, with null comparison columns.
SELECT is(
    public.begin_release_offer_import(
        '31000000-0000-0000-0000-000000000002',
        'historic_csv',
        repeat('e', 64),
        'release-test-2.csv',
        1000,
        '11000000-0000-0000-0000-000000000001/31000000-0000-0000-0000-000000000002/release-offers.csv',
        'release-offers-v2'
    )->>'status',
    'staging',
    'the owner can begin a second private release import'
);

SELECT is(
    (
        public.stage_release_offer_batch(
            '31000000-0000-0000-0000-000000000002',
            jsonb_build_array(
                jsonb_build_object(
                    'source_row_number', 2,
                    'raw_row', jsonb_build_object('Wine', 'Off-catalogue wine 2019'),
                    'offer_date', '2020-01-01',
                    'source_wine', 'Off-catalogue wine 2019',
                    'source_vintage', 2019,
                    'source_match_key', 'off catalogue wine',
                    'source_price_text', '£120 per 6 bottles in bond',
                    'source_product_id', '90000000009',
                    'content_fingerprint', repeat('2', 64),
                    'validation_errors', '[]'::JSONB,
                    'validation_warnings', '[]'::JSONB,
                    'prices', jsonb_build_array(jsonb_build_object(
                        'fragment_index', 1,
                        'raw_price_text', '£120 per 6 bottles in bond',
                        'amount_p', 12000,
                        'currency', 'GBP',
                        'case_size', 6,
                        'bottle_volume_ml', 750,
                        'format_code', '06-00750',
                        'tax_basis', 'in_bond',
                        'parse_status', 'valid',
                        'price_fingerprint', repeat('3', 64),
                        'validation_warnings', '[]'::JSONB
                    ))
                ),
                jsonb_build_object(
                    'source_row_number', 3,
                    'raw_row', jsonb_build_object('Wine', 'Unresolved off-catalogue wine 2020'),
                    'offer_date', '2020-02-01',
                    'source_wine', 'Unresolved off-catalogue wine 2020',
                    'source_vintage', 2020,
                    'source_match_key', 'unresolved off catalogue wine',
                    'source_price_text', '£130 per 6 bottles in bond',
                    'content_fingerprint', repeat('4', 64),
                    'validation_errors', '[]'::JSONB,
                    'validation_warnings', '[]'::JSONB,
                    'prices', jsonb_build_array(jsonb_build_object(
                        'fragment_index', 1,
                        'raw_price_text', '£130 per 6 bottles in bond',
                        'amount_p', 13000,
                        'currency', 'GBP',
                        'case_size', 6,
                        'bottle_volume_ml', 750,
                        'format_code', '06-00750',
                        'tax_basis', 'in_bond',
                        'parse_status', 'valid',
                        'price_fingerprint', repeat('5', 64),
                        'validation_warnings', '[]'::JSONB
                    ))
                )
            )
        )->>'source_row_count'
    )::INT,
    2,
    'the second batch stages both off-catalogue source rows'
);

SELECT is(
    public.finalise_release_offer_import(
        '31000000-0000-0000-0000-000000000002', 2, 2
    )->>'status',
    'validated',
    'an import with only off-catalogue resolved IDs still validates'
);
SELECT is(
    (SELECT parent_sku FROM public.release_offer_source_rows
     WHERE import_id = '31000000-0000-0000-0000-000000000002' AND source_row_number = 2),
    '90000000009',
    'tier-1 matching trusts a resolved ID that is not yet in the catalogue'
);
SELECT ok(
    NOT EXISTS (SELECT 1 FROM public.products WHERE parent_sku = '90000000009'),
    'the off-catalogue ID genuinely has no catalogue product'
);

SELECT is(
    public.accept_release_offer_import('31000000-0000-0000-0000-000000000002')->>'status',
    'accepted',
    'the owner can accept an import containing only off-catalogue evidence'
);
SELECT is(
    (SELECT publication_status FROM public.release_offer_prices
     WHERE import_id = '31000000-0000-0000-0000-000000000002' AND source_row_number = 2),
    'published',
    'an off-catalogue in-bond price publishes without a skus row'
);
SELECT is(
    (SELECT count(*)::INT FROM public.release_price_market_view WHERE parent_sku = '90000000009'),
    1,
    'the off-catalogue anchor surfaces in the market view via the LEFT JOIN'
);
SELECT is(
    (SELECT lowest_ask_p FROM public.release_price_market_view WHERE parent_sku = '90000000009'),
    NULL,
    'the off-catalogue anchor has null current-market comparison columns'
);
SELECT is(
    (SELECT publication_status FROM public.release_offer_prices
     WHERE import_id = '31000000-0000-0000-0000-000000000002' AND source_row_number = 3),
    'pending',
    'an unmatched row stays pending after acceptance'
);

SELECT is(
    public.resolve_release_offer_row(
        '31000000-0000-0000-0000-000000000002', 3, '90000000010'
    )->>'match_status',
    'matched',
    'the owner can manually resolve to an off-catalogue parent_sku'
);
SELECT is(
    (SELECT publication_status FROM public.release_offer_prices
     WHERE import_id = '31000000-0000-0000-0000-000000000002' AND source_row_number = 3),
    'published',
    'manual resolution to an off-catalogue ID publishes without a skus row'
);

RESET ROLE;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;
SELECT is((SELECT private.is_app_owner()), FALSE, 'a different authenticated user is not the owner');
SELECT is((SELECT count(*)::INT FROM public.release_price_market_view), 0, 'owner RLS hides release prices from a non-owner');
SELECT is((SELECT count(*)::INT FROM public.release_offer_imports), 0, 'owner RLS hides imports from a non-owner');

SELECT * FROM finish();
ROLLBACK;
