-- Backfill producers that were only in the subject line of the offer email.
--
-- The same failure as the missing vintages, one field over. Some offers are
-- single-producer: the subject names the producer once, and the body then lists
-- bare appellations. "2010 Chambolle-Musigny 1er cru" cannot resolve, because
-- dozens of producers make one -- and nothing in the row says whose it is.
--
-- Four offers in the corpus have this shape, 43 rows between them. Each
-- producer was read from the email and then checked line by line against the
-- row prices, which match exactly in all four cases:
--
--   2011-10-17  rows 62-77   Domaine des Comtes Lafon
--               Subject "Mature Domaine des Comtes Lafon Parcel". Sixteen
--               wines, sixteen rows, every price matching -- Le Montrachet
--               1987-2004 plus Meursault Desiree, Clos de la Barre, Goutte
--               d'Or, Les Charmes and Perrieres, all Lafon cuvees.
--   2012-03-29  rows 191-203 Olivier Bernstein
--               Subject "2010 Olivier Bernstein - World class Burgundy".
--               Thirteen rows, the same range Bernstein offered again in the
--               2013 email whose vintages were repaired in 20260903120000.
--   2015-08-07  rows 756-763 Domaine Guyon
--               Subject "An exciting debut - Vosne Romanee from Domaine
--               Guyon". Rows 756, 757 and 760 already link to Domaine Guyon
--               products, which corroborates the reading.
--   2015-11-10  rows 800-805 Camille Giroud
--               Subject "Stunning Back Vintage Burgundy Parcel" names no
--               producer; the body does -- "from the historic Camille Giroud
--               property". All six prices match.
--
-- Unlike the vintage repair, `source_wine` alone is not enough here.
-- `match_group_key` is generated from `source_vintage` and `source_match_key`,
-- and `source_match_key` is written by the parser at import time rather than
-- derived from `source_wine` in the database. Appending the producer to the
-- display name only would leave matching seeing exactly what it saw before. So
-- both are updated: the producer is appended to `source_wine` for the reader,
-- and its normalised tokens to `source_match_key` for the matcher, which moves
-- the group key from `2010|chambolle musigny 1er cru` to
-- `2010|chambolle musigny 1er cru olivier bernstein`.
--
-- Product resolutions are keyed on (import_id, source_row_number), not on the
-- group key, so the three existing Guyon links survive the regrouping. Their
-- old suggestions orphan, like every other repaired group, and are replaced on
-- the next match run.
--
-- `content_fingerprint` is left at its staged value, as in 20260903120000: it
-- records what the import produced, not what the row now says.
--
-- The `source_match_key NOT LIKE` guard makes this safe to re-run.

UPDATE public.release_offer_source_rows AS r
SET source_wine = r.source_wine || ', ' || fix.producer,
    source_match_key = r.source_match_key || ' ' || fix.match_tokens
FROM (VALUES
    (date '2011-10-17', 62,  77,  'Domaine des Comtes Lafon', 'domaine des comtes lafon'),
    (date '2012-03-29', 191, 203, 'Olivier Bernstein',        'olivier bernstein'),
    (date '2015-08-07', 756, 763, 'Domaine Guyon',            'domaine guyon'),
    (date '2015-11-10', 800, 805, 'Camille Giroud',           'camille giroud')
) AS fix(offer_date, first_row, last_row, producer, match_tokens)
WHERE r.import_id = '6bfd17fb-9eaa-4b2d-bf51-31de8a0a006b'
  AND r.offer_date = fix.offer_date
  AND r.source_row_number BETWEEN fix.first_row AND fix.last_row
  AND r.source_match_key NOT LIKE '%' || fix.match_tokens;
