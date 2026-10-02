# Sweep write reduction, 2 October 2026

**Status:** built and verified 2 October 2026. The conditional upserts are
verified on local Postgres against the restored 1 October backup: feeding
every stored row back unchanged rewrote only the 2 products, 253 SKUs and
469 offers that carried a non-zero miss count (an intended reset). A second
identical pass rewrote nothing beyond one deliberate price change and one
returning wine. The schedule is now every two days (`0 2 */2 * *`) and was
re-enabled on 2 October. Owner decisions: stay on the free plan, keep the
full biddable universe, drop "Last seen", a binary listed flag is enough,
Explore sorts by market price lowest first, sweep every two days.

Follows on from [STORAGE-RETENTION-PLAN-2026-10-01.md](STORAGE-RETENTION-PLAN-2026-10-01.md).

---

## Why

The retention work took the database from 495 to 317 MB and the 1 October
afternoon sweep ran cleanly. The instance degraded again anyway, with
nothing of ours running:

- From about 18:35 UTC on 1 October, Supabase's metrics exporter timed out
  about every 15 minutes.
- From 20:00, `pg_database_size()`, which only sums file sizes, took 15–80
  seconds.
- Postgres repeatedly logged "autovacuum worker took too long to start".
- The 08:00 sweep on 2 October timed out on `SELECT * FROM products`, five
  times, and the database stopped accepting connections at 08:18. The
  owner's restart at 08:54 was a crash recovery ("not properly shut down").

**Diagnosis (working hypothesis; the dashboard metrics were blank):** the
project has outgrown the free-plan instance. Supabase documents the free
plan as **Nano: shared CPU, up to 0.5 GB memory**, with short disk-throughput
bursts above a baseline. Postgres alone reserves 224 MB of that for
`shared_buffers`. Four loads compete for it:

1. **The sweep rewrites the whole book every run.** The product, SKU and
   offer upserts unconditionally set `last_seen_run_id` and `last_seen_at`
   (and `consecutive_misses = 0`, `gone_since = NULL`). Every present row
   therefore gets a new version each day: 51,947 products, ~28k SKUs and
   ~35k offers, against **388** real changes on 1 October. On top of that,
   16k `products` rows are rewritten to record `last_rest_checked_at`.
2. **The nightly physical backup** at about 03:00 UTC, which can't be moved
   on this plan.
3. **The metrics exporter's `pg_stat_statements` queries.** These took 10–15
   seconds a minute, all day, with 2,256 entries. After the crash reset the
   statistics, the same read takes **1.6 ms**. The sweep's batched upserts
   (thousands of placeholders, with a new batch-size shape most days) keep
   adding large statement texts.
4. **One-off maintenance on 1 October** (backup, deletes, `VACUUM FULL`, two
   sweeps), which likely spent the day's disk burst allowance.

Load 1 is the waste that's ours to remove, and 3 is cheap to contain. A
paid plan was considered and declined.

---

## Proposal

### 1. Write only rows that changed

Add a `WHERE` clause to each `ON CONFLICT … DO UPDATE` in `commit_sweep`
(`core/store.py`) so that Postgres skips the update, creating no new row
version and writing nothing, unless something real changed:

```sql
ON CONFLICT (parent_sku) DO UPDATE SET <same columns as today>
WHERE (products.name, products.vintage, products.region, products.subregion,
       products.colour, products.country, products.producer,
       products.grape_varieties, products.product_url)
      IS DISTINCT FROM
      (excluded.name, excluded.vintage, excluded.region, excluded.subregion,
       excluded.colour, excluded.country, excluded.producer,
       excluded.grape_varieties, excluded.product_url)
   OR products.consecutive_misses <> 0
   OR products.gone_since IS NOT NULL
```

`skus` and `offers` work the same way, each with its own data columns
(prices, `qty_available`, `source_agreement` and `is_listed`; offer price,
format and match confidence).

- The `consecutive_misses`/`gone_since` arm keeps today's behaviour for a
  row that was missing and has come back: it still gets reset.
- **`last_seen_run_id` / `last_seen_at` keep their columns but now mean
  "last changed".** They are set only when the row is written. Dropping the
  columns would mean rebuilding `catalogue_mv` and the facet caches, which
  read `last_seen_at` (`20260827120000_catalogue_materialised_read_model.sql`,
  `20260820140000_facet_caches.sql`). That is heavy work on this instance,
  for no user-visible gain. The columns can be dropped later alongside some
  other change to those views.
- Disappearance detection is unchanged. `_apply_disappearances` compares the
  keys fetched this run with the stored rows in Python and doesn't read
  `last_seen_*`.
- Doing the filtering in SQL keeps one source of truth: the database
  compares what it holds with what was fetched. The alternative, filtering in
  Python from the diff output, would duplicate the comparison rules.

**Expected effect:** heap writes per run fall from about 115k row versions
to roughly the number of real changes, typically hundreds to a few
thousand. The daily table bloat follows, and with it most of the autovacuum
work. The cache refreshes still read their sources in full, but write only
what changed. This is an estimate, to be measured on the first runs.

### 2. Clear the query statistics after each sweep

At the end of `run_daily_sweep`, call `extensions.pg_stat_statements_reset()`.
The `postgres` role has `EXECUTE`, checked on 2 October. It is non-fatal, like
retention: log on failure, no alert. This keeps the exporter's per-minute
read small. The cost is that the dashboard's query-performance view only
ever shows the last day. For a single-owner project that's fine.

### 3. Catalogue UI: remove "Last seen"

In `apps/web`:

- Remove the "Last seen" column (`components/catalogue/columns.tsx`), its
  registry entry (`lib/query/registry.ts`) and its facet range
  (`lib/query/facets.ts`).
- "Explore catalogue" (`lib/query/startingPoints.ts`) sorted by
  `last_seen_at desc`. Owner decision: market price, lowest first
  (`market_price_p asc`). Old links sorted by `last_seen_at` fall back to that
  default, because the URL parser ignores unknown sort fields. Saved scenarios
  use their own field registry, which never included `last_seen_at`.
- `fetchCatalogue.ts` mentions `last_seen_at` only in a comment. It already
  breaks ties on `(parent_sku, format_code)`, so ordering stays
  deterministic; just update the comment's example.
- Update the tests that reference it.

The "currently listed" flag already exists (`skus.is_listed`, exposed since
`20260724200000_catalogue_view_is_listed.sql`), so nothing new is needed.

### Not now: `last_rest_checked_at`

The sweep still rewrites about 16k `products` rows a day just to record
`last_rest_checked_at`. Each products row is about 1 KB, so that's roughly
16 MB of row versions a day. Moving it to a narrow
`product_rest_checks(parent_sku, checked_at)` table would cut that to about
1 MB. It's a migration plus code, so measure after items 1–2 and do it only
if needed.

---

## Delivery

One code change, no migration, committed to `main`:

1. `core/store.py`: the three conditional upserts, with unit tests on SQLite.
   SQLite supports `ON CONFLICT … DO UPDATE … WHERE` and row-value
   `IS DISTINCT FROM` (as `IS NOT`). Check the syntax and fall back to
   per-column comparisons if needed.
2. `core/sweep.py`: the post-run `pg_stat_statements_reset()`.
3. `apps/web`: remove "Last seen", choose the new default sort, update the
   tests. Vercel deploys on merge.

**Verification:**

- Local: tests, plus one run against the restored backup comparing row
  counts and `xmin` changes before and after an identical second upsert,
  which should rewrite zero rows.
- Production: the next sweep's log shows the same diff counts as before.
  Compare `n_tup_upd` on `products`/`skus`/`offers` before and after the run
  (expected: hundreds rather than about 115k) and the run time.
- Health: no exporter timeouts overnight, and `pg_database_size()` in
  milliseconds.

---

## Open decisions

1. **Sweep frequency.** Daily, every two days, or every three. Fewer runs cut
   the burst load proportionally. Prices are candidates for review, not
   trades.
2. **Pause until this ships?** Recommended. The next scheduled run is about
   08:00 UTC on 3 October, and on today's code it would rewrite the whole
   book again.
