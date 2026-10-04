# Tranche 1: publication reliability

Status: released 4 October 2026 through [PR #15](https://github.com/rjc54n/bbx/pull/15). Migration `20261003201743` and the owner's exact one-off backfill are live. The signed-in banner and publication-age check passed. Five real sweeps at the operating cadence remain the sustained-health gate.

## Agreed behaviour

The owner approved the latest successful publication plus any later failed attempt in the catalogue banner, with an alert when publication age exceeds 60 hours. The owner also approved keeping state on `scan_runs`, a session lock shared by sweeps and publication recovery, and fifteen rotation buckets advancing after source commit. Listed wines and the existing 30-day overdue safeguard retain their pricing policy.

Manual jobs may bypass the two-day cadence. The owner approved requiring the full 90-minute job budget to fit before 02:00 UTC for manual and scheduled jobs. New starts are therefore refused after 00:30 UTC until 05:00 UTC. Recovery follows the same start rule. Inspection and health queries are deferred during 02:00-05:00 UTC.

The successful scheduled sweep on 3 October supplies the pre-release baseline. The owner removed the proposed manual validation sweep on 4 October. No manual sweep is authorised for this release. After the approved backfill, the 40-hour spacing expires at about 14:49 UTC on 5 October. The next normal sweep is expected in that night's UK operating window (21:00-00:00 UTC during BST), subject to scheduler delay and the existing timing safeguards. Five real sweeps remain the sustained-health evidence gate.

---

## Implementation

Migration `20261003201743_sweep_publication_state` adds `source_committed_at`, `source_status`, `published_at`, `publication_stages` and `rotation_bucket` to `private.scan_runs`. `public.scan_health_view` exposes the publication evidence and retains invoker security and existing grants. There is no new operational table.

`commit_sweep()` commits source data and source quality without declaring publication complete. PostgreSQL's transaction-local tuple counters record actual inserts, updates and deletes for the source tables. These are separate from submitted-row counts. Successful source commits advance rotation, even when subsequent publication fails; failed source attempts do not consume a bucket. Fifteen commits cover the rotation at the normal two-day cadence. Missed runs still use the overdue safeguard.

Publication runs catalogue, summary, scenario and the three facet refreshes, then REST timestamp publication. Each stage records its outcome, duration and row count. An empty cache or failed stage fails the attempt. `published_at` and terminal source quality are recorded only after all stages succeed. The caches still commit individually; this change does not make publication atomic across all readers.

Publication recovery uses the same source run and skips stages recorded as successful. It checks the latest source generation under the shared session lock. It does not refetch Algolia or REST data. No publication stage is retried automatically. A recorded running/unknown stage is refused because its completion cannot be inferred after a lost reply. Inspect server activity and establish the stage outcome before any operator-directed retry; absence of an active query alone does not prove that the refresh failed.

Thirty-day event retention commits batches of at most 1,000 rows, with limits of 10,000 rows and 20 seconds per invocation. Each statement has a timeout of at most five seconds and no more than the remaining budget. Commit latency can exceed the remaining wall-time budget. Batches walk forwards through the existing primary key. No unmeasured date index was added. Backlog counts are bounded: a large count is a lower bound; a timed-out or exhausted query is reported as unknown, not zero. Batch commits survive a later cleanup failure. Retention failure remains non-fatal and sends the existing explicit alert.

Job output and a 30-day GitHub artifact retain source changes, stage timings, coverage, relation sizes, WAL and temporary-byte deltas, compact query statistics without query text, and the statistics-reset time. WAL counters are cluster-wide; temporary bytes are database-wide and include concurrent work. Counter resets invalidate the affected delta. Fatal source/publication failures also reach the evidence/reset path when the connection is usable. An uncertain connection is left for inspection.

Window-only jobs now check publication age. A skipped trigger is not publication evidence. Historical terminal statuses alone do not establish publication. The migration left all historical publication fields unset. The separately approved one-off SQL below recorded only run `7b864bb1-e593-428d-ab8b-8585c695f95b`, whose log proves each required stage succeeded. Every other historical run remains unbackfilled.

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

The existing `BBX Daily Sweep` workflow dispatch remains available for separately authorised operations. Do not dispatch it during this release. If a later scheduled sweep fails after source commit, inspect the run and prefer publication recovery when eligible.

---

## Evidence and deployment checkpoint

At preparation, all 78 existing local migrations matched the production ledger, including `20261003140728`. Supabase reported no data branches. These are read-only observations from 3 October, around 20:17 UTC. Recheck the migration ledger and instance health at cutover.

The [scheduled GitHub run `37159711065`](https://github.com/rjc54n/bbx/actions/runs/37159711065), started at 22:49 UTC on 3 October, completed successfully on `main` commit `9a281187c83533a9c1b6bde4c4ad702373c85819`. Its log was checked on 4 October. Source run `7b864bb1-e593-428d-ab8b-8585c695f95b` committed as `completed` and published all required stages. This supersedes the earlier observation that the latest attempt was the failed 2 October run.

| Baseline observation | Evidence |
| --- | --- |
| Discovery | 51,976 of 51,976 records collected; complete |
| REST | 16,348 checked successfully; 0 failures |
| Source commit | 23:07:16.348 UTC |
| `catalogue_mv` | About 14 s; 69,908 rows |
| `wine_market_summary_mv` | About 6 s; 51,074 rows |
| `wine_scenario_mv` | About 4 s; 69,908 rows |
| REST timestamp publication | 16,348 timestamps published at 23:07:41.294 UTC |
| Facets | About 9 s for all three; completion at 23:07:50.051 UTC |
| Retention | 13,399 events deleted; the owner's review reports under 1 s |
| Disappearance checks | About 105 s, between 23:05:29.664 and 23:07:14.862 UTC |

Disappearance checks were the slowest logged database stage. Record them as a Tranche 2/3 measurement and optimisation candidate, with any query comparison performed off production. The recorded row counts are cache sizes or input/coverage counts, not measurements of actual changed tuples. The old log does not supply the new WAL/temporary-byte deltas or establish sustained backup-window health.

No production data was copied. An initial schema-only copy of the existing local Supabase database passed the new tests but exposed an owner-price failure in the broader suite. A separate database, `bbx_tranche1_replay`, was then built from the managed platform schemas and all 79 repository migrations. The complete pgTAP suite passed there: 528 assertions across 21 files. The owner-price failure was local schema drift, not reproduced by the clean replay. The original local database was left untouched. Five real PostgreSQL integration tests passed for actual tuple changes, known-stage recovery, session-lock exclusion, empty-cache rejection, bounded retention and metrics. The full Python suite passed with PostgreSQL integration enabled (369 tests). Web tests passed (377), as did lint and the production build.

Local schema lint found no errors. It retained the existing unused-parameter warning in `public.accept_bbr_import`. The web production build and lint passed. Component rendering tests cover the banner; an authenticated browser journey against the deployed change remains open.

The baseline above establishes successful publication and approximate stage costs on the previous code. Actual changed-row counters, WAL/temporary I/O evidence and peak I/O remain to be captured by the new protocol and normal health observations. The local throwaway test databases have been removed. No manual sweep was dispatched and sustained recovery is not claimed.

The focused regression `test_log_backfill_satisfies_publication_age_and_preserves_start_based_spacing` stores a legacy completed run, then supplies its log-backed publication evidence. It checks the publication-age helper used by `check_publication.py` and the cadence guard using `load_recent_runs()`: the following night is skipped, spacing expires exactly 40 hours after the original start, the next scheduled window is eligible, and the age check passes through 60 hours after publication but fails beyond that boundary.

## Approved one-off backfill

This operational correction applied to one independently verified production run, so it remains here rather than in a migration applied to every environment. The owner explicitly approved this exact statement. It was run after migration `20261003201743` and the authenticated `scan_health_view` smoke test, and before the code merge.

```sql
UPDATE private.scan_runs
SET source_committed_at = TIMESTAMPTZ '2026-10-03 23:07:16.348+00',
    source_status = 'completed',
    published_at = TIMESTAMPTZ '2026-10-03 23:07:50.051+00',
    publication_stages = '{
      "backfill": {
        "method": "backfilled_from_log",
        "github_run_id": 37159711065,
        "evidence_url": "https://github.com/rjc54n/bbx/actions/runs/37159711065"
      },
      "catalogue_mv": {"status": "completed", "rows": 69908},
      "wine_market_summary_mv": {"status": "completed", "rows": 51074},
      "wine_scenario_mv": {"status": "completed", "rows": 69908},
      "rest_checks": {"status": "completed", "rows": 16348},
      "facet_values_mv": {"status": "completed"},
      "facet_ranges_mv": {"status": "completed"},
      "format_options_mv": {"status": "completed"}
    }'::jsonb
WHERE id = '7b864bb1-e593-428d-ab8b-8585c695f95b'::uuid
  AND scope = 'biddable_full_book'
  AND status = 'completed'
  AND source_committed_at IS NULL
  AND source_status IS NULL
  AND published_at IS NULL
  AND publication_stages = '{}'::jsonb
RETURNING id, started_at, source_committed_at, source_status,
          published_at, publication_stages;
```

The statement returned exactly one row. It preserved `started_at`, `finished_at`, `status` and `rotation_bucket`. Facet row counts and individual durations were not logged and are deliberately omitted. The evidence marker applies to all listed stage outcomes. A zero-row result would have required inspection, not weaker guards or a blind retry. After an ambiguous failure, inspect server activity and the target row before deciding whether any further action is needed.

This backfill gives the banner a verified publication and prevents repeated missing-publication alerts. Publication age uses 23:07:50.051 UTC; the 40-hour guard still uses the original sweep start near 22:49 UTC. Without another publication, the age check first becomes stale after 11:07:50.051 UTC on 6 October.

## Release record and next checks

The owner approved the exact SQL and revised sequence on 4 October. The final branch revision passed Python, web, Vercel preview and database migration validation. During cutover outside 02:00-05:00 UTC, the sweep workflow was disabled. GitHub reported no queued or active sweep. PostgreSQL reported no active client query; four historical `running` records date from July and August. A trivial query executed in 0.083 ms. The last-hour dashboard showed 12.13% CPU and 2 disk IOPS. The latest inspected checkpoint sync was 0.003 s, with no error log returned for the checked period. These observations supported cutover but do not certify sustained capacity.

The migration dry-run listed only `20261003201743_sweep_publication_state`. `supabase db push --linked` applied it and `supabase migration list --linked` confirmed its remote entry. The CLI reported a local migration-catalogue cache warning after applying it; the ledger was checked separately and no push was repeated. `public.scan_health_view` exposed the new null fields to `authenticated` before backfill. The approved SQL returned exactly one row, and the authenticated view showed the expected publication and stage evidence afterwards.

PR #15 merged as `28c2ab7580e39c12beaa3ea22d5851905492913a` at 08:45:56 UTC. GitHub reported a successful Vercel Production deployment for that revision at 08:46:44 UTC. The `BBX Daily Sweep` workflow content on `main` matched the merged revision and was restored to active. `check_publication.py` returned `Latest catalogue publication is within 60 hours`. The workspace had no session-pooler `DATABASE_URL`, so the operator check used the Supabase CLI's temporary direct connection, selected its existing `postgres` role and set the session read-only. Two earlier attempts using the temporary login role failed with a definitive privilege error before the publication query; no permission was changed. In a signed-in production browser, the banner showed `Last published: 04 Oct 2026` (UK date), 99% pricing coverage and complete discovery, with no stale warning or later failure. The catalogue returned 69,908 results.

The next normal sweep becomes eligible after about 14:49 UTC on 5 October and is expected in that night's operating window, subject to scheduler timing. Do not dispatch a manual sweep for this release. Save the first new sweep's logs and evidence artifact; check source commit, all required stages, coverage, actual changed rows and retention backlog. Inspect any failure before considering recovery. Check catalogue, scenarios and wine readers while signed in.

After 05:00 UTC, inspect ordinary workload and backup-window logs/metrics retrospectively. Record query responsiveness, checkpoint sync behaviour and dashboard disk I/O. Do not run diagnostic work in the protected window or treat job success/database size as recovery proof. Collect five real sweeps at the operating cadence for sustained health. Tranche 2 local preparation can proceed; its production checkpoint remains separate.

The original uncommitted priority plan, project review and their index entries were preserved. They are not part of this implementation commit.
