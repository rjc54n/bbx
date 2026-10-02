# REST-check timestamp decoupling, 2 October 2026

**Status:** built and verified locally, 2 October 2026 (see "Local
verification results"). **Not deployed.** The production cutover in Delivery
needs the owner's go-ahead. The code is committed locally but not pushed,
because the sweep pulls `main` at run time and the new code needs the
migration in place first. Revised after review (see "Review changes").

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

Most of that comes from the timestamp, but not all of it. A clean baseline
(two concurrent refreshes with no source change, same day) gave:

| Table | No-change refresh #1 | No-change refresh #2 |
|---|---|---|
| `catalogue_mv` | 0 | 0 |
| `wine_market_summary_mv` | 1,245 rewritten | 0 |

`catalogue_mv` is deterministic. `wine_market_summary_mv` is not: its
`DISTINCT ON (parent_sku) … ORDER BY parent_sku, case_size` has no
tiebreaker, and **2,433 wines** have two or more formats tied on the smallest
case size, so the chosen row can flip between refreshes. That explains why
16,580 summary rows changed when the listed parents only have 16,204 summary
rows. It is a pre-existing nondeterminism, and also a small correctness quirk:
which tied format represents a wine can change from one refresh to the next.
Fixing it means adding `format_code` to the ordering, which redefines the
view and triggers the 17-view cascade below. So it waits for the next
unavoidable rebuild. Until then, expect a **residual of up to ~2.4k summary
rewrites** per refresh that this design does not remove.

So the timestamp accounts for about 28k `catalogue_mv`, about 15–16k summary
and 16.4k `products` row rewrites per run. That's still the largest write
left in the sweep. The benefit is fewer row changes and less WAL. Both
refreshes still execute their full backing queries, so their elapsed time may
fall by much less than the write counts. Verification measures WAL and
temporary I/O as well as tuple counts and duration.

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

1. **A narrow table separates the internal check time from the published
   one.**

   ```sql
   CREATE TABLE private.product_rest_checks (
       parent_sku    TEXT PRIMARY KEY REFERENCES private.products(parent_sku),
       checked_at    TIMESTAMPTZ NOT NULL,  -- internal: wave selection and freshness
       published_at  TIMESTAMPTZ            -- UI: set only after the caches refresh
   );
   ```

   - `checked_at` is written in `commit_sweep`, in the same transaction as
     the prices, and is what the sweep reads for wave selection.
   - `published_at` is set from `checked_at` only after
     `refresh_catalogue_caches` succeeds:
     `UPDATE … SET published_at = checked_at WHERE published_at IS DISTINCT FROM checked_at`.
     That's at most about 16k narrow rows per run, in its own transaction.
     It's non-fatal: if it fails, the UI keeps showing the previous published
     time, which is the conservative failure.
   - This keeps today's meaning of "Market checked" exactly. Now, the cached
     copy only moves when a refresh succeeds, so the time shown always
     matches the cached prices beside it. With a single live column, a failed
     refresh would have shown today's check time next to the previous
     refresh's prices.
   - Backfilled in the same migration: `checked_at = published_at =
     products.last_rest_checked_at`. That is consistent with the caches,
     because the last sweep that committed also refreshed them.
   - It gets the same grants as the other `private` tables (`USAGE` and
     `SELECT` to `anon`, `authenticated` and `service_role`, as in
     `20260729065629_move_scan_store_to_private.sql`), because
     `catalogue_view` is `security_invoker` and reads it with the caller's
     rights.
2. **`catalogue_view` is redefined in place** (`CREATE OR REPLACE VIEW`, so
   its columns keep the same names, order and types). `last_rest_checked_at`
   now comes from `rc.published_at` via
   `LEFT JOIN private.product_rest_checks rc ON rc.parent_sku = catalogue_mv.parent_sku`.
   The five views above it pick up the published value with no change of
   their own.
3. **The sweep stops writing `products.last_rest_checked_at`.** It writes
   `checked_at` to `product_rest_checks` (an upsert of ~16k rows of about 50
   bytes, instead of ~16k product rows of about 1 KB) and reads freshness
   from there (`last_rest_checked_at_by_parent` in `core/sweep.py`). The
   column in `products` and both cached views freezes at its cutover value,
   so the concurrent refresh stops rewriting rows for it.
4. **The frozen column stays, marked obsolete.** `catalogue_mv` and
   `wine_market_summary_mv` are both selectable by `anon` and `authenticated`
   through the API, although no app code reads either directly (checked
   2 October: the only references are in the sweep's refresh code). The
   migration adds `COMMENT ON COLUMN … IS 'Obsolete since 2026-10: frozen;
   use catalogue_view.last_rest_checked_at'` on `products`, `catalogue_mv`
   and `wine_market_summary_mv`. The release check greps the app for direct
   reads. Drop the columns with the next unavoidable rebuild.

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
- **Cutover.** The old sweep code writes only `products`, and manual
  (`workflow_dispatch`) runs bypass the schedule guard. A guard on timing
  alone isn't enough, so the cutover is explicit (see Delivery).
- **A parent without a stamp** (never REST-checked) gives `NULL`, as today.

---

## Delivery

One migration plus one code change. **Cutover sequence**, outside the sweep
window and outside 02:00–05:00 UTC:

1. `gh workflow disable daily_sweep.yml`, which stops scheduled and manual
   starts.
2. Confirm nothing is running: no `in_progress` run in `gh run list` and no
   `running` row in `scan_runs` from the last few hours.
3. Health gate, push the migration (`supabase db push --linked`), then smoke
   reads of `catalogue_view` and a wine page.
4. Push the code to `main` (the sweep checks out `main` when it starts).
5. `gh workflow enable daily_sweep.yml`.

**Migration (`supabase/migrations/2026100…_product_rest_checks.sql`):**
- Create the table and grants.
- Backfill: `INSERT … SELECT parent_sku, last_rest_checked_at, last_rest_checked_at FROM private.products WHERE last_rest_checked_at IS NOT NULL`.
  That's at most about 52k narrow rows.
- `CREATE OR REPLACE VIEW public.catalogue_view …` (same column list, one
  join, reading `published_at`).
- Obsolete-column comments on `products`, `catalogue_mv` and
  `wine_market_summary_mv`.

**Code:**
- `core/store.py`: write `checked_at` to `product_rest_checks` in
  `commit_sweep` (upsert in batches); add `publish_rest_checks(conn)`; add a
  loader for the freshness map.
- `core/sweep.py`: call `publish_rest_checks` only after
  `refresh_catalogue_caches` succeeds (non-fatal, logged).
- `core/sweep.py`: read freshness from the loader.
- `core/db.py`: add the table to the SQLite schema.
- Unit tests for the stamp path and the freshness-based selection.

**pgTAP:**
- `catalogue_view.last_rest_checked_at` follows
  `product_rest_checks.published_at`, not `checked_at` and not `products`.
- `anon` and `authenticated` can read through the view.
- The existing read-layer security tests still pass.

---

## Verification (local, against the restored backup, before production)

1. **Row equivalence:** hash every row of the six views listed above before
   and after the migration. Expect identical results, because the backfill
   copies the same values.
2. **Write reduction, against a clean baseline.** First refresh both caches
   concurrently until a no-change refresh rewrites nothing. Then stamp ~16k
   parents' `checked_at` and `published_at` and refresh again. Expect 0 rows
   in `catalogue_mv` and only the tie residual in `wine_market_summary_mv`.
   Record tuple counts, WAL bytes (`pg_current_wal_lsn()` before and after),
   temporary bytes (`pg_stat_database.temp_bytes`) and duration, before and
   after the change.
3. **Publication gap:** simulate a failed cache refresh after a commit and
   check that `catalogue_view.last_rest_checked_at` still shows the previous
   published time.
4. **Read timing, before and after:**
   - the catalogue Explore query with `count: "exact"`;
   - a wine page (`wine_card_format_view`);
   - the BBR cellar market view;
   - the release-price market view;
   - one scenario evaluation over `wine_scenario_view`.

   Accept a regression only if it's under about 10% or under 50 ms. Anything
   more stops the release.
5. The full pgTAP suite on a clean `supabase db reset`.

**Production:**
- Health gate (as in the retention plan), `supabase db push --linked`, then
  smoke reads of `catalogue_view` and a wine page.
- After the next sweep: `n_tup_upd` on `products`, `n_tup_ins`/`n_tup_del`
  on both cached views (expected: close to the real change count), and the
  refresh durations against 1 October's 16 s and 48 s.

---

## Local verification results (2 October 2026)

Against the restored 1 October backup, on local Postgres 17.

**Row equivalence.** Hashes of every row of `catalogue_view`,
`wine_card_format_view` and `wine_scenario_view` (69,899 rows each) were
identical before and after the migration. The BBR cellar and release-price
views are empty locally, because their source tables are in `public` and the
backup covers `private` only. They take `last_rest_checked_at` from
`catalogue_view` by key join, so they are identical by construction. 52,965
parents were backfilled; one wine has never been checked.

**Writes for one sweep's stamps (16,404 listed parents)**, using the real
`commit_sweep` → `refresh_catalogue_caches` → `publish_rest_checks` path,
with statistics read from independent sessions:

| Table | Before | After |
|---|---|---|
| `catalogue_mv` rows rewritten | 28,191 | **0** |
| `wine_market_summary_mv` rows rewritten | 16,569 | 2,478 (tie flips only; the input was identical) |
| `products` rows updated | 16,404 | **0** |
| `product_rest_checks` rows updated | — | 32,808 (stamp + publish, ~50-byte rows) |
| WAL (stamp + both refreshes, SQL harness) | 153 MB | **9 MB** |
| Temporary I/O | 105 MB | 89 MB |
| Elapsed (laptop) | 10.7 s | 2.4 s |

**Publication gap.** After the commit, "Market checked" still showed the old
value. It moved only after the refresh and publish. Unit test: a failed cache
refresh leaves `published_at` unchanged while `checked_at` advances.

**Read timing, and a design change found here.** The first version of
`catalogue_view` (a `LEFT JOIN` to the narrow table) made the catalogue page
**4–5× slower** when read with `select("*")`. In a paired comparison, the
Explore page went from 7.8 to 37.3 ms and the Burgundy page from 8.2 to
31.7 ms. Postgres hash-joins all 70k rows before sorting and keeping 50. A
correlated subquery was no better (41.6 ms), because it stops parallel
workers. The fix is on the application side. The catalogue never shows the
column, so `fetchCatalogue` now requests an explicit column list
(`CATALOGUE_SELECT`) without it. Postgres then drops the join, and the page
costs the same as before: Explore 24.6 vs 25.0 ms, Burgundy 20.9 vs 21.2 ms
in a paired run. A unit test keeps `"*"` and `last_rest_checked_at` out of
that list. Scenario evaluation already selects explicit columns without it,
so it's unaffected. The pages that do show "Market checked" read one wine, a
few hundred holdings or a few dozen release prices, where the join is cheap
(wine page 1.0 ms, a 300-holding join 2.0 ms).

**Tests.**
- Python: 341 passed.
- pgTAP: 487 passed on a clean `supabase db reset`, including 8 new tests in
  `product_rest_checks.test.sql` covering grants, the published value
  through `catalogue_view` and `wine_card_format_view`, the frozen products
  column being ignored, and publish.
- Web: typecheck, 359 tests and lint pass.

## Not in scope

- **Replacing `wine_market_summary_mv` with per-wine aggregates.** Reconsider
  only if the refresh still struggles after this. The uncached form was slow
  before.
- **A plain (non-concurrent) refresh.** It would block catalogue readers, and
  locally the concurrent refreshes took 2.9 s and 1.0 s, so there's no clear
  gain.
- **Dropping the frozen column.** Do it with the next unavoidable rebuild of
  the cached views.

---

## Review changes (2 October 2026)

1. **Publication gap.** A single live column would have shown a new check
   time beside stale cached prices whenever a refresh failed. Now there are
   two columns: `checked_at` for the sweep, and `published_at` for the UI,
   set only after the caches refresh successfully.
2. **Measurement baseline.** A clean baseline showed `catalogue_mv` is
   deterministic but `wine_market_summary_mv` can flip between tied formats
   (2,433 wines; 1,245 rows on one no-change refresh). The expected outcome
   now states that residual, and fixing the tie is deferred to the next
   rebuild.
3. **Cutover.** Disable the workflow, confirm nothing is running, migrate,
   smoke-test, push the code, then re-enable.
4. **Benefit stated more narrowly**, with WAL and temporary I/O added to the
   measurements.
5. **The frozen API column** is marked obsolete with column comments, after
   checking that the app doesn't read the cached views directly.

