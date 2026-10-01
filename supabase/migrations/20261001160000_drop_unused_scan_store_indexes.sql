-- Storage retention plan, step 3 (docs/STORAGE-RETENTION-PLAN-2026-10-01.md).
--
-- The database is at the free-plan 500 MB limit. These indexes show zero
-- scans since the 28 August 2026 restart (idx_products_name_trgm: 3, none
-- traceable to code) and predate catalogue_mv taking over catalogue reads.
-- Each can be recreated from its original migration
-- (20260718210527_scan_store.sql, 20260719081754_read_layer.sql).
--
-- Deliberately no bulk delete here: DROP INDEX holds ACCESS EXCLUSIVE on the
-- table until commit, so this transaction is kept short. Old events are
-- deleted separately in bounded batches (plan step 4).

DROP INDEX IF EXISTS private.idx_obs_entity;
DROP INDEX IF EXISTS private.idx_products_name_trgm;
DROP INDEX IF EXISTS private.idx_products_producer_trgm;
DROP INDEX IF EXISTS private.idx_products_region;
DROP INDEX IF EXISTS private.idx_products_vintage;
DROP INDEX IF EXISTS private.idx_products_colour;

-- The 28 September 2026 sweep failed mid-commit and its mark_run_failed call
-- also hit the statement timeout, leaving the run 'running'.
UPDATE private.scan_runs
SET status = 'failed',
    error_message = 'statement timeout during commit; mark_run_failed also timed out (backfilled 2026-10-01)'
WHERE id = '3526e5d0-91a5-4fd5-8106-ab5d6a92580f'
  AND status = 'running';
