# Tranche 2 release record

Status: released 6 October 2026. Migrations `20261004142409`, `20261004142420` and `20261004142431` are live, and the app merged to `main` as `5bb9ea8` with a successful Vercel Production deployment at 12:08 UTC. No PR was opened, at the owner's direction. The first sweep with the price-sort index ran on 7 October; `catalogue_mv` refreshed in 18.9 s against 11.9 s, but the slowdown was not specific to that stage (see [First sweep with the index](#first-sweep-with-the-index-7-october-2026)) and the cause is unresolved.

## Release gate

The [local handover](TRANCHE-2-LOCAL-HANDOVER-2026-10-04.md) required the first new-code Tranche 1 sweep and the following backup window to be healthy before any production work, checked after 05:00 UTC on 6 October.

[Scheduled run 37383304033](https://github.com/rjc54n/bbx/actions/runs/37383304033) started at 22:34 UTC on 5 October and completed in 17m45s. It committed as `completed`, published every stage at 22:51:42 UTC, and covered 51,991 of 51,991 Algolia records with 16,343 REST checks and no failures. Source commit took 113.6 s. `catalogue_mv` took 11.9 s, the summary 5.5 s, the scenario cache 4.3 s and the facets about 9.6 s. Retention deleted 5,977 events in six batches with none remaining. Actual changes were 4,013 observation events, 2,301 SKU updates, 996 offer updates, 16,320 rest-check updates and 33 product updates. The WAL delta was 47.8 MB and the database-wide temporary-byte delta 136 MB.

The backup checkpoint at about 02:44 UTC took 0.885 s with a 0.004 s sync, and the post-sweep checkpoint synced in 0.009 s. The logs showed no errors apart from one client connection reset at 02:44:10. The 02:54 UTC run was correctly skipped and its publication check deferred; the 06:08 UTC run reported publication within 60 hours. At 10:40 UTC no other query was active and a trivial query returned in about 27 ms. The dashboard disk-I/O metric was not inspected, and this is the second of the five sweeps required for sustained health, not the fifth.

---

## Deployment sequence

Each migration was committed to `main` as a single-file change, dry-run, pushed with `supabase db push --linked`, and confirmed from the server before the next. The CLI printed its usual trailing error after each push, an SSL stack trace for the first and a missing-certificate message for the second; outcomes were confirmed from the ledger and catalogue state, and nothing was retried. The ledger matched after every push.

| Step | Migration | Result |
| --- | --- | --- |
| R9 | `20261004142409` | The duplicate index is gone; the unique constraint and its index remain. A rank-ordered read used the unique index and took 5 ms. |
| R5 | `20261004142420` | The view keeps `security_invoker` and its `anon`, `authenticated` and `service_role` grants. |
| Index | `20261004142431` | `idx_catalogue_mv_market_price_order` is valid at 3,497,984 bytes, the same as locally. The unfiltered price-sort read of 26 rows used it: 3.7 ms and 29 buffers, against 1.6 s (203 ms on a repeat) in the 4 October probe. |

R5 was checked on production with the row count and an ordered MD5 over the view's columns, taken before and after. Both were 32,843 rows and `0825cdd9dcad191c939c2197c49efdc3`. A first page read after the push took 3.2 s and then 7.5 s, with an identical plan and buffer counts, while the instance was otherwise idle. A same-session comparison of the old definition inline against the new view, alternating, gave:

| Run | View | Time |
| --- | --- | --- |
| 1 | old | 3,883 ms |
| 2 | new | 251 ms |
| 3 | old | 350 ms |
| 4 | new | 231 ms |

The first run absorbed a cold start, so warm figures are the comparison: about 230-250 ms new against about 350 ms old. Production timings on this instance varied several-fold with unchanged plans, so this supports "not slower and somewhat faster", not a precise speedup. The production plan joins with a merge join over the full `catalogue_mv` index scan, unlike the faster plan on the local copy. The comparison used two runs of each definition, with the old one inline rather than the original view object.

The app was then merged to `main` locally, `npm run lint`, 382 Vitest tests and the production build passed on the merged tree, and the merge was pushed. The Python suite and pgTAP were not rerun for the merge, since it added only app and documentation files to a tree whose migrations were already on `main`.

---

## First sweep with the index (7 October 2026)

Status: recorded 8 October 2026, read-only review from GitHub logs, the Postgres log stream and three SQL reads (08 October 09:34 UTC, outside the 02:00-05:00 window).

[Scheduled run 37687987907](https://github.com/rjc54n/bbx/actions/runs/37687987907) started at 21:14 UTC on 7 October, took 19m24s and succeeded. REST checks covered 16,354 of 16,354 with no failures, publication was within 60 hours, and retention deleted 6,083 events in seven batches with none remaining. The 01:51 and 05:51 UTC runs were 14-20 s skips under the 40-hour guard. This is the third of the five sweeps required for sustained health.

Stage timings against the 5 October baseline (run 37383304033):

| Stage | 5 Oct | 7 Oct | Change |
| --- | --- | --- | --- |
| `catalogue_mv` | 11.9 s | 18.9 s | +58% |
| `wine_market_summary_mv` | 5.5 s | 18.2 s | +229% |
| `wine_scenario_mv` | 4.3 s | 7.0 s | +61% |
| `facet_values_mv` | 8.1 s | 8.8 s | +8% |
| Facet ranges, format options, rest checks | 0.7-1.2 s | 0.7-0.8 s | flat |
| Source commit | 113.6 s | 136.6 s | +20% |
| Retention | 6.6 s | 7.0 s | +7% |

Row counts grew by about 0.04% (69,955 to 69,982 in `catalogue_mv`), so data growth does not explain the difference. `wine_market_summary_mv` was not touched by Tranche 2 and slowed most, which points to instance-wide variance rather than the new index, consistent with the 3-7x production timing variation already noted. It does not clear the index either: `catalogue_mv` did get slower, against about 80 ms predicted locally. **The cause is unresolved.**

Instance state at 09:34 UTC: database 356 MB (359 MB on 3 October), 15 connections, nothing active, no restart since 2 October. Backup-window checkpoints at 02:43 and 02:48 UTC took 0.04 s and 0.12 s with 0.002 s sync; daytime checkpoints wrote 12-27 buffers in 1-3 s. The two sweep-time checkpoints (21:37 and 22:27 UTC) each took about 270 s writing 24-35% of buffers, which is the sweep's write load. No ERROR, FATAL or PANIC in 24 hours. Dashboard CPU and disk-I/O were not inspected. All local migrations are applied remotely.

Decision rule for the next sweep (expected the night of 9 October): if `catalogue_mv` stays near 19 s while `wine_market_summary_mv` returns to about 5 s, suspect the index and compare refresh cost with and without it on a Supabase data branch (availability not yet checked). If both fall back, treat the 7 October figures as variance.

---

## Open items

- **Signed-in check.** The catalogue (next/previous and price sort), price-change list and `/matches` have not been exercised in a signed-in production session. The R12 "Try again" path appears only when the reference lookup fails and is not expected to be reachable by hand.
- **Index refresh cost.** Unresolved: 18.9 s on 7 October against 11.9 s, with an unrelated stage also slower. The next sweep (night of 9 October, 21:00-00:00 UTC, once the 40-hour spacing from the 7 October 21:14 start expires) decides it; see the rule above.
- **Sustained health.** Two more real sweeps are needed after 7 October. Disk-I/O dashboard values and a later backup window have not been recorded for this release.
- **Cleanup.** Issue #14, legacy-reference cleanup, is no longer blocked by this tranche.
