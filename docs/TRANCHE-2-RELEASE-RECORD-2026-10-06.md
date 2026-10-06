# Tranche 2 release record

Status: released 6 October 2026. Migrations `20261004142409`, `20261004142420` and `20261004142431` are live, and the app merged to `main` as `5bb9ea8` with a successful Vercel Production deployment at 12:08 UTC. No PR was opened, at the owner's direction. The first production measurement of the price-sort index's refresh cost is still to come from the next sweep.

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

## Open items

- **Signed-in check.** The catalogue (next/previous and price sort), price-change list and `/matches` have not been exercised in a signed-in production session. The R12 "Try again" path appears only when the reference lookup fails and is not expected to be reachable by hand.
- **Index refresh cost.** The next normal sweep, expected in the night window of 7 October (21:00-00:00 UTC; the 40-hour spacing from the 5 October start expires at about 14:34 UTC that day), gives the first production `catalogue_mv` refresh time with the index. Compare it with 11.9 s; the local single pair added about 80 ms. There is no sweep on the night of 6 October.
- **Sustained health.** Three more real sweeps are needed after that. Disk-I/O dashboard values and a later backup window have not been recorded for this release.
- **Cleanup.** Issue #14, legacy-reference cleanup, is no longer blocked by this tranche.
