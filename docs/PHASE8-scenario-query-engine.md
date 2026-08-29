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

Money is stored as integer pence per case. The **contract and display unit is
pounds.** Conversion happens in exactly one typed place.

- Extend each `SCENARIO_FILTERS` entry with `type`
  (`money | percent | integer | enum | boolean | text | date`), `canonicalUnit`
  (`pence_per_case`), `displayUnit` (`gbp_per_case` or `gbp_per_75cl`),
  `nullable`, and `allowedOps`.
- The builder renders and parses inputs in `displayUnit`; a shared converter
  (extending `format.ts` / `perBottleP`) maps to `canonicalUnit` before the
  definition is serialised, and back when it is loaded for editing.
- Apply the same discipline the percentage convention already states
  (`PHASE2-catalogue-browser.md`, "Percentage convention"): signed, computed
  in SQL, negative = cheaper.
- Migration note for stored definitions: existing `saved_scenarios.definition`
  rows hold raw pence in `min`/`max` for money ranges. Add a one-off
  normalisation, or version the definition shape and convert on read.

---

## Phase 2 — `wine_scenario_mv` and the expression tree

### 2a. Materialised scenario surface

`wine_scenario_mv`: one flat row per `(parent_sku, format_code)`, every
filterable and every derived column precomputed. Modelled on `catalogue_mv`:

- unique index on `(parent_sku, format_code)` for `REFRESH ... CONCURRENTLY`;
- btree indexes on the common filter/sort columns;
- refreshed by `core/store.py` after the daily sweep, in dependency order
  after `catalogue_mv` — the sweep is the only writer to the base tables, so
  the MV is never staler than the data.

Derived columns to precompute (so the engine never computes them per query):
`ask_per_75cl_p`, `release_per_75cl_p`, `headroom_p`, `headroom_pct`,
`ask_vs_release_pct`, `bid_vs_release_pct`, `price_vs_market_pct`,
`price_vs_last_pct`, `days_since_anchor`.

### 2b. Definition shape

```jsonc
{
  "let": {
    "headroom_pct": { "expr": "100 * (release_price_p - lowest_ask_p) / release_price_p" }
  },
  "where": {
    "all": [
      { "field": "is_biddable", "eq": true },
      { "any": [ { "field": "region", "in": ["Bordeaux", "Burgundy"] } ] },
      { "lhs": "lowest_ask_p", "op": "<", "rhs": { "expr": "release_price_p * 1.12" } },
      { "field": "highest_bid_p", "op": ">=", "rhs": 0, "nulls": "exclude" }
    ]
  },
  "score": { "expr": "0.7 * headroom_pct + 0.3 * bid_vs_release_pct" },
  "grain": "best_format_per_wine",
  "sort": [ { "by": "score", "dir": "desc" } ]
}
```

- **Group nodes:** `all` / `any` / `not`, nestable.
- **Leaf predicate:** `{ lhs, op, rhs, nulls }` where `lhs` and `rhs` are
  expressions; `field`/`in`/`eq` stay as sugar for the common case.
- **Expressions** are a small whitelisted grammar: column refs, numeric
  literals with units (`GBP 250/case`, `GBP 30/btl`, `12%`), `+ - * /`,
  `abs()`, `coalesce()`, `pct_change(field, '7d')`, `least()` / `greatest()`.
  No arbitrary SQL, no subqueries.
- **`nulls`** is required on every predicate over a nullable operand:
  `exclude` (today's silent behaviour, now explicit) | `include` |
  `treat_as(0)`.
- **`let`** binds a named expression usable in `where`, `score` and `sort`.

### 2c. Execution

One `SECURITY DEFINER` RPC over `wine_scenario_mv` that takes the validated
JSON tree and builds a single parametrised statement. PostgREST `.or()`
string-building does not scale to nested groups and is an injection surface;
the RPC replaces `applyFilters` for scenarios (the catalogue browser keeps
`applyFilters` unchanged).

Guardrails inside the RPC:

- column and function whitelist, sourced from the extended registry;
- `SET LOCAL statement_timeout`;
- hard cap on predicate count and expression depth;
- its own `timeProtectedQuery` label so a regression shows up in routeTiming.

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
