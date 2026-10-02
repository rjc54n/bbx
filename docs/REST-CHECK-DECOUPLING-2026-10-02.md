# REST-check timestamp decoupling, 2 October 2026

**Status:** design, 2 October 2026. Nothing below is built. Follows
[SWEEP-WRITE-REDUCTION-2026-10-02.md](SWEEP-WRITE-REDUCTION-2026-10-02.md)
and an external review of it, which pointed out that the per-run
`last_rest_checked_at` stamp flows into both cached views. Constraints from the
owner: free plan, full ~52k biddable universe. "Market checked" stays as it is.

---

## The problem, measured

Each sweep stamps `products.last_rest_checked_at` for every parent it
REST-prices: about 16,300 a run (all listed parents plus the wave
selection). That column is copied into `catalogue_mv`
(`20260827120000_catalogue_materialised_read_model.sql`, line 157) and from
there into `wine_market_summary_mv` (line 283).

Measured on the restored 1 October backup (local, 2 October): stamp the
16,404 parents with a listed SKU, then `REFRESH … CONCURRENTLY` both views.

| Table | Rows rewritten | Share |
|---|---|---|
| `catalogue_mv` | 28,191 deleted + 28,191 inserted | 40% of 69,899 |
| `wine_market_summary_mv` | 16,580 deleted + 16,580 inserted | 32% of 51,066 |
| `products` (the stamp itself) | 16,404 updated | 31% |

That is about 61,000 row rewrites per run caused only by the timestamp,
against a few hundred real changes now that the upserts are conditional. It's
the largest write left in the sweep.

---

## Rejected: drop the column from the cached views

Postgres can't redefine a materialized view in place. Removing the column
means `DROP … CASCADE` and recreating everything built on the two views:
**17 views, up to three levels deep**. That covers the catalogue, the BBR
cellar, CellarTracker, release offers, favourites, matching, scenarios and
the wine card. It's the same kind of deployment that took the catalogue down
on 27 August, and it's far more change than the problem needs.

## Proposed: freeze the cached column, serve the live value through `catalogue_view`

Every plain view that exposes `last_rest_checked_at` gets it through
`catalogue_view`, which is a thin wrapper over `catalogue_mv`:

| View | Gets `last_rest_checked_at` from |
|---|---|
| `catalogue_view` | `catalogue_mv` |
| `bbr_cellar_market_view` | `catalogue_view` |
| `bbr_cellar_positions_market_view` | `catalogue_view` |
| `release_price_market_view` | `catalogue_view` |
| `wine_card_format_view` | `catalogue_view` |
| `wine_scenario_view` | `wine_card_format_view` |

`wine_market_summary_mv` carries the column too, but nothing reads it from
there. So:

1. **A narrow table holds the live value.** It becomes the sweep's source of
   truth for freshness.

   ```sql
   CREATE TABLE private.product_rest_checks (
       parent_sku  TEXT PRIMARY KEY REFERENCES private.products(parent_sku),
       checked_at  TIMESTAMPTZ NOT NULL
   );
   ```

   It is backfilled from `products.last_rest_checked_at` in the same
   migration. It gets the same grants as the other `private` tables
   (`USAGE` and `SELECT` to `anon`, `authenticated` and `service_role`, as in
   `20260729065629_move_scan_store_to_private.sql`), because `catalogue_view`
   is `security_invoker` and reads it with the caller's rights.
2. **`catalogue_view` is redefined in place** (`CREATE OR REPLACE VIEW`, so
   its columns keep the same names, order and types). `last_rest_checked_at`
   now comes from
   `LEFT JOIN private.product_rest_checks rc ON rc.parent_sku = catalogue_mv.parent_sku`.
   The five views above it pick up the live value with no change of their
   own.
3. **The sweep stops writing `products.last_rest_checked_at`.** It writes
   stamps to `product_rest_checks` (an upsert of ~16k rows of about 50 bytes,
   instead of ~16k product rows of about 1 KB) and reads freshness from there
   for wave selection (`last_rest_checked_at_by_parent` in `core/sweep.py`).
   The column in `products` and both cached views freezes at its cutover
   value. Frozen means unchanging, so the concurrent refresh stops rewriting
   rows for it.
4. **The frozen column stays.** It's dead data, documented as such in the
   migration. It can be dropped the next time the cached views have to be
   rebuilt for some other reason.

**What doesn't change:** "Market checked" on the wine page, the BBR cellar
browser and the release-price browser shows the same value as today. The
cellar browser sorts on the client, and nothing filters on the column in
SQL. The web app needs no code change.

---

## Risks

- **Read cost of the join.** `catalogue_view` gains a primary-key join to a
  52k-row table of about 3 MB. Paged reads (50 rows) should not notice, but a
  `count: "exact"` catalogue query and the scenario stack
  (`wine_scenario_view`, already the slowest read path) could. Timing them
  before and after is a release gate, not an afterthought.
- **Deployment order.** The sweep code reads the new table, so the migration
  goes first. Deploy in the daytime: the sweep only runs 22:00–01:00 UK time,
  so the code and migration can't half-meet a running sweep.
- **A parent without a stamp** (never REST-checked) gives `NULL`, as today.

---

## Delivery

One migration plus one code change, deployed together outside the sweep
window and outside 02:00–05:00 UTC.

**Migration (`supabase/migrations/2026100…_product_rest_checks.sql`):**
- Create the table and grants.
- Backfill: `INSERT … SELECT parent_sku, last_rest_checked_at FROM private.products WHERE last_rest_checked_at IS NOT NULL`.
  That's at most about 52k narrow rows.
- `CREATE OR REPLACE VIEW public.catalogue_view …` (same column list, one
  join).
- A comment on `products.last_rest_checked_at` marking it frozen.

**Code:**
- `core/store.py`: write stamps to `product_rest_checks` (upsert in batches);
  add a loader for the freshness map.
- `core/sweep.py`: read freshness from the loader.
- `core/db.py`: add the table to the SQLite schema.
- Unit tests for the stamp path and the freshness-based selection.

**pgTAP:**
- `catalogue_view.last_rest_checked_at` follows `product_rest_checks`, not
  `products`.
- `anon` and `authenticated` can read through the view.
- The existing read-layer security tests still pass.

---

## Verification (local, against the restored backup, before production)

1. **Row equivalence:** hash every row of the six views listed above before
   and after the migration. Expect identical results, because the backfill
   copies the same values.
2. **Write reduction:** repeat the measurement above. Stamp ~16k parents in
   `product_rest_checks` and refresh both caches concurrently. Expect zero
   rows inserted or deleted in either view.
3. **Read timing, before and after:**
   - the catalogue Explore query with `count: "exact"`;
   - a wine page (`wine_card_format_view`);
   - the BBR cellar market view;
   - the release-price market view;
   - one scenario evaluation over `wine_scenario_view`.

   Accept a regression only if it's under about 10% or under 50 ms. Anything
   more stops the release.
4. The full pgTAP suite on a clean `supabase db reset`.

**Production:**
- Health gate (as in the retention plan), `supabase db push --linked`, then
  smoke reads of `catalogue_view` and a wine page.
- After the next sweep: `n_tup_upd` on `products`, `n_tup_ins`/`n_tup_del`
  on both cached views (expected: close to the real change count), and the
  refresh durations against 1 October's 16 s and 48 s.

---

## Not in scope

- **Replacing `wine_market_summary_mv` with per-wine aggregates.** Reconsider
  only if the refresh still struggles after this. The uncached form was slow
  before.
- **A plain (non-concurrent) refresh.** It would block catalogue readers, and
  locally the concurrent refreshes took 2.9 s and 1.0 s, so there's no clear
  gain.
- **Dropping the frozen column.** Do it with the next unavoidable rebuild of
  the cached views.
