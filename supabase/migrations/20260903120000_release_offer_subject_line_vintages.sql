-- Backfill vintages that were never in the body of the offer email.
--
-- The historic offer sheet was compiled from email bodies only; the subject
-- line was not captured. Where an offer stated its vintage once -- in the
-- subject ("2013 Rhone En Primeur - Released") or in an intro paragraph --
-- and then listed the wines without repeating it, the parser had no year to
-- find. `source_vintage` is derived by regex from the Wine text
-- (apps/web/src/lib/releaseOffers/parser.ts), so those rows landed with a NULL
-- vintage and grouped under `unknown|<match key>`, producing one review
-- candidate per plausible vintage instead of one per wine.
--
-- 47 of 3,545 rows have no vintage. Only these 28 (22 match groups) are the
-- bug: 11 rows are genuinely non-vintage wines, where NULL is correct (BBR
-- itself encodes those as a `1000`-prefixed parent SKU), 7 are prose fragments
-- that are not wines at all, and row 1101 is a four-vintage Elderton Command
-- offer flattened into one row -- a missing-rows problem, not a missing-vintage
-- one, so it is deliberately left alone.
--
-- Each vintage below was established from evidence, not inference alone:
--
--   2007  59, 60, 61      Verite offer body: "In the 2007 vintage these three
--                         all have the perfect 100 from Parker" (GBP 1425/6
--                         matches all three rows). Vintage was in neither the
--                         subject nor the wine names.
--   2010  626, 627, 628   Gaja Brunello; all 8 siblings in the email are 2010.
--   2011  382, 383        Subject "2011 Olivier Bernstein - The modern face of
--                         Burgundy"; body lists both whites at GBP 360/6.
--   2013  560             Same-day sibling mailer "2013 Ch. Giscours - just
--                         released" (Bordeaux 2013 En Primeur).
--   2013  637, 638        Subject "2013 Rhone En Primeur - Released"; siblings
--                         agree.
--   2014  657 .. 715      Echo de Lynch Bages, one match group across seven
--                         rows; six of the seven emails carry 2014 only.
--   2014  825             Sibling in the same email.
--   2015  934             Subject "2015 Ch. Pedesclaux, Pauillac - New
--                         Vineyards and a New Benchmark".
--   2015  1141 .. 1144    Subject "2015 Rhone En Primeur - A gold-plated
--                         triumph, Simon Field MW".
--   2022  2226            Six siblings, all 2022.
--   2023  2647, 2648      Five siblings, all 2023.
--   2024  2791            Siblings in the same email.
--
-- Both fields are set: `source_vintage` for grouping and matching, and a
-- vintage prefix on `source_wine` so the row reads the way the parser would
-- have produced it had the source carried the year. `source_match_key` is
-- unaffected -- releaseWineMatchKey() strips years wherever they appear -- so
-- only the generated `match_group_key` changes, from `unknown|<key>` to
-- `<vintage>|<key>`. `raw_row` keeps the original CSV verbatim as evidence and
-- `content_fingerprint` is deliberately left at its staged value: it is a
-- historical artefact of the import that produced these rows, not a live
-- checksum.
--
-- The `source_vintage IS NULL` guard makes this safe to re-run and stops a
-- second prefix ever being prepended.

UPDATE public.release_offer_source_rows AS r
SET source_vintage = fix.vintage,
    source_wine = fix.vintage || ' ' || r.source_wine
FROM (VALUES
    (59, 2007), (60, 2007), (61, 2007),
    (626, 2010), (627, 2010), (628, 2010),
    (382, 2011), (383, 2011),
    (560, 2013), (637, 2013), (638, 2013),
    (657, 2014), (659, 2014), (661, 2014), (675, 2014),
    (683, 2014), (713, 2014), (715, 2014), (825, 2014),
    (934, 2015), (1141, 2015), (1142, 2015), (1143, 2015), (1144, 2015),
    (2226, 2022),
    (2647, 2023), (2648, 2023),
    (2791, 2024)
) AS fix(source_row_number, vintage)
WHERE r.import_id = '6bfd17fb-9eaa-4b2d-bf51-31de8a0a006b'
  AND r.source_row_number = fix.source_row_number
  AND r.source_vintage IS NULL;

-- Row 1143 (Condrieu, Cote Chatillon, Domaine Mouton) is the one link this bug
-- is known to have corrupted. With no vintage to constrain it, matching linked
-- the 2015 En Primeur offer to parent SKU 20198000297 -- the 2019 -- and the
-- link was confirmed. Drop it so the row returns to the review queue and is
-- re-matched against the now-known 2015. The audit trigger records the unlink;
-- `changed_by` is NULL because this runs as a migration, not as the owner.
--
-- The rest of the corpus is clean on this test: BBR prefixes each parent SKU
-- with the wine's vintage, and across all 1,138 linked rows with a known
-- vintage there are zero disagreements between the two.

DELETE FROM public.release_offer_product_resolutions
WHERE import_id = '6bfd17fb-9eaa-4b2d-bf51-31de8a0a006b'
  AND source_row_number = 1143
  AND parent_sku = '20198000297';
