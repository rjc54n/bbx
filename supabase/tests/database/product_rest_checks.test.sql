-- REST-check timestamp decoupling (20261002120000). "Market checked" now comes
-- from private.product_rest_checks.published_at through catalogue_view; the
-- products column and both cached copies are frozen and must not leak through.

BEGIN;
SELECT plan(8);

INSERT INTO private.products (parent_sku, name, vintage, first_seen_at, last_seen_at, last_rest_checked_at)
VALUES ('RC1', 'Rest Check 2018', 2018, now(), now(), '2026-01-01T00:00:00Z');
INSERT INTO private.skus (parent_sku, format_code, case_size, bottle_volume_ml, least_listing_price_p, first_seen_at, last_seen_at)
VALUES ('RC1', '06-00750', 6, 750, 9000, now(), now());
INSERT INTO private.product_rest_checks (parent_sku, checked_at, published_at)
VALUES ('RC1', '2026-10-02T21:30:00Z', '2026-10-01T21:30:00Z');

SELECT private.rebuild_catalogue_caches();

SELECT has_table('private', 'product_rest_checks', 'freshness table exists in private');
SELECT ok(has_table_privilege('anon', 'private.product_rest_checks', 'SELECT'),
          'anon can read it (catalogue_view is security_invoker)');
SELECT ok(has_table_privilege('authenticated', 'private.product_rest_checks', 'SELECT'),
          'authenticated can read it');
SELECT ok(NOT has_table_privilege('authenticated', 'private.product_rest_checks', 'INSERT'),
          'authenticated cannot write it');

SELECT is(
  (SELECT last_rest_checked_at FROM public.catalogue_view WHERE parent_sku = 'RC1'),
  '2026-10-01T21:30:00Z'::timestamptz,
  'catalogue_view shows published_at, not the unpublished checked_at'
);

SELECT is(
  (SELECT last_rest_checked_at FROM public.wine_card_format_view WHERE parent_sku = 'RC1'),
  '2026-10-01T21:30:00Z'::timestamptz,
  'views built on catalogue_view inherit the published value'
);

-- The frozen products column no longer reaches the UI, cached or not.
UPDATE private.products SET last_rest_checked_at = '2030-01-01T00:00:00Z' WHERE parent_sku = 'RC1';
SELECT private.rebuild_catalogue_caches();
SELECT is(
  (SELECT last_rest_checked_at FROM public.catalogue_view WHERE parent_sku = 'RC1'),
  '2026-10-01T21:30:00Z'::timestamptz,
  'products.last_rest_checked_at is ignored'
);

-- Publishing moves the UI value without any cache refresh.
UPDATE private.product_rest_checks SET published_at = checked_at WHERE parent_sku = 'RC1';
SELECT is(
  (SELECT last_rest_checked_at FROM public.catalogue_view WHERE parent_sku = 'RC1'),
  '2026-10-02T21:30:00Z'::timestamptz,
  'publishing updates Market checked directly'
);

SELECT * FROM finish();
ROLLBACK;
