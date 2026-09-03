-- Exclude 14 source rows that are not wines.
--
-- Compiling the historic sheet from email bodies occasionally captured a line
-- that sits next to an offer rather than being one: a critic's credit, a grape
-- breakdown, a drinking window, a sentence of the sales pitch. Each landed as a
-- row with a real price attached, so it survived validation and now sits in the
-- review queue as a match group that can never resolve.
--
-- Exclusion, not deletion: `delete_release_offer_record` was dropped in
-- 20260730090000 in favour of `exclude_release_offer_record`, which keeps the
-- row and its raw CSV as evidence and hides it from the read surface. The
-- exclusion is keyed on `content_fingerprint`, so if the same line is ever
-- re-imported from a later file it stays excluded with no bookkeeping. Undo is
-- `restore_release_offer_record`.
--
-- This runs as a migration rather than through the RPC, which requires an owner
-- session, so it writes what the function writes: the audit event first, then
-- the exclusion. `excluded_by` and `changed_by` are NULL for the same reason.
--
--   Critic credits and scores captured as a wine name
--     41    (Robert Parker- Wine Advocate- May 2011)
--     1003  97/100 points - James Suckling - March 2016
--     1087  (91-93)/100 Allen Meadows, Burghound Jan 2016
--     2101  2010 - 94/100
--     2103  2010 - 94/100
--     2845  91-93/100. Neal Martin, Vinous, May 2025
--
--   Grape and blend breakdowns
--     42    (58% Cabernet Sauvignon, 33% Merlot, 9% Cabernet Franc. 13.8% abv)
--     1078  55% Chardonnay, 45% Pinot Noir
--     2694  (Blend of 2009 Miltonduff & 2010 Braeval)
--
--   Sentences of body copy
--     1076  Drink now to 2022+"
--     1429  Tignanello is a darling across the world [...]
--     2774  Last year, Chateau Lafite Rothschild was released at
--
--   A bare region, and a truncated fragment
--     400   Pauillac) at
--     1077  Bordeaux
--
-- Six of these carry a vintage the regex lifted out of a date or a score
-- ("May 2011", "94/100" preceded by 2010), which is why they group as plausible
-- wines rather than obvious noise. None is linked to a product; row 1077 had
-- already been ignored by hand.
--
-- Deliberately NOT included: rows 148-174, twenty-seven rows reading "1 case
-- <year>" with a price and no wine name. They came from the "Affordable First
-- Growths" offer of 16 and 20 February 2012, so the wines are recoverable from
-- the email body by matching price to wine. That is a repair, not junk.

WITH junk AS (
    SELECT r.import_id, r.source_row_number, r.content_fingerprint,
           r.match_group_key, r.source_wine, r.offer_date
    FROM public.release_offer_source_rows r
    JOIN public.release_offer_imports i ON i.id = r.import_id AND i.status = 'accepted'
    WHERE r.import_id = '6bfd17fb-9eaa-4b2d-bf51-31de8a0a006b'
      AND r.source_row_number IN (
          41, 42, 400, 1003, 1076, 1077, 1078,
          1087, 1429, 2101, 2103, 2694, 2774, 2845
      )
), logged AS (
    INSERT INTO public.release_offer_resolution_events (
        import_id, source_row_number, event_type,
        previous_status, previous_parent_sku, previous_match_method
    )
    SELECT junk.import_id, junk.source_row_number, 'deleted',
           resolution.status, resolution.parent_sku, resolution.match_method
    FROM junk
    LEFT JOIN public.release_offer_product_resolutions resolution
      ON resolution.import_id = junk.import_id
     AND resolution.source_row_number = junk.source_row_number
    RETURNING source_row_number
)
-- Rows 2101 and 2103 are the same line captured twice in one offer, so they
-- share a content_fingerprint. DISTINCT keeps the upsert from touching that
-- exclusion row twice in a single statement.
INSERT INTO public.release_offer_record_exclusions (
    content_fingerprint, match_group_key, source_wine, offer_date
)
SELECT DISTINCT ON (junk.content_fingerprint)
       junk.content_fingerprint, junk.match_group_key, junk.source_wine, junk.offer_date
FROM junk, (SELECT count(*) FROM logged) AS logged_count
ORDER BY junk.content_fingerprint, junk.source_row_number
ON CONFLICT (content_fingerprint) DO UPDATE SET excluded_at = now();
