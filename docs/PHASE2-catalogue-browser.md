# Phase 2 revision — Catalogue browser with bargain discovery as one mode

**Status:** planned, not started. Implementation target: Sonnet.
**Scope guardrails (do NOT add in this revision):** authentication, a custom
backend, wine detail pages, charts, live GraphQL pricing. Keep direct Supabase
browser reads through curated, locked-down views.

## Where we are now

- `apps/web` is a Next.js 16 (App Router, TS, Tailwind) app with a single
  client `src/app/page.tsx` — a flat candidates table reading `candidate_view`
  via the anon key. `src/lib/format.ts` renders `pct` as `toFixed(1)%`.
- No test runner is configured (`package.json` has dev/build/start/lint only).
- Read layer live on the BBX Bargains Supabase project: `candidate_view`,
  `product_detail_view`, `price_history_view`, `scan_health_view`. Base tables
  are `REVOKE`d from anon/authenticated; views are `GRANT SELECT` only.
- `supabase db push` is broken on this CLI/profile
  (`failed to read profile: Unsupported Config Type ""`). Apply SQL with
  `supabase db query --profile bbx --linked --file <path>`; regenerate types
  with `supabase gen types --profile bbx --linked`.

## Core reframing

The default product is **"Explore BBX"** — an interface for querying the active
BBX catalogue. Bargains/arbitrage are **user-defined views** over the same
catalogue data, never a fixed classification stamped on every SKU.

`candidate_view` stops being the app's source. It is wrong for a catalogue on
two counts: it **filters out** SKUs lacking a market price, and its `pct_market`
sign is inverted from the required display convention. Introduce a broad
`catalogue_view`; the four entry points ("Explore catalogue", "Value research",
"Recent listings", "Price changes") are **preset QueryStates** over it — starting
points a user can freely adjust, sort and save, not rigid policies. Never impose
a single discount threshold or call a row an arbitrage opportunity.

## Percentage convention (decide once, apply everywhere)

If market is £100 and offer is £80:
- **"Price vs market" in tables must display `-20.0%`** (negative = cheaper).
- "Discount to market" phrasing may separately display `20.0% below`.
- Do NOT show a positive number next to a "vs" label.
- Apply the same semantics to price vs last transaction and price vs next offer.
  Keep **"next offer" visibly labelled as a stored estimate**.

Because these drive server-side sort and range filters, compute the **signed**
percentages as columns in SQL (see Phase A), not just at display time.

---

## Phase A — SQL read model

New migration `supabase/migrations/<timestamp>_catalogue_read_model.sql`.
Match existing column names/types exactly; reuse the migration-002 lockdown
pattern (`REVOKE ALL … FROM PUBLIC, anon, authenticated` then targeted
`GRANT SELECT` / `GRANT EXECUTE`).

1. **`catalogue_view`** — `skus ⋈ products`, `WHERE gone_since IS NULL` (active),
   **no market-price filter** (unlike candidate_view). Columns:
   - ids: parent_sku, format_code
   - wine: name, vintage, country, region, subregion, colour, producer,
     product_url
   - format: case_size, bottle_volume_ml
   - prices (pence): `ask` = least_listing_price_p, market_price_p,
     last_transaction_p, highest_bid_p, next_lowest_price_p, qty_available,
     source_agreement
   - freshness: first_seen_at, last_seen_at
   - `signal_type` = `'stored_estimate'`
   - **signed metrics (NULL when denominator missing or ≤ 0):**
     - `price_vs_market_pct = round((ask - market_price_p)::numeric / market_price_p * 100, 1)`
     - `price_vs_last_pct   = round((ask - last_transaction_p)::numeric / last_transaction_p * 100, 1)`
     - `price_vs_next_pct   = round((ask - next_lowest_price_p)::numeric / next_lowest_price_p * 100, 1)`
   - Reuse candidate_view's `LATERAL` next-offer computation over `offers`
     (`match_confidence = 'inferred'`, active), backed by the existing
     `idx_offers_parent_sku_format`.
2. **`facet_values_view`** — long format, one view for the generic enum facets:
   `UNION ALL` of `SELECT 'region' AS facet, region AS value, count(*) AS n
   FROM catalogue_view GROUP BY region` for region, subregion, country, colour
   and vintage. Global counts. Powers dropdowns without loading products into
   the browser. Add a separate `format_options_view` with `format_code`,
   `case_size`, `bottle_volume_ml` and count, so multi-select Format uses exact
   stored codes rather than combining independent measurements.
3. **`facet_ranges_view`** — single row: min/max for vintage, ask, case_size,
   bottle_volume_ml, first_seen_at, last_seen_at.
4. **`search_producers(q text)` RPC** — trigram-backed (existing
   `idx_products_producer_trgm`), returns producer + count. Producer is
   high-cardinality → async typeahead, never a preloaded list.
   `REVOKE EXECUTE … FROM PUBLIC`, `GRANT EXECUTE … TO anon, authenticated`.
5. **`recent_price_change_view`** — latest `price_changed` event per SKU (from
   `price_history_view`) joined to catalogue fields, exposing old/new/observed_at.
   Backs Price-changes mode.
6. Apply the migration; verify the new views/RPC are SELECT/EXECUTE-only for
   anon/authenticated; **regenerate `apps/web/src/lib/database.types.ts`**.
7. Leave `candidate_view` untouched (back-compat + the retained GraphQL-candidate
   distinction). The app simply stops reading it.

**Deferred, not v1:** cross-filtered facet counts (counts that reflect other
active filters). Ship global counts first; note the gap in code.

## Phase B — Typed query state (the spine; also the future agent hook)

- `src/lib/query/types.ts` — `QueryState { mode, filters: Filter[],
  sort: { field, dir }, page }`, fully typed and URL-serialisable.
- `src/lib/query/registry.ts` — machine-readable metadata:
  `FILTERS: Record<field, { label, field, group: 'Wine'|'Format'|'Price'|
  'Freshness', kind: 'enum'|'range'|'text'|'date'|'bool', units?, min?, max?,
  estimate: boolean, explanation }>` plus a parallel `METRICS` registry for
  display columns. This drives the UI *and* lets a later chatbot propose/explain
  the same filters. Every filter and metric carries label, field, units, allowed
  range, estimate/live status and an explanation string.
- `src/lib/query/url.ts` — `serialize(QueryState) → URLSearchParams` and
  `parse(params) → QueryState`, a stable codec (round-trip tested).
- `src/lib/query/startingPoints.ts` — each entry point sets only the filters/sort
  expressing its intent:
  - **Explore catalogue** — no price constraints.
  - **Value research** — exposes price_vs_market / price_vs_last /
    price_vs_next controls; **no hard-coded discount threshold**.
  - **Recent listings** — sort first_seen_at desc (optionally a "seen within N
    days" filter).
  - **Price changes** — mode reading `recent_price_change_view`.

## Phase C — Data fetching

- Read `catalogue_view` with `.range()` pagination and server-side `.order()`
  from sort state. Build filter clauses from `QueryState`: `gte`/`lte` for ranges
  (including the signed pct columns), `eq`/`in` for enums,
  `.or(name.ilike.%q%,producer.ilike.%q%)` for text.
- Generic facets from `facet_values_view`, exact Format choices from
  `format_options_view`, numeric bounds from `facet_ranges_view`; producer via
  `search_producers`.
- **Debounce** text search. Range inputs commit on change/blur — **no request
  per keystroke**.

## Phase D — UI / UX redesign

Current UI is too flat and grey. Target: clean, modern, data-focused.

- Design tokens in `globals.css`: white background, dark ink text, one restrained
  **burgundy** accent (CSS var) for brand and signal; `tabular-nums` for figures.
- Layout: compact **sticky product header** + **sticky filter strip** on desktop
  (filters grouped **Wine / Format / Price / Freshness**); **sticky `<thead>`**
  while rows scroll; **numeric columns right-aligned**; prices and signed metrics
  carry stronger visual weight than metadata; row hover state and clear
  `focus-visible` keyboard focus; restrained colour only to support
  interpretation — signed metrics always show the sign (optionally ▲▼) so meaning
  never rests on colour alone. Keep density suitable for research. Mobile may use
  horizontal table scroll but must stay usable.
- **Applied-filter summary**: removable chips + a **Reset** action.
- **Data-honesty header** from `scan_health_view` (latest completed run): latest
  successful scan time, pricing coverage (rest_skus_priced / rest_skus_expected),
  discovery completeness (algolia_complete), and a short line that prices and
  next-offer values are scan-time estimates.
- Mode language: catalogue mode says **"results"**; value-research mode uses
  **"priced below reference"** / **"value signals"** — never "guaranteed bargain"
  or "arbitrage".

## Phase E — Saved queries (browser-local, portable)

- `src/lib/savedQueries.ts` — `SavedQuery { id, name, createdAt, updatedAt,
  version, query: QueryState }` persisted in localStorage; list / load / rename /
  delete; compact menu in the UI.
- The saved object is **independent of UI component state** and shaped so it can
  later move to a Supabase per-user table **without format changes** (portable —
  a future agent can create/amend/explain them there).
- UI must describe these as **this-browser-only**; do not present them as
  available on other devices.

## Phase F — Tests + README

- Add **Vitest** (`test` script + config).
- Tests:
  1. URL serialize ↔ parse round-trip over representative QueryStates.
  2. Percentage direction: `-20.0%` for ask 80 / market 100; consistent for last
     and next.
  3. Starting-point defaults: each entry point yields the expected filters/sort;
     assert Value-research imposes **no** fixed discount and exposes multiple
     price-reference controls.
  4. Saved-query local behaviour: save / load / rename / delete against a
     localStorage mock; stable, portable object shape.
- Replace the default Next.js template `apps/web/README.md`: what the app is,
  required env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`),
  local development, and the data-honesty constraints.

## Phase G — Manual QA before "done"

- A shared custom-query URL loads identically in a fresh browser session.
- The value-research entry point exposes multiple price-reference controls with
  no hard-coded bargain rule.
- "£80 ask / £100 market" shows `-20.0%` price vs market.
- Table column headings stay visible while scrolling a long result set.
- Reload, Back and Forward preserve the current query.
- Local saved queries survive refresh and are described accurately as
  browser-local.

## Standing constraints

- No auth / backend / detail pages / charts / GraphQL in this revision.
- Preserve direct Supabase browser reads and the existing view lockdown.
- Server-side sort and pagination.
- Retain the Next.js + TypeScript stack.
- Keep full query state a typed, URL-serialisable object and give every filter/
  metric machine-readable metadata — this is the deliberate seam for a future
  chatbot interface to read, propose and explain the same filters the UI uses.
