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

## Step 5 — `prod_biddable` discovery (Phase 4)

**File:** `core/fetch_listings.py`.

`index_name` is already parameterised, so the sharding machinery transfers.
What differs:
- Shard dimensions for this index are `region → vintage → colour`. Available
  facets are region, country, vintage, colour, maturity, grape_varieties,
  index_last_update — **there is no price or format facet**, so the existing
  price-band shard level does not apply here.
- Burgundy is 23,824 records and France 36,975, so the region level will not
  clear the 1,000-hit cap alone. Recursion into vintage then colour is
  mandatory, and the `NOT` complement query per level must be retained.
- Discovery completeness must be reported exactly as it is today: compare root
  `nbHits` to unique `objectID`s collected, and fail rather than advance any
  `gone` counter on an incomplete sweep.

**Test:** shard recursion against a fixture that exceeds the cap at two levels.

---

## Step 6 — Change-driven wave pricing (Phase 4)

**Files:** `core/sweep.py`, `core/store.py`.

`index_last_update` is a facetable per-record string stamp
(`"23-07-2026 1pm"`). It is **not lexically sortable** — parse it.

Algorithm:
1. Enumerate the facet with `maxValuesPerFacet=1000`; parse to datetimes.
2. Select values newer than the last completed run; query with those values
   OR-ed as exact facet filters.
3. REST-price only those parent_skus, plus a rotating 1/30th of the book.
4. Record which path priced each SKU in `scan_runs` so coverage stays auditable.

**This is unverified and must be verified before it is relied on.** Land it
behind a flag that runs the delta selection and logs what it *would* have
skipped, while still pricing the rotation slice. Compare against observed price
changes on the listed book — where `prod_product` gives independent evidence —
for at least a week before the delta path becomes the primary one. If
`index_last_update` turns out to move only on metadata changes and not on bid
changes, the whole wave design collapses back to rotation-only; find that out
cheaply.

**Coverage rule:** a delta-only run may never advance missing-SKU or `gone`
counters. Only a complete discovery sweep may do that. This is already the
contract in `core/sweep.py` — do not weaken it.

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
