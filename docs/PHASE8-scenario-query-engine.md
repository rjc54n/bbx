# Phase 8 — Scenario query engine

**Status:** plan, not yet started. Supersedes nothing; extends the saved
scenarios feature shipped in
`supabase/migrations/20260817150000_saved_scenarios.sql` and
`apps/web/src/app/(protected)/scenarios/`.

**Prompted by:** a bug report where a scenario named "biddable ask less than
release" returned no rows despite qualifying wines existing. The query engine
was working exactly as written; the builder let the user express something
that could not match, with no feedback. See "The two failures" below.

---

## The two failures behind the report

### 1. A unit trap: `lowest_ask_p` is pence per case

Money is stored as integer pence with a `_p` suffix. This entered on
2026-07-18 (`617f4b6`, Phase 1B) in `core/models.py`:

```python
def pounds_to_pence(value) -> Optional[int]:
    v = int(round(float(value) * 100))
```

The BBX/BBR feed returns pound floats; ingestion converts to integer pence so
no money is ever held in a float. That is correct at the storage layer — the
view arithmetic (`round(100 * (ask - release) / release, 1)`) would drift on
floats.

Every **output** surface converts back: `formatPence`, `formatSignedPence` and
`perBottleP` in `apps/web/src/lib/format.ts` all divide by 100. Users never see
raw pence on the catalogue or the wine card.

`SCENARIO_FILTERS` (`apps/web/src/lib/scenarios/registry.ts`) is the one place
a raw storage column is wired straight to a user-facing number input
(`ScenarioEditor.tsx`). `units: "pence"` is a label string, not a conversion.
A user reading "Ask / 75cl £38.50" in the results table types `30` into a
filter that wants pence per case, and `lowest_ask_p = lte.30` matches nothing,
ever.

**No presentation boundary was ever defined for filter inputs** because every
other consumer of these columns is read-only and formatted.

### 2. A hidden existence filter: range predicates drop NULLs

`bid_vs_release_pct` is
`round(100 * (highest_bid_p - release_price_p) / NULLIF(release_price_p, 0), 1)`.
When a format has no live bid (`highest_bid_p IS NULL`) or no resolved anchor,
the whole expression is NULL. `applyFilters` then issues `.gte`/`.lte`, and
`NULL >= -90` / `NULL <= 10` are both false, so the row is dropped.

A range the user reads as "basically unconstrained" (`-90` to `10`) is in fact
"must currently have a live bid and a resolved anchor". Most formats have no
bid at any given moment.

### 3. The scenario could not express the intent anyway

"Biddable ask less than release" needs:

- an `is_biddable` filter — not in `SCENARIO_FILTERS`, though `is_biddable` is
  already selected into `wine_scenario_view`. The empty-state copy ("No
  biddable format matches") and the list-page blurb ("every biddable format")
  both claim a biddable scope the view does not enforce.
- a **field-vs-field** comparison (`ask < release`). The builder only offers
  `field OP constant`.

So the closest expressible query was a contradiction, and the builder ran it.

---

## What the current engine cannot express

The definition is `AND(predicate…)` where each predicate is
`registry_field (range|in|eq|text) literal`
(`apps/web/src/lib/query/applyFilters.ts`). It cannot do:

- **OR / NOT / grouping** — "Bordeaux or Burgundy, but not 2011".
- **Field vs field** — "ask < release", "highest bid >= recoup bid".
- **Derived thresholds** — "ask <= release x 1.12", "within GBP 20/btl of
  market".
- **Named intermediate values** — define `headroom = release - ask` once, then
  filter and sort and display it.
- **Relative / temporal** — "ask fell > 5% in the last 7 days", "anchor set
  this month".
- **Ranking** — "best arbitrage" as a weighted blend, not one `ORDER BY`
  column.
- **Grain control** — one row per wine (cheapest format) vs one per format.

---

## Non-negotiables

1. **It runs on a materialised surface, not the live view stack.** The
   2026-08-20 response-time review measured a filtered scenario page at ~1.4s
   warm and an unfiltered one at 6.7s over a five-level view stack
   (`wine_scenario_view -> wine_card_format_view -> resolved_release_anchor_view
   -> release_price_anchor_view -> release_offer_evidence_view`), ~648k buffer
   blocks to return 50 rows. `catalogue_mv` (2026-08-27) fixed the catalogue
   side; the scenario path is still partly live joins. A richer engine on that
   stack is not viable on the current instance.
2. **The funnel is one query, not one per predicate.** A naive
   count-per-predicate-per-keystroke funnel is the worst possible shape for a
   free-tier instance with no headroom.
3. **The stored definition stays an untrusted JSON blob validated against the
   registry on read and write** — same contract as today
   (`parseScenarioDefinition`). No new trust in `saved_scenarios.definition`.
4. **Counts are candidate estimates, not accounting.** Exact only on the
   bounded result page, which already avoids `count: "exact"` via the
   fetch-one-extra trick (`scenarios/browser.ts`).

---

## Phase 0 — Fix the reported bug on the current engine

**Status:** done, commit pending. Shipped independently of everything below.

- **Done.** `is_biddable` (boolean) added to `SCENARIO_FILTERS` — the column
  was already on the view. The view is *not* scoped to biddable; the filter is
  the opt-in.
- **Done (copy route).** `wine_scenario_view` left unscoped; the misleading
  "biddable" copy in `ScenarioMatches.tsx` ("No format matches this scenario.")
  and `scenarios/page.tsx` ("every format" + a pointer to the Biddable filter)
  fixed instead. Scoping the view is a semantic change deferred to Phase 2's
  `wine_scenario_mv`.
- **Done (grain only).** Money range fields now read `pence / case`, and the
  explanation says the results table shows the value per 75cl in pounds. The
  live min / median / max placeholder is **deferred** — it needs a
  scenario-specific ranges view/endpoint (`facet_ranges_view` only covers
  catalogue columns, not the derived `*_vs_release_pct` metrics). Folded into
  Phase 1's unit-boundary work.
- **Done.** Per-range **"include missing"** toggle (`AppliedFilter.includeNulls`,
  parsed in `definition.ts`, translated to an `or(and(bounds…),col.is.null)`
  logic tree in `applyFilters.ts`). Default off. The "predicate matched zero
  because the column is NULL for the whole candidate set, say so" detection is
  **deferred to Phase 3** — it is the funnel.

---

## Phase 1 — Typed unit boundary

**Status:** shipped 2026-08-29 (`80f509f`). Migration
`20260829120000_scenario_per_75cl_money.sql` applied to prod before the web
deploy; CI (lint/tsc/vitest) and the database-migration replay + pgTAP both
green.

Money is stored as integer pence per case. **The owner thinks in pounds per
75cl-equivalent bottle** — that is the grain the results table shows, and the
pack size (3/6/12) is not something the owner tracks, so a per-case price has no
utility to them.

- **Migration.** `wine_scenario_view` gains four appended per-75cl columns
  (`lowest_ask_per_75cl_p`, `highest_bid_per_75cl_p`, `market_price_per_75cl_p`,
  `release_price_per_75cl_p`), computed
  `round(value_p * 750 / (case_size * bottle_volume_ml))` — the same arithmetic
  as `perBottleP` and `catalogue_mv`'s `*_per_bottle_p`. A per-bottle threshold
  cannot be applied to a per-case column without the row's format, so these have
  to be real columns for PostgREST to filter/sort on. The per-case columns stay
  for other consumers.
- **Registry.** `FilterMeta` gains `type?: "money" | "percent"` and
  `nullable?: boolean`. The two money filters and the four money sort fields
  repoint from `*_p` (per case) to `*_per_75cl_p`. `allowedOps` /
  `canonicalUnit` / `displayUnit` are **not** added yet — nothing consumes them
  until the Phase 2 expression tree.
- **Boundary.** `apps/web/src/lib/scenarios/units.ts` is the one place that
  converts: money fields are entered and shown in pounds, stored in pence. The
  stored definition stays canonical (pence), so `applyFilters` /
  `evaluateScenario` are unchanged. `ScenarioMatches` now reads the per-75cl
  columns directly instead of recomputing client-side, so the filter and the
  displayed value are provably the same number.
- **Percentage convention** (`PHASE2-catalogue-browser.md`) already holds:
  the `*_pct` columns are signed and computed in SQL, negative = cheaper. Their
  explanations now name the NULL dependency ("needs a release anchor" / "needs a
  live bid").
- **Legacy definitions.** A stored per-case bound (`lowest_ask_p`,
  `release_price_p`) cannot be converted to the per-75cl `£` field without the
  format, so `parseScenarioDefinition` drops a legacy money filter (and a legacy
  money sort falls back to the default). Single owner, ~1–2 scenarios, and the
  dropped values were the ones behind the original bug — a versioned migration
  is not worth it. The owner re-adds the filter in `£`.
- **Deferred to Phase 2:** the live min / median / max placeholder — it needs a
  scenario ranges aggregate, cheap only once `wine_scenario_mv` exists.

---

## Phase 2 — a fast foundation, then the hybrid engine

**Decisions (2026-08-29):**

1. **Split.** Ship 2a (`wine_scenario_mv`, pure perf, no behaviour change)
   first and verify it against the 2026-08-20 numbers. Then 2b (the engine) on
   the fast foundation.
2. **Hybrid builder, not a tree editor.** Keep today's flat AND-list of filter
   rows. Add exactly two capabilities: a "compare to" right-hand side on range
   rows (another field ± an amount or a percent), and OR-within-a-group for the
   enum fields. A full nested and/or/not editor, `let` bindings, `score` and
   result-grain stay deferred (Phase 4).

This section is the plan of record for both sub-phases. Pick up at 2a.

---

### Phase 2a — `wine_scenario_mv`

**Goal:** collapse the live 5-level view stack
(`wine_scenario_view → wine_card_format_view → resolved_release_anchor_view →
release_price_anchor_view → release_offer_evidence_view`; measured 1.4 s warm
filtered, 6.7 s unfiltered, ~648k buffers for 50 rows on 2026-08-20) to a
nightly refresh. **No column changes, no behaviour changes** — `SELECT * FROM
wine_scenario_view` returns byte-identical rows before and after, just faster.

**Migration** `NNNNNNNNNNNNNN_wine_scenario_mv.sql`:

- `CREATE MATERIALIZED VIEW public.wine_scenario_mv AS SELECT <the current
  wine_scenario_view body>` — the exact projection from
  `20260817150000` + the four `*_per_75cl_p` columns from
  `20260829120000`. Copy the SELECT verbatim; do not add or rename columns
  here (derived columns are a 2b concern).
- `CREATE UNIQUE INDEX wine_scenario_mv_key ON public.wine_scenario_mv
  (parent_sku, format_code)` — required for `REFRESH ... CONCURRENTLY`, and the
  pagination tiebreaker every scenario query already appends.
- **No speculative filter/sort indexes.** Follow the reasoning in
  `20260827120000` (the catalogue_mv index comment): a scan of the precomputed
  rows is cheap, the sorts need composite per-field-and-direction indexes to be
  used at all, and every index is nightly `REFRESH CONCURRENTLY` cost. Add from
  measured `EXPLAIN (ANALYZE, BUFFERS)` / `index_advisor` after 2b lands, not
  before.
- Consider `name`/`producer` trgm GIN indexes only if the hybrid builder gains
  a free-text row (it does not in the first cut) — defer.
- `CREATE OR REPLACE VIEW public.wine_scenario_view WITH (security_invoker =
  TRUE) AS SELECT <same column list> FROM public.wine_scenario_mv` — keeps the
  view name, its grants, and `evaluate.ts` / the pgTAP suite unchanged.
  `REVOKE ALL ... FROM anon; GRANT SELECT ON public.wine_scenario_mv TO
  authenticated` (match the current view's grants; the data is not
  per-user, single-owner app, no RLS on an MV needed — same pattern as
  `catalogue_view → catalogue_mv`).
- `COMMENT ON MATERIALIZED VIEW` mirroring `catalogue_mv`'s.

**Refresh wiring** (`core/store.py`):

- Append `"wine_scenario_mv"` to `CATALOGUE_CACHE_MVIEWS` **after**
  `catalogue_mv` and `wine_market_summary_mv` (it derives from
  `wine_card_format_view → catalogue_view → catalogue_mv`, and from
  `wine_card_view`). `refresh_catalogue_caches` then does
  `REFRESH ... CONCURRENTLY` + the zero-row warning for it automatically.
- No new code path — it rides the existing non-fatal, ambiguous-failure-aware
  loop.

**pgTAP** (`supabase/tests/database/saved_scenarios.test.sql`): the fixture
already calls `private.rebuild_catalogue_caches()` after its writes and
`test_pgtap_catalogue_cache_refresh.py` already lists `wine_scenario_view` as a
cached read, so the existing rebuild call covers the MV. Add one assertion:
`wine_scenario_mv` row count equals `wine_card_format_view` row count (parity is
already asserted for the view; assert it survives materialisation). Bump
`plan()`.

**Also fold in the deferred Phase 0/1 item:** a
`wine_scenario_ranges_view` — a single-row aggregate
(`min`/`percentile_cont(0.5)`/`max` per range column) over `wine_scenario_mv`,
for the builder's min/median/max input placeholders. Cheap now that it reads the
MV. Shape it like `facet_ranges_view`; fetch it like `fetchFacetRanges`.

**Verification:**

- `supabase db push --linked --dry-run` then apply **before** the web deploy
  (2a's view is drop-in, but keep the ordering habit).
- Re-run the 2026-08-20 measurements: the filtered-first-50 and the
  no-filter-first-50 scenario queries, warm, as the `authenticated` owner.
  Record them in `PERFORMANCE-REVIEW`-style. Target: both well under 300 ms.
- Diff a `SELECT *` sample (first 500 rows by the key) view-vs-MV — must be
  identical.
- Watch the first nightly sweep's log for the `Refreshed wine_scenario_mv: N
  rows` line and no zero-row warning.

**Blast radius:** `wine_scenario_view` is read only by `evaluate.ts` and the
pgTAP suite. Nothing else depends on it. Rollback is `CREATE OR REPLACE VIEW`
back to the join.

---

### Phase 2b — the hybrid expression engine

Built on `wine_scenario_mv`. Delivers field-vs-field and derived comparisons
(the reported "ask < release × 1.12" case) and OR without a tree editor.

**Definition shape.** Evolve `AppliedFilter`, do not replace it. The stored
definition stays a flat `filters: []` array; two members gain optional power:

```jsonc
{
  "filters": [
    { "kind": "boolean", "field": "is_biddable", "value": true },

    // OR within one enum group (already an array; add an explicit mode)
    { "kind": "enum", "field": "region", "value": ["Bordeaux", "Burgundy"] },

    // range vs a constant — unchanged
    { "kind": "range", "field": "bid_vs_release_pct", "min": -20, "max": 5, "includeNulls": false },

    // NEW: range vs another field, optionally scaled/offset
    { "kind": "compare", "field": "lowest_ask_per_75cl_p", "op": "lt",
      "rhs": { "field": "release_price_per_75cl_p", "mul": 1.12 } }
    //  → lowest_ask_per_75cl_p < release_price_per_75cl_p * 1.12
    //  rhs: { field, mul?: number, add_p?: number }  (add_p in canonical units)
  ],
  "sort": { "field": "ask_vs_release_pct", "dir": "asc" }
}
```

- **`kind: "compare"`** is the only genuinely new node. `op ∈ {lt, lte, gt,
  gte}`. `rhs` references one whitelisted column with an optional `mul`
  (unitless) and `add_p` (canonical units, entered in the field's display
  unit and converted by `units.ts`). `nulls` handling as per `range`
  (default: drop rows where either side is NULL; explicit "include missing"
  toggle).
- **OR groups:** enum `value` arrays are already OR internally. The only change
  is UI labelling ("any of") plus allowing two rows on the *same* enum field to
  mean OR across their union — or simpler, keep one row per field and rely on
  the multi-value input. Decide during build; no schema change either way.
- **AND across rows** stays the top-level semantics. No nesting.
- Deferred: `let`, `score`, `grain`, `not`, arbitrary `+ - * /`, `pct_change`,
  literals-with-units in free text.

**Execution — `evaluate_scenario` RPC.** A `range`/`enum`/`boolean`/`text`
scenario can still go through PostgREST + `applyFilters`. A definition
containing a `compare` node **cannot** (PostgREST has no column-vs-expression
filter), so route the whole evaluation through one RPC when any `compare` is
present — or unconditionally, for a single code path. Recommended: **one RPC,
always**, replacing `evaluate.ts`'s PostgREST call for scenarios.

```
CREATE FUNCTION public.evaluate_scenario(p_definition jsonb, p_from int, p_to int)
RETURNS SETOF public.wine_scenario_mv   -- or a narrower row type
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
```

- Validates `p_definition` against a **column + operator whitelist** built from
  the same registry contract the TS `parseScenarioDefinition` uses (keep them
  in sync — a pgTAP test asserts every `SCENARIO_FILTERS` field is whitelisted).
- Builds the `WHERE` with `format()` + `quote_literal` / `quote_ident` per
  node; never string-concatenates a raw value. `mul`/`add_p` are cast to
  numeric before interpolation.
- `SET LOCAL statement_timeout = '5s'`; hard cap on filter count (e.g. 20) and
  reject unknown keys.
- `is_app_owner()` check at the top (defence in depth; the route already
  requires the owner).
- Called from `evaluate.ts` via `supabase.rpc("evaluate_scenario", …)`, still
  wrapped in `timeProtectedQuery(route, "scenario_eval", …)`. Keep the
  fetch-one-extra pagination (`scenarioPreviewRange`) — pass `p_to = to + 1`.

**Builder UI** (`ScenarioEditor.tsx`):

- Range rows gain a small mode switch: **value** (today's min/max) vs
  **compare** (`op` select + field select + optional `× n` and `+ £/%` inputs).
  Reuse `FilterControl`; add a `CompareControl`.
- The compare field list is the registry's range fields of the same `type`
  (money compares to money, percent to percent).
- `parseScenarioDefinition` gains a `compare` branch: validate `field` and
  `rhs.field` are in the registry and range-kind, `op` in the set, coerce
  `mul`/`add_p` to finite numbers, drop the node otherwise (same
  fail-soft contract as every other kind).
- `summarise()` in `scenarios/page.tsx` renders compares
  ("Ask < Release price × 1.12").

**Legacy / migration:** additive. Every existing definition still parses and
runs. No `saved_scenarios` data change.

**pgTAP:** registry/whitelist parity; a `compare` predicate returns the rows a
hand-written `WHERE a < b * 1.12` returns; `statement_timeout` and the
filter-count cap fire; a non-owner gets `42501`.

**Verification:** the reported scenario — Biddable = Yes, `Ask (£/75cl) <
Release price (£/75cl)` — returns the wines it should, fast, and the funnel
(Phase 3) can then show why any predicate empties the set.

---

## Phase 3 — The build-as-you-go funnel

Cheap by construction:

- **One query for the whole funnel.**
  `SELECT count(*) FILTER (WHERE p1), count(*) FILTER (WHERE p1 AND p2), ...
  FROM wine_scenario_mv` — single scan, single row back, regardless of
  predicate count.
- **Approximate the headline numbers.** `reltuples` / `TABLESAMPLE` for the
  large counts; exact only on the 25-row result page.
- **Recompute on commit, not keystroke** — blur or an explicit Apply,
  debounced, with an `AbortController` cancelling the in-flight request.
- **Funnel on demand.** Default view is the 25-row preview plus a total. A
  "why so few?" control expands the per-predicate funnel. The common path
  stays one cheap query.
- **Budget:** funnel < 300ms p95 warm, measured via its routeTiming label, or
  it does not ship.

---

## Phase 4 — Scoring, grain, alerts

- `score` expression becomes a sortable, displayed column; results show the
  score so "best arbitrage" ranks rather than just filters.
- `grain: "best_format_per_wine"` collapses to the cheapest (or
  highest-scoring) format per wine via `DISTINCT ON`.
- Temporal expressions (`pct_change`, `days_since_anchor`) enabled once the MV
  carries the needed history columns.
- A saved scenario can be scheduled as an alert — "email me when a new format
  matches" — which fits the "candidate for human review" framing of the
  pipeline. Reuses the daily-sweep refresh as the trigger point.

---

## Phase 5 — Natural language to AST

The registry has always been designed as "the single contract the builder, the
validator and — later — the agent read" (`registry.ts`). Once the expression
tree is the definition format, a natural-language entry ("biddable Bordeaux
where the ask is under release plus 12%") compiles to exactly that tree and
runs through the same validated RPC. No separate execution path.

---

## Open questions

- Where does the enum-options source live? The builder currently takes raw
  comma-separated text and needs exact spelling. A `distinct values with
  counts` endpoint over `wine_scenario_mv` would fix both discovery and the
  spelling trap, but adds another aggregate query family — needs the same
  budget scrutiny as the funnel.
- Definition versioning: bump a `version` field and convert on read, or
  one-off migrate the handful of existing `saved_scenarios` rows in Phase 1.
- Whether `wine_scenario_mv` is a genuinely new MV or a thin flattening view
  over `catalogue_mv` plus a materialised anchor table — depends on how much
  of the anchor stack can be precomputed without a second refresh hook.
