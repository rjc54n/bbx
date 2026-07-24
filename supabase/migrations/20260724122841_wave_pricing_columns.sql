-- Phase 4 Step 6: wave-pricing auditability columns on scan_runs.
--
-- Not yet populated by a live sweep -- core.sweep.select_biddable_rest_pricing
-- and core.store.update_run_wave_pricing exist and are tested, but
-- run_daily_sweep does not call them yet (see core/sweep.py's Step 6
-- comment block). Landing the columns now means wiring them in later is a
-- small addition, not a schema change bundled with a bigger behavioural one.
--
-- wave_delta_enabled: whether index_last_update-driven delta selection
--   affected pricing this run, or only rotation did (see the "flag" in
--   docs/PHASE3-4-IMPLEMENTATION.md Step 6).
-- wave_rotation_count: parent_skus selected by the day's rotation slice.
-- wave_delta_changed_count: parent_skus index_last_update flagged as
--   changed since the last run (computed regardless of wave_delta_enabled).
-- wave_shadow_only_count: of those, how many were OUTSIDE the rotation
--   slice -- delta's marginal contribution, the number this step's
--   verification period is meant to build confidence in.
-- wave_priced_count: total parent_skus actually REST-priced this run via
--   the wave-pricing path (rotation_count if delta disabled, rotation ∪
--   delta if enabled).

ALTER TABLE scan_runs
    ADD COLUMN IF NOT EXISTS wave_delta_enabled       BOOLEAN,
    ADD COLUMN IF NOT EXISTS wave_rotation_count       INT,
    ADD COLUMN IF NOT EXISTS wave_delta_changed_count  INT,
    ADD COLUMN IF NOT EXISTS wave_shadow_only_count    INT,
    ADD COLUMN IF NOT EXISTS wave_priced_count         INT;
