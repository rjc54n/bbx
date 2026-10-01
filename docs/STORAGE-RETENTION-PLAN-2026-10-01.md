# Storage retention plan, 1 October 2026

**Status:** proposed 1 October 2026 and revised the same day after review
(see "Review changes" at the end). Nothing below has been built or applied.
One owner decision is open: price-changes mode behaviour (step 1). The daily
sweep workflow is disabled (`gh workflow disable daily_sweep.yml`) until steps
1–5 are done.

All sizes are from read-only queries against production on 1 October 2026.
Post-cleanup sizes are estimates, marked as such.

---

## Why now

The daily sweep failed on 30 September and 1 October. Both times
`SELECT * FROM products` hit the 2-minute statement timeout in
`load_current_products`. On 29 September the same read took about 8 seconds.

**The outage: disk-I/O degradation, a working hypothesis.** The instance was
degraded from about 06:56 UTC on 1 October, before the sweep connected at
08:25. Supabase's metrics exporter timed out continuously from then on,
checkpoints writing 2–16 buffers took 10–30 seconds (against 0.3 seconds at
02:42), and by 13:00 the database refused new connections. A restart at 13:16
cleared the jam. A manual sweep then ran: the `products` read took 3.5
seconds, but the catalogue cache refreshes (`catalogue_mv`,
`wine_market_summary_mv`) hit the statement timeout and the run finished
`partial`. The exporter started timing out again straight afterwards. This
matches the I/O-starvation hypothesis in
[DEPLOYMENT-INCIDENT-2026-08-28.md](DEPLOYMENT-INCIDENT-2026-08-28.md). A
likely contributor is that the hot data no longer fits in memory:
`shared_buffers` is about 224 MB, while `observation_events` (163 MB),
`products` (116 MB), `catalogue_mv` (87 MB) and `wine_market_summary_mv`
(31 MB) come to about 400 MB. That is inference, not proof.

**A separate, current risk: the size quota.** The database is **495 MB**.
Supabase's database-size guide confirms the free plan goes read-only above
500 MB. The logs contain no read-only or disk-full errors, so the quota did
**not** cause this outage. It is a separate risk, and the next heavy sweep
would probably have crossed it.

`observation_events` is the main source of growth: about 6,300 rows a day,
roughly 65 MB a month including indexes.

---

## What is in `observation_events`

465,552 rows: 55 MB of rows and 108 MB of indexes.

| Rows | Event | Read by |
|---|---|---|
| 154k | `product` / `index_last_update_flagged` | Nothing in the app. Shadow-mode ground truth for `WAVE_PRICING_DELTA_ENABLED` ([PHASE3-4-IMPLEMENTATION.md](PHASE3-4-IMPLEMENTATION.md), Step 6), which has run for 9 weeks against a planned "at least a week" |
| 162k | `sku` / `price_changed` (`market_price_p` 96k, `highest_bid_p` 38k, `least_listing_price_p` 19k, `last_transaction_p` 8k) | `price_history_view` → `recent_price_change_view` → the catalogue's price-changes mode |
| ~150k | `appeared`, `disappeared`, `field_changed`, offer `price_changed` | Nothing. Matching reconciliation works from the before/after listed state of each run, not from these events ([MATCHING-RECONCILIATION-SPEC.md](MATCHING-RECONCILIATION-SPEC.md) §4.1) |

The sweep only ever inserts into this table. It never reads it back, so
deleting old events cannot change any sweep result.

| Index | Size | Scans since 28 Aug restart |
|---|---|---|
| `observation_events_scan_run_id_entity_type_entity_key_event_key` (unique) | 65 MB | 204k (every insert's `ON CONFLICT`) |
| `idx_obs_entity` | 30 MB | 0 |
| `observation_events_pkey` | 10 MB | 0 |
| `idx_obs_run` | 3 MB | 0 |

---

## Decisions taken

- **Price history has no current use case.** Keep 30 days in production. The
  full history goes to an offline backup, which is the place to look for bid
  strategy evidence (how often and how far `highest_bid_p` moves) if a real
  question arises.
- **Stop writing `index_last_update_flagged`.** The delta-pricing evaluation
  (step 6) runs offline against the backup. The delta-selection code and its
  `scan_runs` counters (`wave_delta_changed_count`, `wave_shadow_only_count`)
  stay as they are.
- **Leave the "wines no longer in BBX" question for later.** Only 1,026 of
  52,966 products have `gone_since` set (725 for more than 30 days), so
  removing them would save about 2 MB. Most of the book is biddable but
  unlisted (18,711 of 70,377 SKUs are listed), and whether to keep that is a
  product decision. Matching tables carry `parent_sku` without a foreign key,
  so removing products would leave match rows without wine details. That
  points towards a more central wine entity, recorded here as a future design
  question, not part of this plan.

---

## Plan

Each production step has the same **health gate**. Run it before every step,
and stop if any check fails:

- **Instance health:** `SELECT now()` returns in milliseconds, the metrics
  exporter is not timing out in the Postgres logs, and recent checkpoint
  `write` times are under a second for small checkpoints.
- **Size:** `pg_database_size(current_database())`, plus the dashboard's
  disk-usage figure (which includes WAL).
- **Timing:** outside 02:00–05:00 UTC.

### Step 1: sweep change (code only, committed to `main`)

1. In `core/sweep.py`, stop emitting the `index_last_update_flagged` events
   (around line 782). Keep the `index_last_update validation` log line so the
   daily count remains visible.
2. Add a retention step that runs **after** `commit_sweep` has committed, in
   its own transaction:

   ```sql
   DELETE FROM observation_events WHERE observed_at < now() - interval '30 days'
   ```

   It is non-fatal, following the `refresh_catalogue_caches` contract: a
   failure is logged and alerted but does not roll back or fail the sweep. A
   missed day's retention just means the next run deletes two days of rows.
   Putting it inside `commit_sweep` (`core/store.py:355`) would let a
   housekeeping failure throw away a whole day's sweep, so it does not go
   there.
3. Unit tests cover both changes, including a retention failure leaving the
   sweep `completed`.

The workflow stays disabled, so this has no production effect until step 5.

**Owner decision pending: price-changes mode.** `recent_price_change_view`
shows each SKU's latest `price_changed` event and has no date filter. Under
30-day retention, a SKU whose price hasn't changed for 30 days drops out of
the mode, where today it stays indefinitely. The mode would become "price
changes in the last 30 days". The alternative is to keep each SKU's latest
change regardless of age, at the cost of a more complicated retention rule.
Recommendation: accept the 30-day behaviour, which fits a "recent changes"
view.

### Step 2: backup, with a proven restore (operational)

Gate as above. Docker Desktop must be running, because the CLI runs
`pg_dump` in a container.

1. Record production row counts for `products`, `skus`, `offers`,
   `observation_events` and `scan_runs`.
2. Dump the data:

   ```bash
   supabase db dump --linked --data-only --use-copy --schema private -f ~/bbx-backups/private-2026-10-01.sql
   ```

   The file stays outside the repo.
3. **Prove the restore works.** Start a local Supabase (`supabase db start`),
   which applies the repository migrations to an empty database. Load the
   dump with `psql` inside the local database container, and compare row
   counts against step 2.1. Any conflict with rows the migrations seed gets
   resolved and written down here before step 4 runs.
4. **Recovery path.** Deleted history is meant to be used from the local
   restore, not reloaded into production. If a production reload is ever
   needed, insert from the restored copy with
   `INSERT … SELECT … WHERE observed_at < <cutoff> ON CONFLICT (scan_run_id, entity_type, entity_key, event_type, field_name) DO NOTHING`,
   where the conflict target is the table's unique key. Overlapping rows are
   then skipped instead of failing, and the sequence-assigned `id` values are
   not reused.

### Step 3: drop unused indexes (one small migration, `supabase db push --linked`)

```sql
DROP INDEX IF EXISTS private.idx_obs_entity;
DROP INDEX IF EXISTS private.idx_products_name_trgm;
DROP INDEX IF EXISTS private.idx_products_producer_trgm;
DROP INDEX IF EXISTS private.idx_products_region;
DROP INDEX IF EXISTS private.idx_products_vintage;
DROP INDEX IF EXISTS private.idx_products_colour;

UPDATE private.scan_runs SET status = 'failed',
    error_message = 'statement timeout during commit; mark_run_failed also timed out (backfilled 2026-10-01)'
WHERE status = 'running' AND started_at::date = '2026-09-28';
```

This migration contains no bulk delete, so the `ACCESS EXCLUSIVE` locks
`DROP INDEX` takes on `products` and `observation_events` last only as long as
the drops themselves. The `scan_runs` update fixes the 28 September row that
is still `running`: that sweep failed mid-commit, and its `mark_run_failed`
call timed out too.

**Why these indexes:**

- They date from the read layer that predates `catalogue_mv`.
- `idx_obs_entity`, `idx_products_producer_trgm`, `_region`, `_vintage` and
  `_colour` show zero scans since 28 August.
- `idx_products_name_trgm` (26 MB) shows 3 scans. The release-offer matching
  uses `similarity()` on `release_wine_match_key(name, vintage)`, which this
  index cannot serve, so those 3 scans look ad hoc. A sequential scan of
  `products` takes about 0.4 seconds, so the cost of being wrong is small.
- Each index can be recreated from its original migration.

The SQLite bootstrap schema in `core/db.py` drops `idx_obs_entity` to match.

**Expected effect:** about 74 MB freed straight away (30 MB plus 44 MB),
taking the database from 495 to roughly 421 MB. That is an estimate; confirm
it with the size check before step 4.

### Step 4: delete old events (operational, in controlled batches)

Run separately from any migration, through `supabase db query --linked`, one
batch per call, with the health gate between batches:

1. `DELETE … WHERE event_type = 'index_last_update_flagged'` (154k rows).
2. `DELETE … WHERE observed_at < now() - interval '30 days'`, one calendar
   month at a time, oldest first (July, August, then early September).

Each batch is a single statement, so an ambiguous failure is resolved by
checking `pg_stat_activity` and re-counting the batch's rows, never by
resending blind. Afterwards, run a plain `VACUUM (ANALYZE)` on
`observation_events` so the freed space can be reused and the planner sees
the new row counts.

### Step 4a: reclaim space (optional, only if the margin allows)

After step 4 the deleted space is reusable, so the table stops growing. The
next 30 days of events (an estimated 120k rows) fit in the space already
freed, and the database settles at about 421 MB. A full `VACUUM FULL` is
**not needed** to get below the quota.

To shrink the indexes that inserts actually touch, use
`REINDEX INDEX CONCURRENTLY` on the unique index and on
`observation_events_pkey` instead of `VACUUM FULL`:

- It takes no exclusive lock.
- Its peak extra space is one rebuilt index at a time. That is an estimated
  20 MB for the unique index once it holds about 125k rows, not a full second
  copy of the table.
- Before starting, check the size margin and the dashboard disk figure, and
  confirm the session timeout. The Management API query endpoint's timeout is
  not documented here, so test it on the smaller pkey first.

`VACUUM FULL` stays off the table unless a later measurement shows the empty
heap pages matter.

### Step 5: verify and resume

1. The size check shows a comfortable margin under 500 MB.
2. Refresh the catalogue caches, which are still stale from 29 September,
   checking each takes well under the 2-minute timeout:
   `REFRESH MATERIALIZED VIEW CONCURRENTLY public.catalogue_mv`, then
   `public.wine_market_summary_mv`.
3. Re-enable the sweep with `gh workflow enable daily_sweep.yml`, trigger one
   manual run, and confirm it finishes `completed` with the retention delete
   logged.
4. Re-check the instance that evening, per [`../AGENTS.md`](../AGENTS.md).

### Step 6: delta-pricing evaluation (offline, any time)

Against the local restore from step 2, for each run, compare the listed
parent SKUs flagged by `index_last_update_flagged` with the listed SKUs that
got a `price_changed` event in the same run:

- **Precision:** of the flagged parent SKUs, how many actually changed price.
- **Recall:** of the parent SKUs whose price changed, how many were flagged.

The code stores only positive flags and relies on
`skus.last_seen_run_id`/`is_listed` for the denominator, which reflects only
the latest run. Per-run listed state has to be rebuilt from the `is_listed`
`field_changed` and `appeared` events, which the backup keeps in full.
Unlisted wines priced in the rotation also produce `price_changed` events,
and they must be left out.

**This measures listed wines only, as a proxy.** `WAVE_PRICING_DELTA_ENABLED`
would act on unlisted wines, which are mostly priced only in the 30-day
rotation, so this data cannot establish recall for them. The stamp may also
behave differently when no listing changes, because the activity that moves
it could be listing-driven. Turning the flag on needs a further, bounded
test: REST-price a fixed random sample of unlisted wines daily for a set
period, and compare their price changes against the stamp. The listed result
decides whether that test is worth running. If the stamp misses many
listed-wine changes, the delta code can be removed without it.

The result goes into [PHASE3-4-IMPLEMENTATION.md](PHASE3-4-IMPLEMENTATION.md)
Step 6.

---

## Rollback

- **Indexes:** each can be recreated from its original migration
  (`20260718210527_scan_store.sql`, `20260719081754_read_layer.sql`).
- **Deleted events:** use the local restore, or follow step 2.4's
  `ON CONFLICT DO NOTHING` reload path.
- **Sweep change:** revert the commit. The retention step is non-fatal and
  nothing depends on it.

---

## Not in this plan

- **`catalogue_mv` (87 MB):** the next largest object and the slowest to
  refresh. It's worth looking at, but separately.
- **A paid compute tier:** it would raise the size quota and the memory. This
  plan keeps the project on the free tier for now, and that is a cost
  decision for the owner if growth returns.
- **Removing gone or unlisted products, and a central wine entity:** see
  Decisions taken above.
- **Retrying statement timeouts in the sweep:** `retry_transient` treats a
  statement timeout as a cold-start symptom and retried a 2-minute query five
  times on 1 October. Narrowing that is a small separate change.

---

## Review changes (1 October 2026)

An external review of the first version raised five points. All were
accepted:

1. **Index drops and the bulk delete were in one migration.** `DROP INDEX`
   would have held `ACCESS EXCLUSIVE` locks on `products` and
   `observation_events` while the delete ran. They are now separate: a small
   index-drop migration (step 3), then batched deletes (step 4), with a
   health gate before each step.
2. **"A non-empty `COPY` block" didn't prove the backup could be restored.**
   Step 2 now restores into a local database built from the repository
   migrations, compares row counts, and documents a reload path that avoids
   duplicate-key failures.
3. **`VACUUM FULL` needs room for a full second copy of the table and its
   indexes**, not the 40–50 MB estimated before. On review it isn't needed:
   step 3 alone gets well under the quota, and the deleted space is reused.
   The optional shrink now uses `REINDEX CONCURRENTLY`, which has a far
   smaller peak and no exclusive lock.
4. **The 30-day retention changes what the price-changes mode shows.** That
   is now an explicit owner decision (step 1). Retention also moves out of
   `commit_sweep` into its own non-fatal step after the commit.
5. **The delta-pricing evaluation only measures listed wines.** It is now
   reported as a proxy, and turning on `WAVE_PRICING_DELTA_ENABLED` requires
   a bounded test on a sample of unlisted wines.

The review also separated the diagnosis: the logs support I/O degradation as
the outage mechanism, and the 500 MB quota is a real but separate risk. "Why
now" is rewritten to match.
