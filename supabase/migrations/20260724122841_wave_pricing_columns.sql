-- Phase 4 Step 6: wave-pricing auditability columns on scan_runs.
--
-- Populated by run_daily_sweep on every run since 2026-07-24 (Option A:
-- discovery swapped to fetch_biddable_universe, REST pricing tiered) -- see
-- core/sweep.py and core/store.py.update_run_wave_pricing.
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
