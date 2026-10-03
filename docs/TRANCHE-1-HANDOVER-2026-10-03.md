# Tranche 1: publication reliability

Status: implementation prepared 3 October 2026 on `codex/tranche-1-publication`. Production deployment and workload validation remain open. No production data, schema or schedule was changed during preparation.

## Agreed behaviour

The owner approved the latest successful publication plus any later failed attempt in the catalogue banner, with an alert when publication age exceeds 60 hours. The owner also approved keeping state on `scan_runs`, a session lock shared by sweeps and publication recovery, and fifteen rotation buckets advancing after source commit. Listed wines and the existing 30-day overdue safeguard retain their pricing policy.

Manual jobs may bypass the two-day cadence. The owner approved requiring the full 90-minute job budget to fit before 02:00 UTC for manual and scheduled jobs. New starts are therefore refused after 00:30 UTC until 05:00 UTC. Recovery follows the same start rule. Inspection and health queries are deferred during 02:00-05:00 UTC.

The owner asked that validation not depend on unpredictable scheduled dispatch. A controlled manual job is the proposed production validation route after review and deployment. Five real sweeps remain the sustained-health evidence gate; repeated manual runs in a short period would not establish normal operating cost.

---

## Implementation

Migration `20261003201743_sweep_publication_state` adds `source_committed_at`, `source_status`, `published_at`, `publication_stages` and `rotation_bucket` to `private.scan_runs`. `public.scan_health_view` exposes the publication evidence and retains invoker security and existing grants. There is no new operational table.

`commit_sweep()` commits source data and source quality without declaring publication complete. PostgreSQL's transaction-local tuple counters record actual inserts, updates and deletes for the source tables. These are separate from submitted-row counts. Successful source commits advance rotation, even when subsequent publication fails; failed source attempts do not consume a bucket. Fifteen commits cover the rotation at the normal two-day cadence. Missed runs still use the overdue safeguard.

Publication runs catalogue, summary, scenario and the three facet refreshes, then REST timestamp publication. Each stage records its outcome, duration and row count. An empty cache or failed stage fails the attempt. `published_at` and terminal source quality are recorded only after all stages succeed. The caches still commit individually; this change does not make publication atomic across all readers.

Publication recovery uses the same source run and skips stages recorded as successful. It checks the latest source generation under the shared session lock. It does not refetch Algolia or REST data. No publication stage is retried automatically. A recorded running/unknown stage is refused because its completion cannot be inferred after a lost reply. Inspect server activity and establish the stage outcome before any operator-directed retry; absence of an active query alone does not prove that the refresh failed.

Thirty-day event retention commits batches of at most 1,000 rows, with limits of 10,000 rows and 20 seconds per invocation. Each statement has a timeout of at most five seconds and no more than the remaining budget. Commit latency can exceed the remaining wall-time budget. Batches walk forwards through the existing primary key. No unmeasured date index was added. Backlog counts are bounded: a large count is a lower bound; a timed-out or exhausted query is reported as unknown, not zero. Batch commits survive a later cleanup failure. Retention failure remains non-fatal and sends the existing explicit alert.

Job output and a 30-day GitHub artifact retain source changes, stage timings, coverage, relation sizes, WAL and temporary-byte deltas, compact query statistics without query text, and the statistics-reset time. WAL counters are cluster-wide; temporary bytes are database-wide and include concurrent work. Counter resets invalidate the affected delta. Fatal source/publication failures also reach the evidence/reset path when the connection is usable. An uncertain connection is left for inspection.

Window-only jobs now check publication age. A skipped trigger is not publication evidence. Historical terminal statuses are not backfilled into `published_at`, because they did not prove that every required stage succeeded. The banner can show no verified publication until the first run using this protocol completes.

## Operator commands

Use the existing session-pooler `DATABASE_URL`. Do not put credentials into command logs.

```bash
# Read the run and active publication work before deciding on recovery.
python apps/daily_sweep/recover_publication.py RUN_ID

# Resume known failed or unstarted stages for the unchanged source generation.
python apps/daily_sweep/recover_publication.py RUN_ID --resume

# Read-only freshness check, also used by window-only jobs.
python apps/daily_sweep/check_publication.py
```

A manual full sweep remains the existing `BBX Daily Sweep` workflow dispatch. Use it once for a due, approved validation run after deployment. If it fails after source commit, inspect the run and prefer publication recovery when eligible.

---

## Evidence and deployment checkpoint

At preparation, all 78 existing local migrations matched the production ledger, including `20261003140728`. Supabase reported no data branches. The latest recorded source attempt was still the failed 2 October run. These are read-only observations from 3 October, around 20:17 UTC; they are not a current capacity certification.

No production data was copied. An initial schema-only copy of the existing local Supabase database passed the new tests but exposed an owner-price failure in the broader suite. A separate database, `bbx_tranche1_replay`, was then built from the managed platform schemas and all 79 repository migrations. The complete pgTAP suite passed there: 528 assertions across 21 files. The owner-price failure was local schema drift, not reproduced by the clean replay. The original local database was left untouched. Five real PostgreSQL integration tests passed for actual tuple changes, known-stage recovery, session-lock exclusion, empty-cache rejection, bounded retention and metrics. The full Python suite passed with PostgreSQL integration enabled (369 tests). Web tests passed (377), as did lint and the production build.

Local schema lint found no errors. It retained the existing unused-parameter warning in `public.accept_bbr_import`. The web production build and lint passed. Component rendering tests cover the banner; an authenticated browser journey against the deployed change remains open.

No production baseline of actual changed rows, refresh-stage costs or peak I/O has yet been captured. No migration was applied to production, no manual sweep was dispatched and recovery is not claimed.

## Release sequence

1. Finish PR review and clean migration replay in CI. Account for any intervening commits or pending migrations.
2. Ensure no sweep or manual publisher can start during cutover. Check GitHub runs and server activity. Older sweep code does not take the new lock.
3. Outside 02:00-05:00 UTC, check instance health, apply this one additive migration and confirm its remote ledger entry. Smoke-test `scan_health_view` before merging database-dependent app code.
4. Merge the reviewed code and confirm the web deployment and workflow revision. Restore the agreed scheduling state after cutover.
5. Capture a bounded health/counter snapshot. Dispatch one manual full sweep with enough backup headroom, without overlapping another source writer. Save its logs and evidence artifact. Inspect any failure before deciding to retry.
6. Check source commit, all required stage results, publication coverage, actual changed rows and retention backlog. Verify the catalogue, scenarios and wine readers while signed in.
7. After 05:00 UTC, inspect the ordinary workload and backup-window logs/metrics retrospectively. Record query responsiveness, checkpoint sync behaviour and dashboard disk I/O. Do not run diagnostic work in the protected window or treat job success/database size as recovery proof.
8. Collect five real sweeps at the operating cadence for sustained health. Record any manual dispatch separately. Tranche 2 local preparation can proceed; its production checkpoint remains separate.

The original uncommitted priority plan, project review and their index entries were preserved. They are not part of this implementation commit.
