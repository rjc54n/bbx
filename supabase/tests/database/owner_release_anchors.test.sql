-- Step 3 (docs/WINE-RECORD-SPEC.md §11): owner release anchors and the resolved
-- anchor view's owner branch. The owner-outranks-imported head-to-head is
-- covered by the release_offer_pricing fixtures + a read-only prod spot-check;
-- here we pin the write functions, the owner branch of the resolved view, the
-- card integration, and the owner-only guard on minimal fixtures.

BEGIN;
SELECT plan(18);

INSERT INTO auth.users (id) VALUES
    ('41000000-0000-0000-0000-000000000001'),
    ('41000000-0000-0000-0000-000000000002');
INSERT INTO public.app_owners (user_id) VALUES ('41000000-0000-0000-0000-000000000001');
INSERT INTO private.scan_runs (id, scope, run_date, status, started_at)
VALUES ('42000000-0000-0000-0000-000000000001', 'owner-anchor-test', DATE '2026-08-17', 'completed', now());
INSERT INTO private.products (
    parent_sku, name, vintage, region, colour, producer,
    first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at, last_rest_checked_at
) VALUES (
    '42000000001', 'Owner anchor wine 2018', 2018, 'Bordeaux', 'Red', 'Test producer',
    '42000000-0000-0000-0000-000000000001', now(),
    '42000000-0000-0000-0000-000000000001', now(), now()
);
-- Two live formats: A gets an owner anchor, B stays anchor-less.
INSERT INTO private.skus (
    parent_sku, format_code, case_size, bottle_volume_ml,
    least_listing_price_p, market_price_p, highest_bid_p, is_listed,
    first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at
) VALUES
    ('42000000001', '06-00750', 6, 750, 9000, 9500, 8000, TRUE,
     '42000000-0000-0000-0000-000000000001', now(),
     '42000000-0000-0000-0000-000000000001', now()),
    ('42000000001', '01-01500', 1, 1500, 3200, 3400, 3000, TRUE,
     '42000000-0000-0000-0000-000000000001', now(),
     '42000000-0000-0000-0000-000000000001', now());

-- Grants / RLS surface -------------------------------------------------------
SELECT is(has_table_privilege('anon', 'public.owner_release_anchors', 'SELECT'), FALSE,
    'anon cannot read owner release anchors');
SELECT is(has_table_privilege('authenticated', 'public.owner_release_anchors', 'SELECT'), TRUE,
    'authenticated receives owner-gated read access');
SELECT is(has_function_privilege('anon',
    'public.set_owner_release_anchor(text,text,integer,text,date,text)', 'EXECUTE'), FALSE,
    'anon cannot set an owner anchor');
SELECT is(has_function_privilege('authenticated',
    'public.set_owner_release_anchor(text,text,integer,text,date,text)', 'EXECUTE'), TRUE,
    'authenticated may call the guarded setter');

SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-0000-0000-000000000001","role":"authenticated"}', TRUE);
SET LOCAL ROLE authenticated;

-- Write path -----------------------------------------------------------------
SELECT is(
    public.set_owner_release_anchor('42000000001', '06-00750', 42000)->>'release_price_p',
    '42000', 'owner sets a release price for format A');
SELECT is(
    (SELECT superseded_source_price_p FROM public.owner_release_anchors
     WHERE wine_ref = 'parent:42000000001' AND format_code = '06-00750'),
    NULL, 'superseded value is NULL when the import had no anchor');

-- Resolved view: owner branch ------------------------------------------------
SELECT is(
    (SELECT anchor_status FROM public.resolved_release_anchor_view
     WHERE parent_sku = '42000000001' AND format_code = '06-00750'),
    'owner', 'resolved view labels the format owner-anchored');
SELECT is(
    (SELECT release_price_p FROM public.resolved_release_anchor_view
     WHERE parent_sku = '42000000001' AND format_code = '06-00750'),
    42000, 'resolved view carries the owner price');
SELECT is(
    (SELECT count(*) FROM public.resolved_release_anchor_view
     WHERE parent_sku = '42000000001' AND format_code = '01-01500'),
    0::BIGINT, 'a format with no owner and no imported anchor has no resolved row');

-- Card integration -----------------------------------------------------------
SELECT is(
    (SELECT release_price_p FROM public.wine_card_format_view
     WHERE parent_sku = '42000000001' AND format_code = '06-00750'),
    42000, 'the wine card shows the owner release price');
SELECT is(
    (SELECT anchor_status FROM public.wine_card_format_view
     WHERE parent_sku = '42000000001' AND format_code = '06-00750'),
    'owner', 'the wine card shows the owner anchor status');
SELECT ok(
    (SELECT release_price_p IS NULL FROM public.wine_card_format_view
     WHERE parent_sku = '42000000001' AND format_code = '01-01500'),
    'a format with no anchor still lists with a NULL release price');

-- Upsert + clear -------------------------------------------------------------
SELECT is(
    public.set_owner_release_anchor('42000000001', '06-00750', 43500)->>'release_price_p',
    '43500', 'a second set overwrites the owner price');
SELECT is(
    public.clear_owner_release_anchor('42000000001', '06-00750')->>'cleared',
    'true', 'clear removes the owner anchor');
SELECT is(
    (SELECT count(*) FROM public.resolved_release_anchor_view
     WHERE parent_sku = '42000000001' AND format_code = '06-00750'),
    0::BIGINT, 'after clearing, no owner (or imported) anchor remains');

-- Validation + owner guard ---------------------------------------------------
SELECT throws_ok(
    $$ SELECT public.set_owner_release_anchor('42000000001', '06-00750', 0) $$,
    '22023', 'valid parent, format and a positive price are required',
    'a non-positive price is rejected');
SELECT throws_ok(
    $$ SELECT public.set_owner_release_anchor('42000000001', '99-99999', 42000) $$,
    'P0002', 'format not found for this wine',
    'an unknown format is rejected');

-- A non-owner authenticated user cannot write.
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-0000-0000-000000000002","role":"authenticated"}', TRUE);
SELECT throws_ok(
    $$ SELECT public.set_owner_release_anchor('42000000001', '06-00750', 42000) $$,
    '42501', 'not authorised',
    'a non-owner cannot set an owner anchor');

SELECT * FROM finish();
ROLLBACK;
