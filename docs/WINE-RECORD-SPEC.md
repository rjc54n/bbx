# Canonical wine record — `wine_ref` + owner facts

Status: draft for review. No code yet. This spec turns the implicit "one wine,
known-or-not" idea that already runs through favourites into an explicit,
buildable model, and shows how four requested features hang off it:

1. Search the CellarTracker tab.
2. Catalogue rows click into a consolidated wine card, not out to BBR.
3. Add a release price to a biddable wine when an import missed it.
4. A saved-scenario filters tab (e.g. "biddable wines priced < 10% over
   release"), later consumable by an agent with Supabase access.

## 1. What already exists (build on, don't reinvent)

- **Identity anchor** — `parent_sku` (BBR Parent ID, `private.products` PK) is
  the only wine-level entity. `catalogue_view` keys on `(parent_sku,
  format_code)`.
- **Source-agnostic identity** — `apps/web/src/lib/wine/coreKey.ts` normalises
  "vintage / name / producer / geography" into tokens; both importers match on
  it. It is a *derived* string, good for candidates, unsafe as a stored key.
- **Release price is already first-class** — `release_price_anchor_view` →
  `release_price_market_view` expose a per-format anchor (`release_price_p`,
  `anchor_status ∈ {confirmed, provisional}`, `ask_vs_release_pct`,
  `bid_vs_release_pct`, seller-net, recoup bid). This is exactly the metric the
  filters tab needs.
- **Owner-override precedent** — `cellartracker_record_decisions` already stores
  an owner-corrected price *and the source value it replaced*, with
  `decided_at` / `decided_by`, RLS-gated to the owner via
  `private.is_app_owner()`. The facts model below generalises this table's
  shape; it does not compete with it.
- **The wine card already exists in prototype** — `/favourites/[parentSku]`
  consolidates catalogue formats + release anchors + release history +
  CellarTracker records + BBR holdings + a fallback. It is the card; it just
  isn't reachable everywhere and has no write path.
- **Promotion pattern** — favourites move a star from `pending_favourites`
  (keyed by `match_group_key`) to `wine_favourites` (keyed by `parent_sku`)
  when a link lands. The identity model below makes this the *only* place
  promotion has to be solved.

## 2. Identity: `wine_ref`

A single opaque-ish reference string names any wine, biddable or not:

```
wine_ref := 'parent:' || parent_sku      -- a wine in the BBR biddable catalogue
          | 'local:'  || wine_local_id   -- a wine only ever seen off-catalogue
```

- **Biddable wines mint nothing.** Their `wine_ref` is derived from the
  `parent_sku` they already have. ~90% of value (arbitrage lives on biddable
  wines) needs no new rows.
- **Off-catalogue wines mint a surrogate only when they need durable owner
  data** (a favourite, an owner fact, a note). Until then they stay candidates
  keyed by core key, exactly as today. This is the "lazy alias" model: pay for
  identity only where the parent-anchor is genuinely absent.

### `wine_locals` (new, durable)

```
wine_locals (
  wine_local_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  core_key        TEXT NOT NULL,          -- coreKey() at mint time, for re-matching
  display_name    TEXT NOT NULL,          -- best-known name for the card header
  vintage         INT,
  producer        TEXT,
  parent_sku      TEXT REFERENCES private.products(parent_sku),  -- set on promotion
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),
  merged_into     UUID REFERENCES wine_locals(wine_local_id)      -- reserved, see §9
)
```

### Resolver (the one indirection)

```
resolve_wine_ref(raw wine_ref) RETURNS wine_ref
```

- `parent:{sku}` → itself.
- `local:{id}` → if that local row has a `parent_sku`, return `parent:{sku}`;
  else return itself.

**Promotion becomes an alias, not a migration.** When an off-catalogue wine
becomes biddable, set `wine_locals.parent_sku`. Every fact/favourite/URL still
stored against `local:{id}` now *resolves* to `parent:{sku}` with no row
rewrites. This is favourites' pending→linked promotion, solved once, in one
function, for every attached entity.

> Rule: durable data always stores a `wine_ref` and reads through
> `resolve_wine_ref`. Never store a raw core key as a durable key — core keys
> are for candidate matching only.

## 3. Owner facts

Owner assertions are **typed override tables**, one per fact domain, mirroring
`cellartracker_record_decisions` (typed columns + checks + provenance) rather
than a generic key/value bag. Rationale: the existing codebase is strongly
typed, prices are format-scoped and need `tax_basis`, and typed constraints
catch bad data at write time.

### First table — owner release anchors (unblocks feature 3)

```
owner_release_anchors (
  wine_ref            TEXT NOT NULL,                 -- canonical (post-resolve)
  format_code         TEXT NOT NULL,
  release_price_p     INT  NOT NULL CHECK (release_price_p > 0),  -- per case, GBP pence
  tax_basis           TEXT NOT NULL DEFAULT 'in_bond'
                        CHECK (tax_basis IN ('in_bond','duty_paid','unknown')),
  offer_date          DATE,                          -- when the release was offered, if known
  source_note         TEXT,                          -- "found in 2021 BBR email", etc.
  superseded_source_price_p INT,                     -- imported value this overrides, if any
  decided_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by          UUID REFERENCES auth.users(id),
  PRIMARY KEY (wine_ref, format_code)
)
```

- RLS owner-only (`private.is_app_owner()`), same grants as
  `cellartracker_record_decisions`.
- `superseded_source_price_p` carries the imported number the owner replaced
  (may be NULL when the import missed it entirely). This is the same
  "source-value retention" idea already in `cellartracker_record_decisions`: it
  lets a later import distinguish *"the feed now agrees with my number"* from
  *"the feed changed"* — only the first is safe to fold away.

Additional domains later reuse this shape (e.g. `owner_wine_attributes` for a
corrected name/producer/vintage). Each is a small, constrained table; none is
required before its feature.

### Precedence (confirmed: manual override is primary)

Every derived field resolves by an ordered rule, and the resolved value carries
its **source label** so the card can show provenance:

```
owner override  >  imported (exact/confirmed)  >  imported (inferred/provisional)  >  none
```

- **Imports never touch owner tables.** Importers write only source tables;
  owner facts win at read time. This makes "manual is primary" true by
  construction and survives every re-import.
- For the release anchor specifically, extend `release_price_anchor_view` (or a
  thin wrapper `resolved_release_anchor_view`) to `UNION`/coalesce owner anchors
  above imported ones, and add `anchor_status = 'owner'` as the top rank. Every
  downstream metric in `release_price_market_view` (ask_vs_release_pct, recoup
  bid, …) then reflects the owner price with zero further change — which is why
  feature 3 also lights up the filters and the wine card at once.

## 4. Canonical read model (virtual)

Two views, both keyed by `wine_ref`, both `security_invoker`:

- **`wine_card_view`** — one row per wine: identity + wine-level attributes,
  resolved from `private.products` (biddable) or `wine_locals` + best source
  record (off-catalogue), owner attributes applied by precedence. Includes
  `wine_ref`, `is_biddable`, `parent_sku` (nullable), display name/vintage/
  producer/geography/colour, and a `bbr_product_url` (resolved via the existing
  `bbrProductUrl` origin rule) as *one action*, no longer the primary click.
- **`wine_card_format_view`** — one row per `(wine_ref, format_code)`: the
  per-format arbitrage line, essentially `release_price_market_view` re-keyed to
  `wine_ref` and reading the *resolved* anchor (owner ahead of imported).

The read model stays virtual (always fresh). Only identity minting and owner
facts are durable — the hybrid you asked about, made concrete.

## 5. Feature mapping

| Feature | Needs | New durable objects |
|---|---|---|
| 1. CellarTracker search | server-side search (reuse release-prices' paginate/estimate/clamp shape), rows link to `/wine/{ref}` | none |
| 2. Catalogue → wine card | `/wine/[ref]` route (generalise `/favourites/[parentSku]`), catalogue row links in instead of out; BBR becomes a card action | none (view + route only) |
| 3. Add a release price | `owner_release_anchors` + resolved-anchor view + a write action | `owner_release_anchors` |
| 4. Saved scenarios / agent | `saved_scenarios` + evaluate over `wine_card_format_view` | `saved_scenarios` |

### Routes

- `/wine/parent/{parent_sku}` and `/wine/local/{wine_local_id}` — explicit,
  keeps URLs clean and avoids encoding a `:` in the path. A redirect resolves a
  promoted `local` to its `parent` URL. `/favourites/[parentSku]` becomes a thin
  redirect into `/wine/parent/{sku}` so nothing breaks.

### Saved scenarios (feature 4)

```
saved_scenarios (
  id UUID PK, user_id UUID, name TEXT,
  definition JSONB,          -- reuse the typed QueryState + filter registry shape
  created_at, updated_at
)
```

- A scenario is *data*, evaluated server-side against `wine_card_format_view`.
  "Biddable wines priced < 10% over release" is `is_biddable AND
  ask_vs_release_pct < 10`, which already exists as a column.
- **The agent is not a separate build.** An agent with Supabase access consumes
  the *same* `saved_scenarios.definition` and the *same* `wine_card_format_view`.
  Build the human path first; the agent inherits the metrics and the saved
  definitions for free.

## 6. Sequencing

1. `wine_card_view` / `wine_card_format_view` + `/wine/[ref]` route; wire
   catalogue and CellarTracker rows into it (features 1 & 2). No new tables.
2. CellarTracker server-side search (feature 1 polish).
3. `owner_release_anchors` + resolved-anchor view + write action (feature 3) —
   the first real owner-fact domain and the precedence machinery.
4. `wine_locals` + resolver, introduced the first time off-catalogue owner data
   is needed (favourite/fact on a non-biddable wine).
5. `saved_scenarios` over the metrics view; agent access last.

Note that steps 1–3 need only the `parent:` half of `wine_ref` — off-catalogue
identity (`wine_locals`) can wait until step 4, because every requested feature
except general off-catalogue curation operates on biddable wines.

## 7. Reversibility to a full `wine_id`

Starting here does not burn the bridge to a source-neutral surrogate:

- Backfill: each distinct `parent:{sku}` → one `wine_id`; each `local:{id}` →
  one `wine_id`; `wine_ref` becomes a thin alias table `(wine_ref → wine_id)`.
- Because all durable data already reads through `resolve_wine_ref`, the swap is
  a resolver change + backfill, not a rewrite of every consumer.

Going full `wine_id` first and regretting it is not reversible in the same way —
hence the recommendation to start lazy.

## 8. Non-goals / deferred

- **Merge / split** of two canonical wines into one (or vice versa). The
  `wine_locals.merged_into` column is reserved for it, but the UI, the
  fact-reattachment rules, and the "are these the same wine?" workflow are out
  of scope until off-catalogue curation actually demands them.
- A generic EAV fact store. Preferred only if typed override tables proliferate
  beyond what's comfortable.

## 9. Decisions (locked 2026-08-16)

1. **Typed override tables**, one per fact domain, mirroring
   `cellartracker_record_decisions`. A generic EAV store is rejected.
2. **Route scheme** `/wine/parent/{sku}` + `/wine/local/{id}` (explicit, no
   `:` in the path; a promoted `local` redirects to its `parent` URL).
3. **Owner release price via a dedicated `owner_release_anchors` table** —
   clean provenance, no synthetic import through the release pipeline.
4. **Precedence** `owner override > imported-exact/confirmed >
   imported-inferred/provisional > none`, resolved value carries its source
   label; imports never write owner tables.

## 10. Step 1 — implementation plan

Scope: the canonical card at `/wine/parent/[parentSku]`, backed by two new
views, reachable from the catalogue and linked CellarTracker rows.
**Biddable-only** — the `parent:` half of `wine_ref`. No new tables. Explicitly
out of scope: `wine_locals`/`local:` refs (step 4), `owner_release_anchors`
(step 3), CellarTracker *search* (step 2), saved scenarios (step 5).

### A. Database — one migration + one pgTAP test

1. **`wine_card_view`** (`security_invoker`), one row per biddable wine:
   `'parent:' || p.parent_sku AS wine_ref`, `parent_sku`, identity fields from
   `private.products` (name, vintage, producer, country, region, subregion,
   colour, product_url), and `is_biddable := EXISTS(live sku)`. Grants/RLS
   mirror `catalogue_view`.
2. **`wine_card_format_view`** (`security_invoker`), one row per
   `(wine_ref, format_code)`, **catalogue-driven** so every live format shows
   even with no release anchor:
   `catalogue_view c LEFT JOIN release_price_anchor_view a` on
   `(parent_sku, format_code)`. Columns: format, `lowest_ask_p`,
   `highest_bid_p`, `market_price_p`, `price_vs_market_pct`, `release_price_p`,
   `anchor_status`, `offer_date`, and the `ask_vs_release_*` / `bid_vs_release_*`
   metrics computed exactly as `release_price_market_view` does.
   **Seam for step 3:** the anchor join target becomes a
   `resolved_release_anchor_view` (owner ahead of imported) — one line changes,
   metrics unchanged.
3. **pgTAP test** `wine_card.test.sql`: one `wine_card_view` row per product with
   the right `wine_ref`; `wine_card_format_view` returns all live formats and its
   `ask_vs_release_pct` equals `release_price_market_view` wherever an anchor
   exists. (Runs when Docker is available; plus a read-only remote spot-check on
   one `parent_sku`, as done for the facet rewrite.)
4. **Regenerate `apps/web/src/lib/database.types.ts`** so the two views are typed
   for `rows.ts`.

### B. App — the card route

5. **New** `app/(protected)/wine/parent/[parentSku]/page.tsx` — port the current
   favourites detail page, but take the identity header from `wine_card_view`
   (single row) and the per-format table from `wine_card_format_view`. Keep the
   source-record sections unchanged (they already key by `parent_sku`): release
   history (`release_offer_evidence_view`), CellarTracker
   (`current_cellartracker_records`), BBR holdings (`current_bbr_holdings`),
   suggestion fallback, and the wine `FavouriteStar`. BBR link stays as one
   action via `bbrProductUrl`. Same `notFound()` "known?" guard as today.
6. **`app/(protected)/favourites/[parentSku]/page.tsx` → `redirect()`** to
   `/wine/parent/{parentSku}` (preserve deep links); update `FavouritesBrowser`
   links to the new route.

### C. App — wire entry points (feature 2)

7. **Catalogue `WineCell`** (`components/catalogue/columns.tsx`): the wine name
   becomes an internal `Link` to `/wine/parent/{parent_sku}` when `parent_sku`
   is present; BBR demotes to a secondary `BBR ↗` action beside Wine-Searcher.
   Pass `parent_sku` into `WineCell`. (Price-change rows only if they carry a
   `parent_sku`.)
8. **CellarTracker table**: linked rows (`parent_sku` present) link into
   `/wine/parent/{parent_sku}`. Unlinked rows are unchanged until `wine_locals`
   (step 4).

### D. Verification

`tsc` + `vitest`; pgTAP + remote spot-check per A.3; route compiles with no
server errors (owner login can't be automated, so the data path is confirmed by
the view tests rather than the browser).

### Small sub-decisions (defaults chosen unless you object)

- Card format table shows what the favourites card shows today (ask / bid /
  market / release + vs-release %); `seller_net`/`recoup_bid` deferred.
- Keep favourites detail as a redirect (not deleted).
- Don't extract a shared `WineCard` component yet — one caller.
