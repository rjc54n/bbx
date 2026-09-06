# `/matches` review-view performance: design

**Written:** 6 September 2026.
**Status:** shipped. Merged in PR #11 (`80af35a`) and pushed to prod
(`ytgzgybgwsucsqeyetmk`) on 6 Sep 2026. `20260906150000` is a follow-up that
`ANALYZE`s the backfilled table (see §4).

**Measured on prod, before → after:**

| Query | Before | After |
| --- | --- | --- |
| `wine_match_review_view` page query (`ORDER BY … LIMIT 50`) | ~3,950 ms | **81 ms** |
| `wine_match_queue_summary(NULL)` | ~3,950 ms | **58 ms** |
| whole `/matches` DB work per load | ~8,000 ms | **~150 ms** |

Reconciliation: the backfilled table matches a fresh computation from the base
tables exactly — 0 mismatches on `suggestion_count` / `review_band` /
`last_run_status` across all 2,586 release-offer groups. Security advisors: no
new findings.
**Trigger:** the production freeze on 6 September 2026, ~14:06–14:14 UTC. 55×
`57014` statement-timeout errors on the matching review path, then a PostgREST
`Thread killed by timeout manager` and an automatic restart. Recovered on its
own. Root cause below.

**Related:** memory `project_matches-page-freeze-2026-09-06`,
`project_prod-instance-no-headroom`, `project_scenario-perf-and-query-engine`
(the `wine_scenario_mv` split-the-slow-half pattern this mirrors);
`docs/MATCHING-QUEUE-TRIAGE-SPEC.md` §8 (which parked this exact fix:
"precompute … into a materialised view refreshed by the match run, as
`catalogue_mv` already does").

---

## 1. What is slow

Each `/matches` load issues, in one `Promise.all`:

| # | Call | Cost (prod, 6 Sep) |
| --- | --- | --- |
| 1 | `GET wine_match_review_view` — `select("*", { count: "exact" })`, `range(0, 49)` | full stack scan ≈ **3.95 s** |
| 2 | `POST rpc/wine_match_queue_summary` → `SELECT count(*) FILTER (…) FROM wine_match_review_view` | **another** full stack scan ≈ **3.95 s** |
| 3 | `GET release_offer_match_review_view` `.in("match_group_key", [≤50 keys])` (offer dates) | partial re-scan of the release half |

`authenticated` has `statement_timeout = 8 s`; the PostgREST pool max is 10
connections. ~8 s of DB work per page load, times concurrent reviewers and
refreshes, exhausts the pool → every subsequent query times out → the freeze.

The page is **paginated** (`PAGE_SIZE = 50`). The 14 summary counts
(`needs_review`, `with_suggestions`, the `review_band` buckets, …) describe the
whole filtered backlog, so they genuinely need a server-side aggregate — they
cannot be derived from the 50 rows the page fetched. So the fix for the double
scan is "make both scans cheap", not "move the counts to the client".

## 2. Why the view is slow

`wine_match_review_view` unions `release_offer_match_review_view` and
`cellartracker_match_review_view`. The release half is ≈ 3.4 s of the 3.95 s.
Each half is four CTEs (definitions in
`20260903210000_revert_coverage_to_stored_metric.sql`):

| CTE | Work | Changes when… |
| --- | --- | --- |
| `grouped` | Seq Scan `release_offer_source_rows` (3.6k rows, ~568 ms) + join `imports` + LEFT JOIN `resolutions` + `NOT EXISTS` exclusions, `GROUP BY match_group_key` | **a reviewer links / suppresses / excludes** — must stay live |
| `suggestion_stats` | full `GROUP BY match_group_key` over `release_offer_match_suggestions` (7.7k rows, ~796 ms HashAggregate) | a match run writes suggestions |
| `top_candidate` | join `grouped` → suggestions `WHERE rank = 1`; the `is_biddable` `EXISTS(catalogue_view …)` fires the correlated `catalogue_mv` subplan once per group (2,747 + 603 loops) | a match run; `catalogue_mv` refresh |
| `last_run` | `DISTINCT ON (match_group_key)` over `release_offer_match_run_groups` (10.8k rows, ~192 ms) joined to `release_offer_match_runs`, sorted `(key, run.started_at DESC, run_group.processed_at DESC)` | a match run |

`wine_match_review_view` then adds its own `LEFT JOIN release_offer_match_suggestions … rank = 1`
for the v2 evidence columns, and unions the cellartracker half (same shape).
Planning time alone is ~90 ms.

**Only `grouped`'s resolution counts are review-live.** Everything else — the
suggestion aggregates, the rank-1 evidence, `token_coverage` / `coverage_tier`,
`second_wine_conflict`, `last_run_status` / `last_error_at` — is fixed between
match runs.

Both review views are consumed **only** by the `/matches` page (grep-verified,
`apps/web` + `core`). Narrow blast radius.

## 3. Approach — split the match-run-scoped half into a maintained table

Confirmed with the owner:

1. **View strategy:** split. A precomputed structure holds the match-run-scoped
   columns; the review views keep only the live `grouped` CTE and `LEFT JOIN`
   it.
2. **Not a materialised view.** PostgREST wraps every RPC in a transaction, so
   `REFRESH MATERIALIZED VIEW CONCURRENTLY` cannot be called from the match-run
   server actions, and there is no Python / `pg_cron` path for match runs (the
   way `core/store.py` refreshes `catalogue_mv` concurrently in autocommit). A
   non-concurrent `REFRESH` would take an `ACCESS EXCLUSIVE` lock for the ~2 s
   the underlying query costs — unacceptable on a no-headroom instance during an
   active review session.
3. **Maintained plain table**, `public.wine_match_group_evidence`, one row per
   `(source, match_group_key)`. One-time backfill in the migration; then
   statement-level triggers on `*_match_suggestions` and `*_match_run_groups`
   UPSERT the affected groups' rows (§3.3). Always fresh, zero locks, no changes
   to the RPC bodies or the app.
4. **Summary RPC:** keep `wine_match_queue_summary` as its own call, now
   scanning the lightened view once (two light scans instead of two heavy ones).
   No `page.tsx` / `reviewQuery.ts` change.

### 3.1 `public.wine_match_group_evidence`

```
source                     text     -- 'release_offer' | 'cellartracker'
match_group_key            text
suggestion_count           int      not null default 0
suggestions_observed_at    timestamptz
top_match_score            numeric
last_run_status            text     -- 'pending' | 'processed' | 'failed' | null
last_error_at              timestamptz
second_wine_conflict       boolean  not null default false
token_coverage             double precision
coverage_tier              text     not null default 'none'
algorithm_version          text
evidence_score             numeric
score_margin               numeric
review_band                text     -- raw; view coalesces to 'legacy'
review_priority            smallint -- raw; view coalesces to 90
impact_band                text
risk_flags                 text[]   not null default '{}'
match_reasons              text[]   not null default '{}'
top_candidate_parent_sku   text
top_candidate_was_biddable_at_observation boolean
updated_at                 timestamptz not null default now()
primary key (source, match_group_key)
```

Owner-only: `REVOKE ALL … FROM PUBLIC, anon`; `GRANT SELECT … TO authenticated`;
RLS `USING ((SELECT private.is_app_owner()))`, matching the sibling match tables.
The `/matches` page never selects it directly — it reads through the views — so
`database.types.ts` needs no change (regen after `supabase db push` anyway).

### 3.2 Rewritten review views

`release_offer_match_review_view` keeps `grouped` only (drops
`suggestion_stats`, `top_candidate`, `last_run`), then:

```sql
SELECT grouped.* (the live columns),
       EXISTS (SELECT 1 FROM public.catalogue_view c WHERE c.parent_sku = grouped.parent_sku) AS is_biddable,
       coalesce(e.suggestion_count, 0)   AS suggestion_count,
       e.suggestions_observed_at, e.top_match_score,
       e.last_run_status, e.last_error_at,
       coalesce(e.second_wine_conflict, FALSE) AS second_wine_conflict,
       e.token_coverage,
       coalesce(e.coverage_tier, 'none') AS coverage_tier
FROM grouped
LEFT JOIN public.wine_match_group_evidence e
  ON e.source = 'release_offer' AND e.match_group_key = grouped.match_group_key;
```

`cellartracker_match_review_view` — same, `e.source = 'cellartracker'`.

`wine_match_review_view` — unchanged structure, except the extra
`LEFT JOIN release_offer_match_suggestions … rank = 1` is replaced by a
`LEFT JOIN public.wine_match_group_evidence` on `(source, match_group_key)` for
the v2 evidence columns (`algorithm_version` … `top_candidate_was_biddable_at_observation`).
Column list, names, coalesces and `security_invoker` all identical, so
`wine_match_queue_summary` and the page are untouched.

### 3.3 Per-group maintenance — triggers, not RPC edits

`private.upsert_release_offer_match_group_evidence(p_match_group_key text)` and
the cellartracker twin — `LANGUAGE sql`, `SECURITY DEFINER`, `search_path = ''`.
Each recomputes one row from `*_match_suggestions` (rank-1 + aggregate), the
group's latest `*_match_run_groups`/`*_match_runs` row, and
`private.second_wine_conflict`. `source_match_key` is read from the run group,
falling back to the source rows for a suggestion-only group. UPSERT on the PK.

Wired by **statement-level triggers** rather than edits to the four RPC bodies —
more robust (any write path is covered) and it leaves those functions
untouched:

| Table | Events | Filter |
| --- | --- | --- |
| `*_match_suggestions` | `AFTER INSERT`, `AFTER UPDATE` (statement, `NEW TABLE`) | recompute every distinct `match_group_key` in the transition table |
| `*_match_run_groups` | `AFTER INSERT`, `AFTER UPDATE` (statement, `NEW TABLE`) | `WHERE status <> 'pending'` |

Every result/error RPC ends by flipping a run group `pending → processed`/`failed`
after writing that group's suggestions, so the run-group trigger covers the
whole match-run path; the suggestions trigger additionally catches a suggestion
written with no run group (direct fixtures; the CellarTracker
`2020|ct alpha`-shaped case). `begin_*_match_run` inserts thousands of `pending`
run-group rows in one statement — the `status <> 'pending'` filter drops them
all in one pass. (`AFTER UPDATE OF status` is not usable: Postgres rejects a
column list on a trigger with transition tables.)

`delete_*_match_group` is not touched — see the migration header. A stale
evidence row is harmless (the group leaves `grouped` when its source rows go).
`private.rebuild_wine_match_group_evidence()` (`TRUNCATE` + per-key UPSERT over
`run_groups ∪ suggestions` keys) is the migration backfill and any manual
resync, mirroring `private.rebuild_catalogue_caches()`.

Two supporting indexes: `release_offer_match_run_groups (match_group_key)` and
the cellartracker twin — the existing indexes lead with `run_id`, and both the
per-group recompute and the `last_run` lookup filter by `match_group_key` alone.

## 4. Result and the `ANALYZE` follow-up

The split lands the page query at **81 ms** and the summary at **58 ms** on prod
(§ status table) — after `ANALYZE`. Straight after the backfill, the planner
still had the fresh-table default (~8 rows) for `wine_match_group_evidence` and
chose a nested loop with a 3.8M-row join filter for the `wine_match_review_view`
v2-column join: 1.2 s. `ANALYZE public.wine_match_group_evidence` fixed it
(index/hash joins). `20260906150000_analyze_wine_match_group_evidence.sql` runs
that `ANALYZE` and folds it into `private.rebuild_wine_match_group_evidence()`,
so every replay / branch / reset is deterministic.

The live `grouped` half (the resolution counts over `release_offer_source_rows`)
is ~35 ms of the 81 ms — a seq scan of 3.6k rows. Fine for now; if it ever
matters, index `release_offer_source_rows (match_group_key)` covering the
resolution join.

Write path: one extra single-row UPSERT per group per match-run statement.
Negligible.

## 5. Verification done (prod, `ytgzgybgwsucsqeyetmk`)

- `EXPLAIN (ANALYZE, BUFFERS)` on the page query and `wine_match_queue_summary`
  — numbers in the status table.
- Reconciliation query: `wine_match_group_evidence` vs. a fresh base-table
  computation — 0 mismatches across 2,586 release-offer groups.
- `migration list --linked`: `20260906140000` + `20260906150000` applied.
- Security advisors: no findings referencing the new objects.

## 6. Deliverables

- `supabase/migrations/20260906140000_wine_match_group_evidence.sql` +
  `supabase/migrations/20260906150000_analyze_wine_match_group_evidence.sql`
- `supabase/tests/database/wine_match_group_evidence.test.sql` (17 assertions):
  a result RPC fills the row; an error RPC sets `last_run_status = 'failed'` +
  `last_error_at`; the review views read counts/status from the table while the
  resolution count stays live; `wine_match_review_view` exposes the same v2
  evidence; `rebuild_*()` reproduces the incremental state; CellarTracker parity.
- This doc.
- No `apps/web` change — `wine_match_review_view` and `wine_match_queue_summary`
  keep their exact column lists / signature, so `page.tsx`, `reviewQuery.ts`
  and `database.types.ts` are untouched. Regenerating `database.types.ts` to
  pick up the new table is optional (nothing in the app queries it directly).
- Pushed to prod with `supabase db push --linked` on 6 Sep 2026 (the SSL
  `pgdelta` cert stack trace after "Finished supabase db push." is the known
  cosmetic noise — memory `project_supabase-db-push-behaviour`).
