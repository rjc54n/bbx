-- Phase 4 (external review, 2026-07-24): persist listing presence
-- separately from REST pricing.
--
-- Under wave pricing, a wine that loses its last live listing is not
-- necessarily REST-repriced the same day (it may not be selected by
-- rotation/delta for up to ROTATION_BUCKETS days). Before this, "is this
-- SKU listed" had no stored fact of its own -- it would have had to be
-- inferred from least_listing_price_p being non-null, which goes stale
-- exactly in that window: the old ask sits there looking like a live
-- listing long after the listing itself disappeared.
--
-- is_listed is derived from Algolia discovery, which runs in full every
-- sweep regardless of REST wave-pricing tiering (see
-- core.sweep._reconcile_listing_state), so it is always current. When a
-- SKU's listing disappears, core.sweep clears least_listing_price_p to NULL
-- immediately too, even on a run that didn't REST-reprice it -- is_listed
-- and a possibly-stale ask are not meant to coexist as two ways of saying
-- the same thing; the ask itself must not go stale either.
--
-- The backfill below seeds existing rows with the best available guess
-- (the same "ask implies listed" heuristic this migration replaces) so
-- there's a sensible value immediately; core.sweep self-heals any
-- mismatch (e.g. genuinely stale rows -- exactly what this fixes) on the
-- very next sweep run regardless.

ALTER TABLE skus
    ADD COLUMN IF NOT EXISTS is_listed BOOLEAN NOT NULL DEFAULT false;

UPDATE skus
SET is_listed = (least_listing_price_p IS NOT NULL AND least_listing_price_p > 0)
WHERE gone_since IS NULL;
