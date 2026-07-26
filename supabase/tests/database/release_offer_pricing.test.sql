BEGIN;

SELECT plan(29);

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
    public.finalise_release_offer_import(
        '31000000-0000-0000-0000-000000000001', 3, 3
    )->>'status',
    'validated',
    'a complete error-free import validates'
);
SELECT is((SELECT matched_row_count FROM public.release_offer_imports WHERE id = '31000000-0000-0000-0000-000000000001'), 2, 'exact product identifiers match');
SELECT is((SELECT unmatched_row_count FROM public.release_offer_imports WHERE id = '31000000-0000-0000-0000-000000000001'), 1, 'unresolved source rows remain visible');
SELECT is((SELECT count(*)::INT FROM public.release_offer_source_rows WHERE import_id = '31000000-0000-0000-0000-000000000001'), 3, 'duplicate source evidence is preserved');

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
