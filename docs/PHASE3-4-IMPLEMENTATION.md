# Implementation plan — Phases 3 and 4

**Target implementer:** Sonnet agents, one step per agent, in order. Each step
lands green tests before the next begins. Do not batch steps.

**Preconditions:** `supabase db push` is broken on this CLI profile. Apply SQL
with `supabase db query --profile bbx --linked --file <path>`; regenerate types
with `supabase gen types --profile bbx --linked`.

---

## Step 1 — Format premium curve (Phase 3)

**Files:** `core/format_premium.py` (new), `tests/test_format_premium.py` (new).

Pure module, no I/O. Stores the measured curve as a constant and exposes
`adjusted_guide_pence(market_price_p, case_size, bottle_volume_ml) -> int`.

```python
# Median premium over the standard-bottle £/litre, measured from 450 BBR
# historic offers that priced a bottle case and another format in the same
# offer (23 July 2026). BBX's guide assumes +0.0% for all of these because it
# is Liv-ex scaled linearly by volume.
FORMAT_PREMIUM = {375: 0.031, 750: 0.0, 1500: 0.031,
                  3000: 0.178, 6000: 0.109, 9000: 0.143}
```

Rules:
- 750 ml is the reference and always returns the guide unchanged.
- Unknown volumes return the guide unchanged and are **not** silently bucketed
  to the nearest known size.
- Jeroboam is 3 L in Burgundy and 5 L in Bordeaux. The stored `format_code`
  carries the actual millilitres, so this ambiguity does not arise at runtime —
  do not add a "jeroboam" concept.

**Tests:** reference format is identity; each mapped volume applies its
premium; unknown volume is identity; None guide returns None.

---

## Step 2 — Read-model columns (Phase 3)

**File:** `supabase/migrations/<timestamp>_format_adjusted_guide.sql`.

Extend `catalogue_view` with:
- `price_per_bottle_p` = `ask / case_size`
- `price_per_litre_p` = `ask / (case_size * bottle_volume_ml / 1000.0)`
- `adjusted_guide_p` — guide × (1 + premium), premium inlined as a SQL `CASE`
  over `bottle_volume_ml` matching `FORMAT_PREMIUM` exactly
- `price_vs_adjusted_guide_pct` — same signed convention as the existing
  `price_vs_*_pct` columns (negative = ask cheaper), NULL when the denominator
  is missing or ≤ 0

Reuse the migration-002 lockdown pattern: `REVOKE ALL … FROM PUBLIC, anon,
authenticated`, then targeted `GRANT SELECT`. Regenerate
`apps/web/src/lib/database.types.ts` afterwards.

**Constraint:** the SQL `CASE` and `FORMAT_PREMIUM` must not drift. Add a test
that parses the migration and asserts the two agree.

---

## Step 3 — Surface in the browser (Phase 3)

**Files:** `apps/web/src/lib/query/registry.ts`, `columns.tsx`.

Add `price_vs_adjusted_guide_pct` to `CATALOGUE_METRICS` and
`CATALOGUE_FILTERS` (kind `range`, group `Price`). Its `explanation` must say
the correction is **modelled from BBR release pricing, not observed on BBX**,
and `estimate: true`.

Add `price_per_bottle_p` and `price_per_litre_p` as sortable metrics.

---

## Step 4 — REST batch size (Phase 4, prerequisite) — done 2026-07-23

**File:** `core/pipeline.py`.

`REST_BATCH_SIZE = 24` → `96`. Measured cap is ~98; 96 leaves headroom.
Add a short comment recording the measurement. Add a sleep between REST
batches — the Algolia path has jittered politeness and the REST path has none.

Landed as `REST_JITTER = (0.2, 0.5)` inside `_fetch_rest_batch`, in a
`finally` so it fires on every attempt (success or failure) rather than only
before a retry — mirrors `fetch_listings.py`'s `REQUEST_JITTER`, which sleeps
after every Algolia request regardless of outcome.

**Test:** existing `fetch_rest_pricing` tests must pass unchanged; add one
asserting batch chunking at the new size.

---

## Step 5 — `prod_biddable` discovery (Phase 4) — done 2026-07-23

**File:** `core/fetch_listings.py`; new function `fetch_biddable_universe()`,
reusing the existing `_fetch_sharded`/`_count_and_facets` machinery unchanged
(both are already generic over `index_name` and shard facet fields).

`index_name` is already parameterised, so the sharding machinery transfers.
What differs:
- Shard dimensions for this index started as planned at `region → vintage →
  colour`. Available facets are region, country, vintage, colour, maturity,
  grape_varieties, index_last_update — **there is no price or format
  facet**, so the existing price-band shard level does not apply here.
- Burgundy alone is ~28,000 records (order of magnitude only — this is a
  live index and the count drifts within a session), well over the
  1,000-hit cap by itself, so recursion into vintage then colour is
  mandatory, and the `NOT` complement query per level is retained.
- **Live-verified against real data that three dimensions were not enough.**
  A full Burgundy sweep (region pinned, sharding by vintage → colour) hit six
  explicit truncation warnings — vintage×colour leaf shards from 1,088 to
  1,374 hits with no dimension left to split by (e.g. 2019 Red: 1,374 hits).
  Added **`maturity`** (4 low-cardinality single-valued values: Ready -
  youthful/at-best/mature, Not ready) as a 4th shard dimension —
  `BIDDABLE_SHARD_DIMENSIONS = ["region", "vintage", "colour", "maturity"]`.
  Re-verified live against the exact failing leaf (Burgundy/2019/Red,
  pinned, sharded by `maturity` alone): 1,374/1,374 collected,
  `discovery_complete = True`, in 15s (vs. 267s for the full-region sweep —
  scoping the re-check to the known failure was far cheaper than repeating
  the whole thing). **Even four dimensions may not be exhaustive for every
  possible leaf** — the existing truncation-with-warning fallback (Phase 0.5)
  still applies if a future combination outgrows all four; this is a
  measured improvement, not a proof of sufficiency for all time.
- Excluded `family_type:'Wines'` only (`BIDDABLE_BASE_FILTERS`) — the index
  also carries `'Assortment Mixed Cases'`, which don't fit the
  one-SKU-one-wine `products`/`skus` model and aren't handled by this
  ingest.
- Discovery completeness must be reported exactly as it is today: compare root
  `nbHits` to unique `objectID`s collected, and fail rather than advance any
  `gone` counter on an incomplete sweep. (Caution for anyone re-testing this
  live: capture the root count *before* running the sharded fetch, matching
  `fetch_listings`/`fetch_biddable_universe` — capturing it afterwards against
  a long-running sweep compares to a moving target on a continuously-updated
  index, which is a measurement artifact, not a discovery-completeness bug.)

**Test:** `tests/test_fetch_listings_sharding.py` — a fixture recursing two
levels deep (region → vintage → colour) and a second reproducing the real
failure shape three levels deep (region → vintage → colour, still over cap →
maturity), plus `fetch_biddable_universe`-level tests (FetchResult shape,
`family_type:'Wines'` exclusion of mixed cases).

---

## Step 6 — Change-driven wave pricing (Phase 4) — done 2026-07-24 (mechanism + wiring, Option A)

**Files:** `core/sweep.py`, `core/store.py`, `core/db.py` (SQLite schema),
`supabase/migrations/20260724122841_wave_pricing_columns.sql` (Postgres),
`apps/daily_sweep/run_sweep.py`, `.github/workflows/daily_sweep.yml`.

`index_last_update` is a facetable per-record string stamp
(`"23-07-2026 1pm"`). It is **not lexically sortable** — parse it (done:
`parse_index_last_update`, `%d-%m-%Y %I%p`, tolerant of unpadded day/month
and both am/PM case; verified against every real format observed this
session including the 12am/12pm edge cases).

**The selection mechanism, built as standalone, independently-tested
functions:**
- `rotation_bucket_for_date(run_date)` / `_sku_rotation_bucket(parent_sku)`
  — deterministic day → bucket and SKU → bucket assignment (`ROTATION_BUCKETS
  = 30`), using SHA-256 rather than Python's built-in `hash()` (salted per
  process via `PYTHONHASHSEED`, so it would reassign every SKU's bucket on
  every process restart — exactly wrong for a schedule meant to cycle
  predictably).
- `select_biddable_rest_pricing(hits, last_run_finished_at, run_date,
  delta_enabled=False)` → `RestPricingPlan`. Delta selection (parsing each
  hit's `index_last_update` and comparing to the last run) always runs and
  is reported (`delta_changed`, `shadow_only`) **regardless of
  `delta_enabled`** — that's the shadow-logging the plan asks for. `to_price`
  is rotation-only while the flag is off; rotation ∪ delta once it's on.
  `last_run_finished_at=None` (no prior run to compare against) means no
  delta selection at all, not "everything looks changed."
- `update_run_wave_pricing(conn, run_id, ...)` persists per-run counts
  (`wave_delta_enabled`, `wave_rotation_count`, `wave_delta_changed_count`,
  `wave_shadow_only_count`, `wave_priced_count`) to `scan_runs` — the
  auditability the plan asks for as a SQL-queryable table, not log-scraping.
  New columns added to both the SQLite bootstrap schema (`core/db.py`) and
  the production Postgres store (new migration, applied to the linked
  Supabase project and dry-run-verified first).
**Wired in via Option A** (discovery source swapped, not a parallel sweep —
see the two options this was chosen between, below): `run_daily_sweep` now
calls `fetch_biddable_universe()` (prod_biddable) instead of `fetch_listings()`
(prod_product). REST pricing tiers on `_is_listed_hit(hit)` (does this hit
carry a live listing): listed parent_skus are always fully priced, exactly
as before Phase 4; unlisted parent_skus go through
`select_biddable_rest_pricing`.

**A real, live-discovered compatibility bug, found and fixed before this
went anywhere near production:** `prod_product` is a **per-listing** index
(`objectID == bbx_listing_id`; multiple hits can share a `parent_sku`, one
per listing, each denormalising the full sibling-offer list under
`purchase_options[]`). `prod_biddable` is **per-product**
(`objectID == parent_sku`; exactly one hit per wine), with live listings
under `bbx_listings[]` instead. `_extract_offers` read only
`purchase_options`, so swapping the discovery source would have silently
returned **zero offers for the entire biddable universe** — not an error,
just quietly empty. Verified live (2026-07-24) that the inner shape
(`case_size`, `bottle_volume`, `bbx_listing_id`, `prices.price_per_case_exact`)
is identical either way; fixed by having `_extract_offers` read
`purchase_options` **or** `bbx_listings`, whichever is present, so both
discovery sources keep working through the same extraction code (`fetch_listings`
is still used elsewhere, e.g. the hourly arbitrage bot).

**The coverage-rule exemption, widened correctly, not weakened:**
`commit_sweep`'s `rest_failed_skus` parameter (and `process_disappearances`'/
`_apply_disappearances`') is renamed to **`rest_unchecked_skus`** and now
carries genuinely-failed REST batches **union** wave-pricing-skipped
parent_skus — either way, a SKU wasn't confidently checked this run, so
silence must not count as evidence of absence. This is a pure rename plus a
wider input set at the one call site in `run_daily_sweep`; it does **not**
touch `update_run_rest`'s own `rest_failed_skus` (the real, narrower,
web-app-visible `scan_runs` column — still means exactly "REST batches that
genuinely failed", unwidened).

**`rest_skus_expected` now means "attempted", not "discovered":** with
wave pricing most of the biddable universe is *intentionally* not
REST-priced on a given day, so `rest_skus_expected` is `len(parent_skus_to_price)`
(listed ∪ wave-selected unlisted) rather than every discovered `parent_sku` —
otherwise `rest_coverage` would read as ~0.1% on a normal day and
`_determine_final_status` would mark every run `"partial"`, which skips
disappearance-tracking for the **entire** book, not just the wave-skipped
part. How much of the whole biddable universe was actually touched is a
separate, already-captured metric (`wave_priced_count` vs. total unlisted
hits), not conflated with REST-attempt coverage.

**Chosen between two options, not picked silently:**
- **Option A (chosen)** — swap the discovery source, as above.
- **Option B — a separate, parallel sweep.** A new `scope='biddable'` run
  (the schema already supports multiple scan scopes via
  `UNIQUE (scope, run_date) WHERE status='completed'`) alongside the
  existing `full_book` sweep, untouched. Simpler in isolation, but two
  independently-complete discovery sweeps writing `gone_since` to the same
  shared `products`/`skus`/`offers` rows risks the two scopes disagreeing
  about the same row's presence. Not used.

- `apps/daily_sweep/run_sweep.py` reads `WAVE_PRICING_DELTA_ENABLED` (default
  unset/false) and threads it through as `delta_enabled`.
  `.github/workflows/daily_sweep.yml` exposes it as a repository variable
  (`vars.WAVE_PRICING_DELTA_ENABLED`), and its timeout was raised
  45 → 90 minutes — a live single-region (Burgundy, ~28k records)
  discovery-only test took ~4.5 minutes; the full multi-region sweep is
  untested end-to-end, so this is a conservative estimate to watch on the
  first real runs, not a measured figure.
- 41 new/changed tests across `core/sweep.py`'s and `core/store.py`'s test
  suites: the 33 from the mechanism, plus new `run_daily_sweep`-level
  integration tests proving the actual wiring (listed-always-priced,
  unlisted-outside-rotation-skipped, unlisted-inside-rotation-priced,
  skip-never-counts-as-a-miss across multiple consecutive skip days,
  `rest_skus_expected` counting only attempted SKUs, wave-pricing stats
  persisted to `scan_runs`, `delta_enabled` reaching an otherwise-excluded
  SKU only when true) plus real extraction functions run against live
  `prod_biddable` data (100 real hits: 7 listed → 7 offers, 100 products, no
  loss). One test-authoring bug caught along the way: a naive REST mock that
  ignores its `skus` argument entirely (fine when every hit is listed, which
  is all the pre-existing 24 tests needed) produces both false passes and
  false failures for tests that specifically assert a SKU was or wasn't
  priced — fixed with a second, argument-aware mock (`_patch_fetchers_strict`)
  used wherever that distinction is the point of the test. 239/239 passing.

**Coverage rule:** a delta-only run may never advance missing-SKU or `gone`
counters. Only a complete discovery sweep may do that. This is already the
contract in `core/sweep.py` — do not weaken it (see Option A above for
exactly where this bites once wired in).

---

## Step 7 — Unlisted SKUs as first-class (Phase 4)

**Files:** `supabase/migrations/<timestamp>_biddable_universe.sql`,
`core/models.py`, `apps/web/src/lib/query/registry.ts`,
`apps/web/src/components/catalogue/CatalogueBrowser.tsx`.

Not a new entity. "Available to bid" already fits the existing
products → skus → offers model (Phase 1A): a never-listed wine is a
`products` row, a `skus` row with `least_listing_price_p = NULL` but
`market_price_p` / `highest_bid_p` populated (REST prices unlisted SKUs
today, unchanged by Phase 4), and zero matching `offers` rows. Phase 4
widens *discovery* (shard `prod_biddable` in addition to `prod_product`) so
these rows get created for wines with no listing anywhere, not just
unlisted formats of an already-listed wine (as of 2026-07-23 the store
already carries 9,592 such rows out of 27,142 active SKUs across 15,483
products — this is the same shape at 35x smaller scale).

The gap Phase 4 actually needs to close is that `catalogue_view` has no ask
filter, so "Explore catalogue" already silently mixes listed and unlisted
SKUs — invisible today because unlisted is a minority (9,592/27,142); not
invisible once the `prod_biddable` ingest makes it the large majority.

- Add `is_listed` (derived: `ask IS NOT NULL AND ask > 0`) to `catalogue_view`.
- Surface it as a **checkbox filter** ("Show unlisted wines" or equivalent),
  not a separate mode/tab and not a new `STARTING_POINTS` entry — same
  widget as the format-adjusted-values toggle shipped this session, but a
  different category underneath: this one changes which *rows* come back,
  so it must be a real `CATALOGUE_FILTERS` entry, applied via
  `.eq("is_listed", ...)` in `fetchCatalogue`, and round-tripped through
  `url.ts` like every other filter — a shared link has to reproduce the same
  rows in a fresh session. The format-adjusted toggle is deliberately
  component-local state precisely because it *doesn't* affect rows; don't
  reuse that pattern here.
- Default value (`is_listed: true` vs. unfiltered) is a product call, not an
  engineering one — worth deciding explicitly before this ships rather than
  defaulting by accident.
- `price_vs_*` metrics must render as "no ask" rather than NULL-as-zero for
  unlisted rows.

---

## Guardrails for every step

- Never place, amend or cancel a bid. This work is read-only against BBX.
- REST calls are rationed. No step may add a code path that prices the full
  book on a schedule.
- Percentages keep the existing signed convention: negative means the ask is
  cheaper than the reference.
- Modelled values (the format correction) must be labelled distinctly from
  stored estimates and from observed facts, in both the registry metadata and
  the UI.
