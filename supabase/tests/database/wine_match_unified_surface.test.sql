-- Wine matching, Part A / Slice 1: the unified read surface.
--
-- Covers docs/MATCHING-FUNCTIONAL-SPEC.md §3.2/§3.5 acceptance points:
--   * wine_match_review_view / wine_match_suggestion_view expose the agreed
--     common projection, UNION ALL of the two per-source views, disjoint by
--     source;
--   * the recreated release_offer_match_review_view drops excluded rows from
--     its counts, the way cellartracker_match_review_view already does (§2.4);
--   * last_run_status / last_error_at / top_match_score reach both branches;
--   * wine_match_queue_summary(p_source) returns exact bucket counts equal to a
--     direct count over the view, and is scoped by source;
--   * anon cannot read the views or execute the function; a non-owner
--     authenticated caller sees nothing through RLS.
--
-- Fixtures (one release-offer import, one accepted CellarTracker snapshot):
--   release_offer  2014|alpha    2 rows, 1 excluded -> 1 row / unresolved, 2 suggestions (top 0.90)
--                  2015|beta     linked to 20140000001 (in catalogue)
--                  2016|gamma    suppressed
--                  2017|delta    linked to 20990000001 (NOT in catalogue), last run failed
--                  2018|epsilon  mixed: 1 linked, 1 unresolved, no suggestions
--                  2019|zeta     1 row, excluded -> group disappears
--                  2023|eta      1 row, unresolved, no suggestions, last run failed
--   cellartracker  2020|ct alpha unresolved, 1 suggestion
--                  2021|ct beta  linked to 20140000001
--                  2022|ct gamma excluded -> group disappears

BEGIN;
SELECT plan(56);

INSERT INTO auth.users (id) VALUES
    ('11111111-1111-1111-1111-111111111111'),
    ('99999999-9999-9999-9999-999999999999');
INSERT INTO public.app_owners (user_id) VALUES ('11111111-1111-1111-1111-111111111111');
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    TRUE
);

-- Catalogue: 20140000001 is BBX-eligible; 20990000001 is deliberately absent.
INSERT INTO private.products (parent_sku, name, vintage, first_seen_at, last_seen_at)
VALUES ('20140000001', 'Alpha Catalogue Wine', 2014, now(), now());
INSERT INTO private.skus (parent_sku, format_code, case_size, bottle_volume_ml, first_seen_at, last_seen_at)
VALUES ('20140000001', '06-00750', 6, 750, now(), now());
SELECT private.rebuild_catalogue_caches();

-- Release offers -----------------------------------------------------------

INSERT INTO public.release_offer_imports (
    id, content_checksum, original_filename, byte_size,
    storage_object_path, imported_by, parser_version, status, accepted_at, accepted_by
)
VALUES (
    '33333333-3333-3333-3333-333333333331',
    repeat('c', 64), 'offers.csv', 1024, 'release-offers/test.csv',
    '11111111-1111-1111-1111-111111111111', 'test', 'accepted',
    TIMESTAMPTZ '2099-01-01', '11111111-1111-1111-1111-111111111111'
);

INSERT INTO public.release_offer_source_rows (
    import_id, source_row_number, raw_row, offer_date, source_wine,
    source_vintage, source_match_key, source_price_text, content_fingerprint
)
VALUES
    ('33333333-3333-3333-3333-333333333331', 1, '{}'::JSONB, DATE '2026-01-15', 'Alpha Wine', 2014, 'alpha', '£900 per 6', repeat('a', 64)),
    ('33333333-3333-3333-3333-333333333331', 2, '{}'::JSONB, DATE '2026-01-16', 'Alpha Wine', 2014, 'alpha', '£910 per 6', repeat('b', 64)),
    ('33333333-3333-3333-3333-333333333331', 3, '{}'::JSONB, DATE '2026-01-15', 'Beta Wine', 2015, 'beta', '£600 per 6', repeat('c', 64)),
    ('33333333-3333-3333-3333-333333333331', 4, '{}'::JSONB, DATE '2026-01-15', 'Gamma Wine', 2016, 'gamma', '£500 per 6', repeat('d', 64)),
    ('33333333-3333-3333-3333-333333333331', 5, '{}'::JSONB, DATE '2026-01-15', 'Delta Wine', 2017, 'delta', '£700 per 6', repeat('e', 64)),
    ('33333333-3333-3333-3333-333333333331', 6, '{}'::JSONB, DATE '2026-01-15', 'Epsilon Wine', 2018, 'epsilon', '£800 per 6', repeat('f', 64)),
    ('33333333-3333-3333-3333-333333333331', 7, '{}'::JSONB, DATE '2026-01-16', 'Epsilon Wine', 2018, 'epsilon', '£810 per 6', repeat('0', 64)),
    ('33333333-3333-3333-3333-333333333331', 8, '{}'::JSONB, DATE '2026-01-15', 'Zeta Wine', 2019, 'zeta', '£400 per 6', repeat('1', 64)),
    ('33333333-3333-3333-3333-333333333331', 9, '{}'::JSONB, DATE '2026-01-17', 'Eta Wine', 2023, 'eta', '£1000 per 6', repeat('2', 64));

-- Row 2 of the alpha group and the whole zeta group are excluded by content.
INSERT INTO public.release_offer_record_exclusions (content_fingerprint)
VALUES (repeat('b', 64)), (repeat('1', 64));

INSERT INTO public.release_offer_product_resolutions (
    import_id, source_row_number, status, parent_sku, match_method, resolved_by
)
VALUES
    ('33333333-3333-3333-3333-333333333331', 3, 'linked', '20140000001', 'manual', '11111111-1111-1111-1111-111111111111'),
    ('33333333-3333-3333-3333-333333333331', 4, 'ignored', NULL, NULL, '11111111-1111-1111-1111-111111111111'),
    ('33333333-3333-3333-3333-333333333331', 5, 'linked', '20990000001', 'manual', '11111111-1111-1111-1111-111111111111'),
    ('33333333-3333-3333-3333-333333333331', 6, 'linked', '20140000001', 'manual', '11111111-1111-1111-1111-111111111111');

INSERT INTO public.release_offer_match_runs (id, started_by, status)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'partial');

INSERT INTO public.release_offer_match_run_groups (
    run_id, match_group_key, source_match_key, source_vintage, source_wine, source_row_count, status, processed_at
)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2014|alpha', 'alpha', 2014, 'Alpha Wine', 2, 'processed', TIMESTAMPTZ '2026-01-20 10:00+00'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2017|delta', 'delta', 2017, 'Delta Wine', 1, 'failed', TIMESTAMPTZ '2026-01-20 10:05+00'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2023|eta', 'eta', 2023, 'Eta Wine', 1, 'failed', TIMESTAMPTZ '2026-01-20 10:10+00');

INSERT INTO public.release_offer_match_suggestions (
    match_group_key, parent_sku, source_run_id, rank, name, was_biddable_at_observation, observed_at, match_score
)
VALUES
    ('2014|alpha', '20140000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 'Alpha Catalogue Wine', TRUE, now(), 0.90),
    ('2014|alpha', '20990000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2, 'Alpha Other Wine', FALSE, now(), 0.70);

-- CellarTracker ----------------------------------------------------------

INSERT INTO public.cellar_imports (
    id, source_type, content_checksum, original_filename, byte_size,
    storage_object_path, uploaded_by, parser_version, status, accepted_at, accepted_by
)
VALUES (
    '22222222-2222-2222-2222-222222222221', 'cellartracker_inventory',
    repeat('a', 64), 'ct.csv', 1024, 'cellartracker/test.csv',
    '11111111-1111-1111-1111-111111111111', 'test', 'accepted',
    TIMESTAMPTZ '2099-01-01', '11111111-1111-1111-1111-111111111111'
);

INSERT INTO public.cellar_import_rows (import_id, source_row_number, raw_row, match_status)
VALUES
    ('22222222-2222-2222-2222-222222222221', 1, '{}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222221', 2, '{}'::JSONB, 'unmatched'),
    ('22222222-2222-2222-2222-222222222221', 3, '{}'::JSONB, 'unmatched');

INSERT INTO public.cellartracker_evidence (
    import_id, source_row_number, source_wine, source_match_key, vintage,
    bottle_volume_ml, purchase_price_per_bottle_p, quantity_home, quantity_bbr,
    total_quantity, fully_consumed, producer
)
VALUES
    ('22222222-2222-2222-2222-222222222221', 1, 'CT Alpha', 'ct alpha', 2020, 750, 4000, 6, 0, 6, FALSE, 'CT Producer'),
    ('22222222-2222-2222-2222-222222222221', 2, 'CT Beta', 'ct beta', 2021, 750, 4100, 6, 0, 6, FALSE, 'CT Producer'),
    ('22222222-2222-2222-2222-222222222221', 3, 'CT Gamma', 'ct gamma', 2022, 750, 4200, 6, 0, 6, FALSE, 'CT Producer');

INSERT INTO public.cellartracker_product_resolutions (
    import_id, source_row_number, status, parent_sku, match_method, resolved_by
)
VALUES ('22222222-2222-2222-2222-222222222221', 2, 'linked', '20140000001', 'manual', '11111111-1111-1111-1111-111111111111');

INSERT INTO public.cellartracker_record_decisions (match_group_key, source_wine, is_excluded, excluded_at)
VALUES ('2022|ct gamma', 'CT Gamma', TRUE, now());

INSERT INTO public.cellartracker_match_runs (id, snapshot_import_id, started_by, status)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111', 'completed');

INSERT INTO public.cellartracker_match_suggestions (
    match_group_key, parent_sku, source_run_id, rank, name, was_biddable_at_observation, observed_at, match_score
)
VALUES ('2020|ct alpha', '20140000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, 'Alpha Catalogue Wine', TRUE, now(), 0.80);

-- === Structure ==========================================================

SELECT has_view('public', 'wine_match_review_view', 'the union review view exists');
SELECT has_view('public', 'wine_match_suggestion_view', 'the union suggestion view exists');
SELECT has_function('public', 'wine_match_queue_summary', ARRAY['text'], 'the summary function exists');

SELECT columns_are(
    'public', 'wine_match_review_view',
    ARRAY[
        'source', 'match_group_key', 'wine_ref', 'parent_sku', 'match_method',
        'source_wine', 'source_vintage', 'source_row_count', 'unresolved_row_count',
        'linked_row_count', 'suppressed_row_count', 'is_bbx_eligible', 'suggestion_count',
        'top_match_score', 'suggestions_observed_at', 'last_run_status', 'last_error_at'
    ],
    'wine_match_review_view exposes exactly the common review projection'
);
SELECT columns_are(
    'public', 'wine_match_suggestion_view',
    ARRAY[
        'source', 'match_group_key', 'parent_sku', 'rank', 'name', 'vintage',
        'producer', 'region', 'match_score', 'is_bbx_eligible', 'observed_at'
    ],
    'wine_match_suggestion_view exposes exactly the common suggestion projection'
);

-- The three new columns reach both per-source branches with the same types.
SELECT col_type_is('public', 'release_offer_match_review_view', 'last_run_status', 'text', 'release-offer branch: last_run_status is text');
SELECT col_type_is('public', 'release_offer_match_review_view', 'last_error_at', 'timestamp with time zone', 'release-offer branch: last_error_at is timestamptz');
SELECT col_type_is('public', 'release_offer_match_review_view', 'top_match_score', 'numeric', 'release-offer branch: top_match_score is numeric');
SELECT col_type_is('public', 'cellartracker_match_review_view', 'last_run_status', 'text', 'cellartracker branch: last_run_status is text');
SELECT col_type_is('public', 'cellartracker_match_review_view', 'last_error_at', 'timestamp with time zone', 'cellartracker branch: last_error_at is timestamptz');
SELECT col_type_is('public', 'cellartracker_match_review_view', 'top_match_score', 'numeric', 'cellartracker branch: top_match_score is numeric');

SELECT col_type_is('public', 'wine_match_review_view', 'source', 'text', 'union: source is text');
SELECT col_type_is('public', 'wine_match_review_view', 'wine_ref', 'text', 'union: wine_ref is text');
SELECT col_type_is('public', 'wine_match_review_view', 'is_bbx_eligible', 'boolean', 'union: is_bbx_eligible is boolean');

SELECT results_eq(
    $$
        SELECT c.relname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY (ARRAY['wine_match_review_view', 'wine_match_suggestion_view'])
          AND c.reloptions @> ARRAY['security_invoker=true']
        ORDER BY c.relname
    $$,
    $$ VALUES ('wine_match_review_view'::name), ('wine_match_suggestion_view'::name) $$,
    'both union views use invoker security'
);

SELECT is(
    (SELECT prosecdef FROM pg_proc WHERE proname = 'wine_match_queue_summary'),
    FALSE,
    'wine_match_queue_summary is SECURITY INVOKER'
);
SELECT is(has_function_privilege('authenticated', 'public.wine_match_queue_summary(text)', 'EXECUTE'), TRUE, 'authenticated may execute the summary function');
SELECT is(has_function_privilege('anon', 'public.wine_match_queue_summary(text)', 'EXECUTE'), FALSE, 'anon may not execute the summary function');
SELECT is(has_table_privilege('anon', 'public.wine_match_review_view', 'SELECT'), FALSE, 'anon has no SELECT on the union review view');
SELECT is(has_table_privilege('authenticated', 'public.wine_match_review_view', 'SELECT'), TRUE, 'authenticated has SELECT on the union review view');

-- === Content (owner claim set, RLS bypassed by the test role) ============

SELECT is(
    (SELECT count(DISTINCT source)::INT FROM public.wine_match_review_view),
    2,
    'the review view carries both sources'
);

SELECT is(
    (SELECT source_row_count FROM public.wine_match_review_view WHERE source = 'release_offer' AND match_group_key = '2014|alpha'),
    1,
    'an excluded release-offer row is dropped from the group row count'
);
SELECT is(
    (SELECT unresolved_row_count FROM public.wine_match_review_view WHERE source = 'release_offer' AND match_group_key = '2014|alpha'),
    1,
    'the excluded row no longer inflates unresolved_row_count'
);
SELECT is_empty(
    $$ SELECT 1 FROM public.wine_match_review_view WHERE source = 'release_offer' AND match_group_key = '2019|zeta' $$,
    'a fully-excluded release-offer group disappears from the queue'
);
SELECT is_empty(
    $$ SELECT 1 FROM public.wine_match_review_view WHERE source = 'cellartracker' AND match_group_key = '2022|ct gamma' $$,
    'a fully-excluded CellarTracker group disappears from the queue'
);

SELECT is(
    (SELECT wine_ref FROM public.wine_match_review_view WHERE source = 'release_offer' AND match_group_key = '2015|beta'),
    'parent:20140000001',
    'a linked group exposes wine_ref as parent:<sku>'
);
SELECT is(
    (SELECT is_bbx_eligible FROM public.wine_match_review_view WHERE source = 'release_offer' AND match_group_key = '2015|beta'),
    TRUE,
    'a linked group whose parent has a live catalogue SKU is BBX-eligible'
);
SELECT is(
    (SELECT is_bbx_eligible FROM public.wine_match_review_view WHERE source = 'release_offer' AND match_group_key = '2017|delta'),
    FALSE,
    'a linked group whose parent is absent from the catalogue is not BBX-eligible'
);
SELECT is(
    (SELECT wine_ref FROM public.wine_match_review_view WHERE source = 'release_offer' AND match_group_key = '2014|alpha'),
    NULL,
    'an unlinked group has a null wine_ref'
);

SELECT is(
    (SELECT top_match_score FROM public.wine_match_review_view WHERE source = 'release_offer' AND match_group_key = '2014|alpha'),
    0.90,
    'top_match_score is the best suggestion score in the group'
);
SELECT is(
    (SELECT suggestion_count FROM public.wine_match_review_view WHERE source = 'release_offer' AND match_group_key = '2014|alpha'),
    2,
    'suggestion_count counts the group suggestions'
);

SELECT is(
    (SELECT last_run_status FROM public.wine_match_review_view WHERE source = 'release_offer' AND match_group_key = '2017|delta'),
    'failed',
    'last_run_status reflects the most recent run group status'
);
SELECT is(
    (SELECT unresolved_row_count FROM public.wine_match_review_view WHERE source = 'release_offer' AND match_group_key = '2017|delta'),
    0,
    'the delta group is fully resolved despite the failed run, so it is linked, not a queue item'
);

SELECT is(
    (SELECT count(*)::INT FROM public.wine_match_review_view WHERE source = 'release_offer' AND match_group_key = '2018|epsilon'),
    1,
    'a mixed group appears exactly once'
);
SELECT is(
    (SELECT unresolved_row_count > 0 AND linked_row_count > 0 FROM public.wine_match_review_view WHERE source = 'release_offer' AND match_group_key = '2018|epsilon'),
    TRUE,
    'the mixed group has both linked and unresolved rows'
);

SELECT is(
    (SELECT count(*)::INT FROM public.wine_match_suggestion_view WHERE source = 'release_offer' AND match_group_key = '2014|alpha'),
    2,
    'the suggestion union carries both release-offer suggestions'
);
SELECT is(
    (SELECT count(*)::INT FROM public.wine_match_suggestion_view WHERE source = 'cellartracker' AND match_group_key = '2020|ct alpha'),
    1,
    'the suggestion union carries the CellarTracker suggestion under its own source'
);

-- === Summary parity =====================================================

SELECT is(
    (SELECT needs_review FROM public.wine_match_queue_summary(NULL)),
    (SELECT count(*) FROM public.wine_match_review_view WHERE unresolved_row_count > 0),
    'summary needs_review equals the unresolved backlog'
);
SELECT is(
    (SELECT with_suggestions FROM public.wine_match_queue_summary(NULL)),
    (SELECT count(*) FROM public.wine_match_review_view
       WHERE unresolved_row_count > 0 AND last_run_status IS DISTINCT FROM 'failed' AND suggestion_count > 0),
    'summary with_suggestions equals a direct count'
);
SELECT is(
    (SELECT no_suggestions FROM public.wine_match_queue_summary(NULL)),
    (SELECT count(*) FROM public.wine_match_review_view
       WHERE unresolved_row_count > 0 AND last_run_status IS DISTINCT FROM 'failed' AND suggestion_count = 0),
    'summary no_suggestions equals a direct count'
);
SELECT is(
    (SELECT errors FROM public.wine_match_queue_summary(NULL)),
    (SELECT count(*) FROM public.wine_match_review_view
       WHERE unresolved_row_count > 0 AND last_run_status = 'failed'),
    'summary errors equals a direct count'
);
SELECT is(
    (SELECT with_suggestions + no_suggestions + errors FROM public.wine_match_queue_summary(NULL)),
    (SELECT needs_review FROM public.wine_match_queue_summary(NULL)),
    'the three queue buckets partition needs_review exactly'
);
SELECT is(
    (SELECT linked FROM public.wine_match_queue_summary(NULL)),
    (SELECT count(*) FROM public.wine_match_review_view WHERE linked_row_count > 0 AND unresolved_row_count = 0),
    'summary linked equals a direct count'
);
SELECT is(
    (SELECT no_suitable_match FROM public.wine_match_queue_summary(NULL)),
    (SELECT count(*) FROM public.wine_match_review_view WHERE suppressed_row_count > 0 AND unresolved_row_count = 0),
    'summary no_suitable_match equals a direct count'
);
SELECT is(
    (SELECT all_groups FROM public.wine_match_queue_summary(NULL)),
    (SELECT count(*) FROM public.wine_match_review_view),
    'summary all_groups equals the total row count'
);
SELECT is(
    (SELECT all_groups FROM public.wine_match_queue_summary('release_offer')),
    (SELECT count(*) FROM public.wine_match_review_view WHERE source = 'release_offer'),
    'summary is scoped to source=release_offer'
);
SELECT is(
    (SELECT all_groups FROM public.wine_match_queue_summary('cellartracker')),
    (SELECT count(*) FROM public.wine_match_review_view WHERE source = 'cellartracker'),
    'summary is scoped to source=cellartracker'
);

-- Explicit bucket values for this fixture set:
--   needs_review (unresolved > 0): 2014|alpha, 2018|epsilon, 2023|eta, 2020|ct alpha  = 4
--   with_suggestions: 2014|alpha, 2020|ct alpha                                       = 2
--   no_suggestions: 2018|epsilon                                                      = 1
--   errors: 2023|eta                                                                  = 1
--   linked: 2015|beta, 2017|delta, 2021|ct beta                                       = 3
--   no_suitable_match: 2016|gamma                                                     = 1
--   all_groups: alpha,beta,gamma,delta,epsilon,eta + ct alpha,ct beta                 = 8
SELECT results_eq(
    $$ SELECT needs_review, with_suggestions, no_suggestions, errors, linked, no_suitable_match, all_groups
       FROM public.wine_match_queue_summary(NULL) $$,
    $$ VALUES (4::BIGINT, 2::BIGINT, 1::BIGINT, 1::BIGINT, 3::BIGINT, 1::BIGINT, 8::BIGINT) $$,
    'the summary buckets match the hand-computed fixture totals'
);

-- === Access =============================================================

SET LOCAL ROLE anon;
SELECT throws_ok(
    'SELECT 1 FROM public.wine_match_review_view',
    '42501', NULL,
    'anon cannot read the union review view'
);
SELECT throws_ok(
    'SELECT 1 FROM public.wine_match_suggestion_view',
    '42501', NULL,
    'anon cannot read the union suggestion view'
);
SELECT throws_ok(
    'SELECT * FROM public.wine_match_queue_summary(NULL)',
    '42501', NULL,
    'anon cannot execute the summary function'
);
RESET ROLE;

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;
SELECT is_empty('SELECT 1 FROM public.wine_match_review_view', 'a non-owner authenticated caller sees no review rows');
SELECT is_empty('SELECT 1 FROM public.wine_match_suggestion_view', 'a non-owner authenticated caller sees no suggestion rows');
SELECT is(
    (SELECT all_groups FROM public.wine_match_queue_summary(NULL)),
    0::BIGINT,
    'a non-owner authenticated caller gets an all-zero summary'
);
RESET ROLE;

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    TRUE
);
SET LOCAL ROLE authenticated;
SELECT isnt(
    (SELECT count(*) FROM public.wine_match_review_view),
    0::BIGINT,
    'the owner sees the review rows through RLS'
);
SELECT is(
    (SELECT all_groups FROM public.wine_match_queue_summary(NULL)),
    8::BIGINT,
    'the owner gets the real summary through RLS'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
