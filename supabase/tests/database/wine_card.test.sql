-- Step 1 of the canonical wine record (docs/WINE-RECORD-SPEC.md): structure of
-- the two card views. Anchor-metric parity with release_price_market_view is
-- proven separately by a read-only diff against production anchors; here we pin
-- identity, is_biddable and the catalogue-driven format set on local fixtures.

BEGIN;
SELECT plan(8);

-- P1: two live formats + one delisted format.
INSERT INTO private.products (parent_sku, name, vintage, region, colour, producer, first_seen_at, last_seen_at)
VALUES ('90000000001', 'Ch. Card 2018', 2018, 'Bordeaux', 'Red', 'Prod A', now(), now());
INSERT INTO private.skus (parent_sku, format_code, case_size, bottle_volume_ml, least_listing_price_p, first_seen_at, last_seen_at)
VALUES ('90000000001', '06-00750', 6, 750, 9000, now(), now()),
       ('90000000001', '01-01500', 1, 1500, 3200, now(), now());
INSERT INTO private.skus (parent_sku, format_code, case_size, bottle_volume_ml, least_listing_price_p, first_seen_at, last_seen_at, gone_since)
VALUES ('90000000001', '12-00750', 12, 750, 17000, now(), now(), now());

-- P2: known to BBR but only a delisted sku -> not currently biddable.
INSERT INTO private.products (parent_sku, name, vintage, region, colour, producer, first_seen_at, last_seen_at)
VALUES ('90000000002', 'Dom. Gone 2019', 2019, 'Burgundy', 'White', 'Prod B', now(), now());
INSERT INTO private.skus (parent_sku, format_code, case_size, bottle_volume_ml, least_listing_price_p, first_seen_at, last_seen_at, gone_since)
VALUES ('90000000002', '06-00750', 6, 750, 15000, now(), now(), now());

-- wine_card_view: one row per product, correct wine_ref, is_biddable by live sku.
SELECT is(
  (SELECT COUNT(*) FROM public.wine_card_view WHERE parent_sku IN ('90000000001', '90000000002')),
  2::BIGINT,
  'wine_card_view has one row per product'
);
SELECT is(
  (SELECT wine_ref FROM public.wine_card_view WHERE parent_sku = '90000000001'),
  'parent:90000000001',
  'wine_ref is parent:<parent_sku>'
);
SELECT is(
  (SELECT is_biddable FROM public.wine_card_view WHERE parent_sku = '90000000001'),
  TRUE,
  'a wine with a live sku is biddable'
);
SELECT is(
  (SELECT is_biddable FROM public.wine_card_view WHERE parent_sku = '90000000002'),
  FALSE,
  'a wine whose only sku is gone is not biddable'
);

-- wine_card_format_view: catalogue-driven, so only live formats appear.
SELECT is(
  (SELECT COUNT(*) FROM public.wine_card_format_view WHERE parent_sku = '90000000001'),
  2::BIGINT,
  'only live formats surface; the delisted one is excluded'
);
SELECT is(
  (SELECT COUNT(*) FROM public.wine_card_format_view WHERE parent_sku = '90000000002'),
  0::BIGINT,
  'a wine with no live format has no card rows'
);
SELECT is(
  (SELECT lowest_ask_p FROM public.wine_card_format_view WHERE parent_sku = '90000000001' AND format_code = '06-00750'),
  9000,
  'lowest_ask_p carries the least listing price'
);
-- With no release anchor, the release columns and derived metrics are NULL.
SELECT ok(
  (SELECT release_price_p IS NULL AND ask_vs_release_pct IS NULL
   FROM public.wine_card_format_view WHERE parent_sku = '90000000001' AND format_code = '06-00750'),
  'no anchor leaves release price and vs-release metrics NULL'
);

SELECT * FROM finish();
ROLLBACK;
