# Canonical wine record — `wine_ref` + owner facts

Status: partly implemented. CellarTracker search, the Parent-SKU wine card,
owner release anchors and saved scenarios are implemented on `main`. The
source-neutral `wine_locals` identity and `/wine/local/{id}` route remain
deferred. The BBR-only ownership route amendment was implemented through the
BBR holdings-history work on 5 September 2026. This spec records how the four
requested features hang off the model:

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

## 8a. Amendment, 5 September 2026 — the route reaches a wine only BBR knows

The `notFound()` "known?" guard at
`app/(protected)/wine/parent/[parentSku]/page.tsx` already renders whenever any
source has something to say, BBR holdings included. Until now that could not
happen for a wine absent from the catalogue: `bbr_holding_evidence` was
foreign-keyed to `private.skus`, so an unresolvable Parent ID never became a
holding in the first place.

The BBR holdings history work removes that foreign key
([`BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md`](BBR-HOLDINGS-HISTORY-IMPLEMENTATION-PLAN.md),
D3), because BBR is the ownership authority and a wine the owner demonstrably
held should have a record whether or not the local catalogue has ever seen it.
**The route contract is deliberately widened to match**: `/wine/parent/{sku}`
now resolves for a Parent ID that exists only in BBR ownership evidence.

Such a page takes its name from the holding's `description`, shows the holding
and its purchase price, and shows no catalogue formats, no market figures and
no release history — every one of those is already null-guarded, so nothing
throws and nothing 404s. `bbr_cellar_market_view` left-joins the catalogue, so
the market columns arrive null rather than dropping the row.

Covered in `bbr_cellar_import.test.sql` at the level the route depends on: an
unresolved holding reaches `bbr_cellar_market_view` with its BBR identity and
with `catalogue_name`, `lowest_ask_p`, `highest_bid_p` and `market_price_p` all
null.

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

## 11. Step 3 — implementation plan

Scope: **feature 3** — add or override a release price on a biddable wine when
the import missed it (or got it wrong). This is the first *owner-fact write* and
the first precedence machinery. **Biddable-only** (`parent:` half of `wine_ref`);
`wine_locals`/`local:` stay in step 4. Builds directly on the seam the step-1
card view already left.

### What exists to build on

- `release_price_anchor_view (parent_sku, format_code, anchor_status,
  release_offer_price_id, offer_date, release_price_p, source_wine,
  source_product_url)` — resolves imported evidence into a per-format anchor,
  `anchor_status ∈ {provisional, confirmed}` (confirmed via
  `release_price_anchor_overrides`). **Leave this untouched** — it stays the pure
  *imported* resolution that the confirm/reset UI drives.
- `release_price_market_view` and `wine_card_format_view` both read the anchor
  and derive every arbitrage metric from `release_price_p`. These are the two
  consumers that must move to the resolved anchor.
- `cellartracker_record_decisions` is the provenance/precedence template
  (typed columns, `is_app_owner()` RLS, retained superseded source value,
  `decided_at`/`decided_by`, carry-forward across re-import).

### Constraint that shapes the write surface

`/release-prices/[parentSku]/[formatCode]` reads `release_price_market_view` and
does `if (!anchor) notFound()`. When the import **missed** the price there is no
market-view row, so that page 404s — it cannot host "add the missing price"
unchanged. The write surface must be reachable with **zero imported evidence**.

### A. Database — one migration + one pgTAP test

1. **`owner_release_anchors`** (new, durable), per §3:
   `PRIMARY KEY (wine_ref, format_code)`, `release_price_p INT CHECK (> 0)` (per
   case, pence), `tax_basis` default `in_bond`, `offer_date`, `source_note`,
   `superseded_source_price_p`, `decided_at`/`decided_by`. RLS owner-only via
   `private.is_app_owner()`; grants mirror `cellartracker_record_decisions`
   (SELECT to `authenticated`, writes only through the functions below). For
   step 3 `wine_ref` is always `'parent:' || parent_sku`; a
   `CHECK (wine_ref LIKE 'parent:%')` documents that until step 4 relaxes it.
2. **`resolved_release_anchor_view`** (new, `security_invoker`) — the wrapper the
   step-1 seam anticipated. Same column shape as `release_price_anchor_view`,
   with `release_offer_price_id` now **nullable** and `anchor_status` gaining
   `'owner'` as the top rank:
   ```
   -- owner anchors win (any format, even one with no imported evidence)
   SELECT split_part(wine_ref,':',2) AS parent_sku, format_code, 'owner' AS anchor_status,
          NULL::BIGINT AS release_offer_price_id, offer_date, release_price_p,
          NULL AS source_wine, NULL AS source_product_url
   FROM public.owner_release_anchors WHERE wine_ref LIKE 'parent:%'
   UNION ALL
   -- imported anchors only where the owner has NOT set one
   SELECT a.* FROM public.release_price_anchor_view a
   WHERE NOT EXISTS (SELECT 1 FROM public.owner_release_anchors o
                     WHERE o.wine_ref = 'parent:'||a.parent_sku AND o.format_code = a.format_code)
   ```
   Recommended as a **wrapper**, not an edit to `release_price_anchor_view`, so
   the imported confirm/reset path stays pure and only the two metric consumers
   change.
3. **Repoint the two consumers** (the seam):
   - `release_price_market_view`: `FROM release_price_anchor_view` →
     `FROM resolved_release_anchor_view`. Nothing else changes; `recoup_bid`,
     `seller_net`, `ask_vs_release_*` all recompute off the owner price. Because
     `fetchCatalogue.ts` and the favourites surfaces read this view, the
     catalogue arbitrage columns and favourites inherit the owner price for
     free.
   - `wine_card_format_view`: `LEFT JOIN release_price_anchor_view a` →
     `LEFT JOIN resolved_release_anchor_view a`. One line; the card's Market-now
     metrics recompute.
4. **Write functions** (`SECURITY DEFINER`, `is_app_owner()` gate,
   `search_path=''`), mirroring the CellarTracker price action:
   - `set_owner_release_anchor(p_parent_sku, p_format_code, p_release_price_p,
     p_tax_basis, p_offer_date, p_source_note)` — validates the format exists in
     `public.skus (parent_sku, format_code)`; snapshots
     `superseded_source_price_p` from the current
     `release_price_anchor_view.release_price_p` (NULL if the import missed it);
     upserts on `(wine_ref, format_code)`; returns JSON.
   - `clear_owner_release_anchor(p_parent_sku, p_format_code)` — deletes the
     owner row, reverting to the imported anchor.
   Grants: `EXECUTE` to `authenticated` (the function body enforces owner).
5. **pgTAP** `owner_release_anchors.test.sql`: owner anchor outranks a confirmed
   imported anchor; an owner anchor appears for a format with **no** imported
   evidence; `clear` reverts to the imported value; `resolved` metrics equal a
   hand-computed `ask_vs_release_pct`. Plus a read-only remote spot-check that
   `resolved_release_anchor_view` equals `release_price_anchor_view` on all
   formats where no owner row exists (i.e. the change is inert until used).
6. **Regenerate `database.types.ts`.**

### B. App — write surface + provenance

7. **Generalise `/release-prices/[parentSku]/[formatCode]`** to load from
   `catalogue_view` + `resolved_release_anchor_view` (so it renders with zero
   imported evidence instead of 404ing), and host an **owner-anchor form**
   beside the existing imported confirm/reset: set price + optional `tax_basis`,
   `offer_date`, `source_note`; a **Clear** action when an owner anchor is set.
   Header shows `anchor_status` including `owner`, and, when overriding, the
   imported value it superseded.
8. **Wine card `Market now`** (`/wine/parent`): stays read-only, but each format
   row gets a small entry point — **"Set release price →"** when
   `release_price_p` is NULL, **"Owner-set ✎"** when `anchor_status = 'owner'` —
   linking to the format page above. Render `anchor_status = 'owner'` as
   "Owner-set" in the status band's *vs release* sub-line and in the Release-
   history anchor column.

### C. Verification

`tsc` + `vitest`; pgTAP + the remote inertness spot-check from A.5; confirm the
catalogue/favourites/card all reflect a test owner anchor via read-only remote
queries (owner login can't be automated). Because the resolved view is inert
until the first owner row exists, the change is safe to deploy ahead of any
data.

### Decisions (locked 2026-08-17)

1. **Wrapper view over editing `release_price_anchor_view` in place** — keeps the
   imported confirm/reset path pure; two consumers repoint. *(Recommended.)*
2. **Write surface = the generalised per-format page**, reached from a read-only
   link on the card — consistent with "card reads, management elsewhere". The
   alternative (an inline form on the card) is rejected to keep the card
   write-free.
3. **`tax_basis` defaults to `in_bond`**; metrics assume in-bond (as the imported
   anchor already does). A `duty_paid` owner price is stored but flagged, not
   silently compared. 
4. **Owner anchor is per `(parent_sku, format_code)`** — no multi-date history
   for owner anchors (unlike imported evidence); the single owner value is the
   anchor. A `source_note`/`offer_date` records context.

## 12. Step 5 — implementation plan

Scope: **feature 4** — a **Scenarios** tab of named, saved filter+sort
definitions evaluated server-side over the card metrics, each listing the wines
that match and linking into the card. The canonical example, *"biddable wines
priced < 10% over release"*, is just `ask_vs_release_pct < 10` over the metrics
view. **The agent is not a separate build**: it consumes the *same*
`saved_scenarios.definition` and the *same* view; build the human path, the agent
inherits it. **Biddable-only** — scenarios evaluate the `parent:` catalogue.

### What exists to build on (reuse, don't reinvent)

- **The typed filter registry** — `CATALOGUE_FILTERS` / `CATALOGUE_METRICS`
  (`as const satisfies Record<…>`) and the `CatalogueFilter` kinds
  (`enum | range | date | text | typeahead | boolean`) in `lib/query`. A scenario
  `definition` is the same `{ filters: Filter[], sort: {field, dir} }` shape.
- **The translation engine** — `fetchCatalogue`'s switch turns each filter kind
  into a PostgREST call (`enum→in`, `range→gte/lte`, `text→or(ilike)`,
  `boolean→eq`, `typeahead→eq`). Extract it to a shared `applyFilters(query,
  filters)` and point it at the scenario view; the same code runs both surfaces.
- **The metrics** already exist on `wine_card_format_view` (ask, bid, market,
  `ask_vs_release_pct`, `bid_vs_release_pct`, `price_vs_market_pct`,
  `price_vs_last_pct`, `anchor_status`, …) — including the owner-resolved anchor
  from step 3, so a scenario reflects owner prices for free.

### A. Database — one migration + one pgTAP test

1. **`wine_scenario_view`** (`security_invoker`) — the evaluation *and* display
   surface, one row per `(parent_sku, format_code)`: `wine_card_format_view`
   joined to `wine_card_view` identity (`name, vintage, producer, country,
   region, subregion, colour, is_biddable`). Every row is a live biddable format
   (the format view is catalogue-driven), so `is_biddable` is effectively always
   true — the example scenario reduces to the pct filter. Grants/RLS mirror the
   card views.
2. **`saved_scenarios`** (durable):
   ```
   saved_scenarios (
     id uuid pk default gen_random_uuid(),
     user_id uuid not null references auth.users(id),
     name text not null check (char_length(btrim(name)) between 1 and 120),
     definition jsonb not null check (jsonb_typeof(definition) = 'object'),
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   )
   ```
   RLS owner-only via `private.is_app_owner()`, but — unlike the derived owner
   tables — this is **pure user data with no cross-table effects**, so CRUD is
   **RLS-gated direct** (SELECT/INSERT/UPDATE/DELETE policies with
   `USING/WITH CHECK (is_app_owner() AND user_id = auth.uid())`), not SECURITY
   DEFINER functions. The app validates `definition` before writing; the DB keeps
   only the light `jsonb_typeof` guard.
3. **pgTAP** `saved_scenarios.test.sql`: RLS (anon no access; a non-owner cannot
   read/write another's rows), the `jsonb_typeof` and name checks, and
   `wine_scenario_view` shape/identity + `ask_vs_release_pct` parity with
   `wine_card_format_view` on a fixture. Plus a remote spot-check that
   `wine_scenario_view` row count equals `wine_card_format_view`.
4. **Regenerate `database.types.ts`.**

### B. App — the registry, engine, evaluation

5. **`SCENARIO_FILTERS`** registry (mirrors `CATALOGUE_FILTERS`, over
   `wine_scenario_view`): `search` (text: name/producer), `producer`
   (typeahead), `region`/`subregion`/`country`/`colour`/`vintage`/`format_code`
   (enum), `anchor_status` (enum: owner/confirmed/provisional), `is_listed`
   (boolean), and `range` metrics `lowest_ask_p`, `price_vs_market_pct`,
   `price_vs_last_pct`, `ask_vs_release_pct`, `bid_vs_release_pct`,
   `release_price_p`. Sort = any metric column + `parent_sku, format_code`
   tiebreak.
6. **Extract `applyFilters(query, filters)`** from `fetchCatalogue` and reuse it
   for `fetchScenario(definition, page)` over `wine_scenario_view`. A
   `parseScenarioDefinition(json)` (hand-rolled, mirroring `url.ts` parse)
   validates/normalises the stored JSONB against the registry on read and before
   write — untrusted JSON never reaches the query builder unchecked.

### C. App — the Scenarios tab (5a)

7. **`/scenarios`** route + nav entry:
   - **List** saved scenarios (name, live match count, updated), plus "New".
   - **Editor**: name + a **basic filter builder** (add/remove rows: pick a
     registry field → kind-appropriate input; range = min/max, enum = multi-select,
     etc.) + a sort picker.
   - **Run preview** (server-evaluated, paginated with the release-prices
     paginate/clamp shape): wine · format · ask · `ask_vs_release_pct` ·
     `anchor_status`, each row linking to `/wine/parent/{sku}`.
   - **Save / rename / delete** via RLS-gated server actions.
   Defer full `FilterStrip` reuse (5b) and the agent path (5c).

### D. Later sub-steps (not built in 5a)

- **5b** — swap the basic builder for the catalogue's `FilterStrip`/facets UX;
  scenario "modes"/starting points if wanted.
- **5c — agent access.** An agent with Supabase access reads
  `saved_scenarios.definition` and evaluates it via `applyFilters` over
  `wine_scenario_view` (or a thin `evaluate_saved_scenario(id)` SQL function that
  applies the stored filters). No new metrics; the human contract is the agent
  contract.

### E. Verification

`tsc` + `vitest` (new `applyFilters` + `parseScenarioDefinition` unit tests;
reuse of the existing filter tests); pgTAP + remote parity spot-check; route
compiles. Evaluation correctness is proven by the shared-engine tests rather than
the browser (owner login can't be automated).

### Decisions to confirm (defaults chosen)

1. **`wine_scenario_view` = format view + identity**, as the single evaluate/
   display/agent surface. *(Recommended.)*
2. **`saved_scenarios` writes are RLS-gated direct CRUD**, not SECURITY DEFINER
   functions — pure user data, no cross-table effects.
3. **First cut is 5a** (table + view + registry + shared engine + a working tab
   with a basic filter builder); `FilterStrip` reuse (5b) and agent access (5c)
   are separate.
4. **`definition` validated in the app** against the registry (`parseScenario
   Definition`), DB keeps only a `jsonb_typeof = 'object'` guard.
