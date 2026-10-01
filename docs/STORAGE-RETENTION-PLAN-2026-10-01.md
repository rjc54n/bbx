# Storage retention plan, 1 October 2026

**Status:** proposed 1 October 2026. Nothing below has been built or applied.
The daily sweep workflow is disabled (`gh workflow disable daily_sweep.yml`)
until this plan's steps 1–4 are done.

All sizes are from read-only queries against production on 1 October 2026.
Post-cleanup sizes are estimates, marked as such.

---

## Why now

The daily sweep failed on 30 September and 1 October. Both times
`SELECT * FROM products` hit the 2-minute statement timeout in
`load_current_products`. On 29 September the same read took about 8 seconds.
The instance was degraded from about 06:56 UTC on 1 October, before the sweep
connected at 08:25. Supabase's metrics exporter had been timing out
continuously since then, checkpoints writing 2–16 buffers took 10–30 seconds,
and by 13:00 the database refused new connections. A restart at 13:16 cleared
the jam. A manual sweep then ran: the `products` read took 3.5 seconds, but
the catalogue cache refreshes (`catalogue_mv`, `wine_market_summary_mv`) hit
the statement timeout and the run finished `partial`. The exporter started
timing out again straight afterwards.

Two limits explain it, and neither is a tuning problem:

- **Database size.** The database is **495 MB** against the free plan's
  500 MB limit. As understood (to confirm on the dashboard usage page),
  exceeding it switches the project to read-only, which would stop every
  sweep write.
- **Working set versus memory.** `shared_buffers` is about 224 MB, from a
  checkpoint writing 11,497 buffers at 40.1%. `observation_events` (163 MB),
  `products` (116 MB), `catalogue_mv` (87 MB) and `wine_market_summary_mv`
  (31 MB) together come to about 400 MB, so the sweep and the cache refreshes
  now read more than fits in memory and fall through to the free-tier disk.
  This fits the symptoms, and the disk-I/O starvation hypothesis in
  [DEPLOYMENT-INCIDENT-2026-08-28.md](DEPLOYMENT-INCIDENT-2026-08-28.md), but
  it is not proven.

`observation_events` is also the main source of growth: about 6,300 rows a
day, roughly 65 MB a month including indexes.

---

## What is in `observation_events`

465,552 rows: 55 MB of rows and 108 MB of indexes.

| Rows | Event | Read by |
|---|---|---|
| 154k | `product` / `index_last_update_flagged` | Nothing in the app. Shadow-mode ground truth for `WAVE_PRICING_DELTA_ENABLED` ([PHASE3-4-IMPLEMENTATION.md](PHASE3-4-IMPLEMENTATION.md), Step 6), which has run for 9 weeks against a planned "at least a week" |
| 162k | `sku` / `price_changed` (`market_price_p` 96k, `highest_bid_p` 38k, `least_listing_price_p` 19k, `last_transaction_p` 8k) | `price_history_view` → `recent_price_change_view` → the catalogue's price-changes mode, which shows only the **latest** change per SKU |
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
  (below) runs offline against the backup, so production doesn't need to keep
  the rows. The delta-selection code and its `scan_runs` counters
  (`wave_delta_changed_count`, `wave_shadow_only_count`) stay as they are.
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

### Step 1: sweep change (code only, committed to `main`)

In `core/sweep.py`, stop emitting the `index_last_update_flagged` events
(around line 782). Keep the `index_last_update validation` log line so the
daily count remains visible.

In `core/store.py`, add one statement to `commit_sweep`, in the same
transaction as the event insert:

```sql
DELETE FROM observation_events WHERE observed_at < now() - interval '30 days'
```

At about 4,000 rows a day once the flagged events stop, this deletes a day's
worth of old rows each run, and plain autovacuum lets the freed space be
reused. There is no `pg_cron` job, and keeping retention inside the sweep
avoids adding one.

The workflow stays disabled, so this has no production effect until step 4.
Unit tests cover both changes.

### Step 2: offline backup (operational)

Gate: the instance is healthy. A trivial query returns in milliseconds, the
metrics exporter has stopped timing out, and it is outside 02:00–05:00 UTC.
Docker Desktop must be running, because the CLI runs `pg_dump` in a container.

```bash
supabase db dump --linked --data-only --use-copy --schema private -f ~/bbx-backups/private-2026-10-01.sql
```

This covers `products`, `skus`, `offers`, `observation_events` and
`scan_runs` (about 300 MB of reads). The file stays outside the repo. Check
it has a non-zero `COPY` block for `observation_events` before going on.

### Step 3: migration (one file, pushed with `supabase db push --linked`)

```sql
DROP INDEX IF EXISTS private.idx_obs_entity;
DROP INDEX IF EXISTS private.idx_products_name_trgm;
DROP INDEX IF EXISTS private.idx_products_producer_trgm;
DROP INDEX IF EXISTS private.idx_products_region;
DROP INDEX IF EXISTS private.idx_products_vintage;
DROP INDEX IF EXISTS private.idx_products_colour;

DELETE FROM private.observation_events
WHERE event_type = 'index_last_update_flagged'
   OR observed_at < now() - interval '30 days';
```

The `products` indexes date from the read layer that predates `catalogue_mv`.
`idx_products_producer_trgm`, `_region`, `_vintage` and `_colour` show zero
scans since 28 August. `idx_products_name_trgm` (26 MB) shows 3. The
release-offer matching uses `similarity()` on
`release_wine_match_key(name, vintage)`, which this index cannot serve, so
those 3 scans look ad hoc. A sequential scan of `products` takes about 0.4
seconds, so the cost of being wrong is small, and the index can be recreated
from `20260719081754_read_layer.sql`.

The same migration fixes the 28 September `scan_runs` row that is still
`running`. That sweep failed mid-commit, and its `mark_run_failed` call timed
out too:

```sql
UPDATE private.scan_runs SET status = 'failed',
    error_message = 'statement timeout during commit; mark_run_failed also timed out (backfilled 2026-10-01)'
WHERE status = 'running' AND started_at::date = '2026-09-28';
```

The SQLite bootstrap schema in `core/db.py` drops `idx_obs_entity` to match.

### Step 3a: reclaim the space (operational, straight after step 3)

The deletes stop growth but don't shrink the database, so rewrite the table.
`VACUUM` cannot run inside the migration's transaction, so this runs
separately:

```bash
supabase db query --linked "VACUUM (FULL, ANALYZE) private.observation_events"
```

This takes an exclusive lock on `observation_events`. Nothing else writes to
it while the sweep is disabled, and the web app reads it only through the
price-changes mode. It rewrites only the surviving rows (estimated 40–50 MB),
so it needs that much temporary space. Same gates as step 2. If the request
fails ambiguously, check `pg_stat_activity` for a running `VACUUM` before
deciding anything, never resend blind.

### Step 4: verify and resume

1. `select pg_size_pretty(pg_database_size(current_database()))` is well
   under 500 MB. The estimate is about 335 MB: roughly 118 MB from
   `observation_events` and 44 MB from the `products` indexes.
2. Refresh the catalogue caches, which are still stale from 29 September,
   checking each takes well under the 2-minute timeout:
   `REFRESH MATERIALIZED VIEW CONCURRENTLY public.catalogue_mv`, then
   `public.wine_market_summary_mv`.
3. Re-enable the sweep with `gh workflow enable daily_sweep.yml`, trigger one
   manual run, and confirm it finishes `completed` with the retention delete
   logged.
4. Re-check the instance that evening, per [`../AGENTS.md`](../AGENTS.md).

### Step 5: delta-pricing evaluation (offline, any time)

Restore the backup into a local Supabase (`supabase db start`, then load the
dump) and, for each run, compare the listed parent SKUs flagged by
`index_last_update_flagged` with the listed SKUs that got a `price_changed`
event in the same run:

- **Precision:** of the flagged parent SKUs, how many actually changed price.
- **Recall:** of the parent SKUs whose price changed, how many were flagged.

One caveat: `price_changed` events also come from unlisted wines priced in
the rotation, so recall must count only SKUs that were listed in that run.
The code stores only positive flags and relies on
`skus.last_seen_run_id`/`is_listed` for the denominator, which reflects only
the latest run. Per-run listed state has to be rebuilt from the `is_listed`
`field_changed` and `appeared` events, which the backup keeps in full.

High recall at reasonable precision means `WAVE_PRICING_DELTA_ENABLED` can be
switched on, so changed unlisted wines are repriced daily instead of on a
30-day rotation. That gives fresher bid and market prices on exactly the
wines that are biddable but unlisted. Low recall means the stamp can't be
relied on, and the delta code can be removed. The result goes into
[PHASE3-4-IMPLEMENTATION.md](PHASE3-4-IMPLEMENTATION.md) Step 6.

---

## Rollback

- **Indexes:** each can be recreated from its original migration
  (`20260718210527_scan_store.sql`, `20260719081754_read_layer.sql`).
- **Deleted events:** reload from the step 2 backup.
- **Retention delete in the sweep:** revert the commit. Nothing else depends
  on it.

---

## Not in this plan

- **`catalogue_mv` (87 MB):** the next largest object and the slowest to
  refresh. It's worth looking at, but separately.
- **A paid compute tier:** it would raise both limits. This plan keeps the
  project on the free tier for now, and that is a cost decision for the owner
  if growth returns.
- **Removing gone or unlisted products, and a central wine entity:** see
  Decisions taken above.
- **Retrying statement timeouts in the sweep:** `retry_transient` treats a
  statement timeout as a cold-start symptom and retried a 2-minute query five
  times on 1 October. Narrowing that is a small separate change.
