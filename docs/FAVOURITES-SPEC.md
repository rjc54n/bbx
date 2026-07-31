# Favourites — functional spec

**Status:** built and pushed, 29 July 2026. Commits `45eb9e3` (schema),
`d536e92` (shared star and action), `e922051` (all surfaces), `62fbd72` (error
surfacing), `0255d06` (tab), `8d4ac73` (wine card).
**Decisions taken:** favourites attach to the **wine** (Parent ID); the
Favourites tab drills into a **new unified wine card**; v1 is a **plain star** —
no notes, no named lists, no alerts.

**Document use, 31 July 2026:** the sections below retain the pre-build problem
statement and implementation sequence as decision history. They do not describe
unfinished work unless an item is explicitly listed under Open points. Current
defects and maintenance recommendations are in
[`CODEBASE-REVIEW-2026-07-31.md`](CODEBASE-REVIEW-2026-07-31.md).

### What changed during the build

- **`refresh()` instead of `revalidatePath()`** in the server action. The star is
  clicked from eight surfaces; a hard-coded path would leave seven stale.
- **`useOptimistic` instead of a hand-rolled rollback.** This also fixed a latent
  bug in the old button: its `Set` was seeded from props once via `useState` and
  never re-synced, so two rows of the same wine could disagree.
- **The two views carry the format-adjusted guide** as well as the raw one, since
  `catalogue_view` already computes it and the raw guide's flatness is the point.
- **Unlink/re-link are linked to, not duplicated** on the wine card (§6.5). The
  record pages own those actions and their audit trail.
- **Error messages carry the Postgres cause.** The first real failure was an
  unpushed migration, and "could not be loaded" said nothing about it.
- **pgTAP suite added** (`supabase/tests/database/wine_favourites.test.sql`),
  15 tests over the propagation rules.

---

## 1. Pre-build baseline

`public.release_price_favourites` (migration
[`20260728142540_release_price_favourites.sql`](../supabase/migrations/20260728142540_release_price_favourites.sql))
is `(user_id, parent_sku)` — so the **storage grain is already right**. The wine
is the thing favourited, not the release-offer row.

The problems are all above the storage layer:

| Problem | Where |
|---|---|
| Only one surface writes it | [`AcceptedOfferBrowser.tsx:52`](../apps/web/src/components/releaseOffers/AcceptedOfferBrowser.tsx) is the only star in the app |
| Only one surface reads it | [`release-prices/page.tsx`](<../apps/web/src/app/(protected)/release-prices/page.tsx>) is the only query against the table |
| You cannot favourite before a link exists | the browser renders "Link required" unless `link_status === 'linked'` — but the moment you most want to flag a wine is while triaging an unmatched row |
| Unlinking silently strands the favourite | nothing in `unlink_cellartracker_record` / the release-offer equivalents touches favourites; the wine stays favourited with no record pointing at it, and no screen shows it |
| The name is source-bound | "release price favourite" is a release-prices concept in the schema, which is why nothing else reads it |

So this is less "build favourites" than "make the existing favourite a
first-class wine property, and let it be set before the wine is identified".

---

## 2. Model

### 2.1 Two tables

**`public.wine_favourites`** — canonical. Direct rename of
`release_price_favourites`, same shape, same RLS:

```sql
user_id     UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
parent_sku  TEXT    NOT NULL CHECK (parent_sku ~ '^\d{5,30}$')
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
PRIMARY KEY (user_id, parent_sku)
```

**`public.pending_favourites`** — a favourite on a source record that has no
Parent ID yet:

```sql
user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
source           TEXT NOT NULL CHECK (source IN ('cellartracker', 'release_offer'))
match_group_key  TEXT NOT NULL
created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
PRIMARY KEY (user_id, source, match_group_key)
```

### 2.2 Why `match_group_key` and not `(import_id, source_row_number)`

Both sources already carry a generated `match_group_key` —
`coalesce(vintage::TEXT,'unknown') || '|' || source_match_key` — on
[`cellartracker_evidence`](../supabase/migrations/20260729124117_cellartracker_catalogue_matching.sql)
and
[`release_offer_source_rows`](../supabase/migrations/20260728093834_historic_offer_catalogue_matching.sql).

`(import_id, source_row_number)` is **snapshot-scoped**: the next accepted
CellarTracker snapshot mints new import IDs and renumbers rows, and every
pending favourite would evaporate. `match_group_key` is stable across imports
and is the same key matching already groups on — so a pending favourite
survives re-import, and one star covers every row of the same wine in the
snapshot. That is also exactly the grain the review screens work at, so a star
can sit on a match group during triage.

### 2.3 Effective favourite

A record renders as favourited when **either** holds:

- it is linked and its `parent_sku` is in `wine_favourites`, **or**
- its `(source, match_group_key)` is in `pending_favourites`.

The star is one control with one meaning ("I care about this wine"); which
table it lands in is an implementation detail of whether we know the wine yet.

---

## 3. Propagation rules

These are the whole point of the feature. Implemented as **triggers on the
resolution tables**, not in app code, so every link path gets them for free —
single-row manual link, match-group confirm, an auto-linked matching run, and
the exact-match backfill inside `run_cellartracker_matching`.

| Event | Rule |
|---|---|
| Star a **linked** record | insert `wine_favourites(parent_sku)`. Every record in every source that resolves to that Parent ID immediately shows starred, as does the catalogue browser and the BBR cellar. |
| Star an **unlinked** record or match group | insert `pending_favourites(source, match_group_key)`. |
| **Link** (resolution insert with `status='linked'`) | promote: if a pending favourite exists for that source + group key, insert `wine_favourites(parent_sku)` and delete the pending row. |
| **Unlink** (resolution delete) | demote: if the wine is favourited, write back `pending_favourites` for the group key so the star stays on the row. **Never** delete the wine favourite — that is a separate, explicit act. |
| **Edit** a link (A → B) | favourite B if the record was showing favourited. A is left alone. |
| **Suppress** a record | treated as unlink: pending favourite written back, wine favourite untouched. |
| **Delete** a record | delete the pending favourite only when no rows with that group key remain. Wine favourite untouched. |
| **New snapshot** imported | nothing to do — both keys are import-independent. |

**Known, accepted asymmetry:** correcting a mis-link (A → B) leaves a stale
favourite on wine A. That is deliberate — un-favouriting on the user's behalf
is worse than a stray star. The Favourites tab surfaces such entries as
"no linked records", one click from removal. Same reasoning as the rest of the
pipeline: surface candidates for a human, don't execute.

Trigger implementation notes:

- `SECURITY DEFINER`, `SET search_path = ''`, all writes `ON CONFLICT DO
  NOTHING`. A favourite trigger must never be able to fail a link operation.
- Single-owner app (see [ADR-001](ADR-001-single-owner-application.md)), so
  promotion writes for every `user_id` holding the pending row — in practice
  one.

---

## 4. Surfaces

One shared client component `<FavouriteStar>` (lifted from the private
`FavouriteButton` in `AcceptedOfferBrowser.tsx`, with its optimistic-update and
rollback behaviour kept) and **one** server action:

```ts
setFavourite(
  target: { kind: "wine"; parentSku: string }
        | { kind: "record"; source: "cellartracker" | "release_offer"; matchGroupKey: string },
  favourite: boolean,
): Promise<{ error?: string }>
```

Placement:

| Surface | Star behaviour |
|---|---|
| Release prices table | existing star; extended to unlinked rows (writes pending) |
| Release-offer record page | new |
| CellarTracker table | new |
| CellarTracker record page | new |
| Both match-review screens (`/cellartracker/matches`, `/release-prices/matches`) | star the match group while triaging |
| Explore catalogue browser | wine-level star on the row |
| My BBR Cellar | wine-level star on the row |
| Favourites tab and wine card | star, and the un-star path |

---

## 5. Favourites tab

Route `/favourites`, new entry in
[`PrimaryNavigation.tsx`](../apps/web/src/components/app/PrimaryNavigation.tsx).
Two sections.

### 5.1 Favourited wines

One row per Parent ID, backed by a new `public.favourite_wine_view`
(`security_invoker`, owner-scoped) joining, per Parent ID:

- `catalogue_view` at the smallest available format — same
  `DISTINCT ON (parent_sku) … ORDER BY case_size ASC` trick
  `current_cellartracker_records` already uses — for name, producer, vintage,
  region, colour, `is_listed`, `ask`, `highest_bid_p`, `market_price_p`
- `release_price_market_view` / `release_price_anchor_view` for the most recent
  release price and ask-vs-release / bid-vs-release percentages
- `current_cellartracker_records` aggregated for home + BBR bottle counts and
  price paid
- `current_bbr_holdings` aggregated for BBR-cellar bottles
- counts of linked source records per source, for the provenance chips

Columns: wine (name, producer, vintage) · Parent ID · sources present (chips:
Catalogue / Release / CellarTracker / BBR) · held (bottles) · paid /75cl ·
lowest ask /75cl · highest bid /75cl · guide /75cl · latest release /75cl ·
ask vs release % · favourited on.

All money figures are 75cl-equivalent, consistent with the CellarTracker page.
Sort defaults to most recently favourited; client-side filters for *held*,
*has an ask*, *listed*, and a text search, matching the existing browsers'
pattern (filtering is in-memory over a full fetch, as `AcceptedOfferBrowser`
already does).

### 5.2 Pending favourites

Wines starred but not yet identified: source · source wine text · vintage ·
number of rows in the group · state (no candidates / awaiting review) · link
through to the relevant match-review screen. This section is the reason
favouriting-before-linking is worth building: it is a work queue of "wines I
care about that the pipeline hasn't resolved".

---

## 6. Wine card — `/favourites/[parentSku]`

Everything we hold about one wine, in one place. Works for **any** Parent ID,
favourited or not (the star is simply on or off), so it doubles as the general
wine page and later source pages can link into it.

1. **Identity** — name, producer, vintage, country/region/subregion, colour,
   Parent ID, link out to the BBR product page, star toggle.
2. **Market now** — one row per format: case size, bottle volume, lowest ask,
   highest bid, guide, each also as £/75cl, `is_listed`, last REST check. This
   is where the volume-linearity finding bites: the guide is a constant £/litre
   across formats, so the £/75cl guide column is flat while asks are not
   ([ROADMAP finding 2](ROADMAP-2026-07.md)). Show the deviation, don't hide it.
3. **Release history** — every accepted release-offer row resolving to this
   Parent ID: offer date, original price text, release price /75cl, ask vs
   release %, bid vs release %, link to the offer record page.
4. **My cellar** — CellarTracker rows (home / BBR quantities, price paid /75cl,
   drink window, consumed flag) and BBR cellar holdings (format, bottles,
   purchase price, status, BBX eligibility), each linking to its record page.
5. **How this wine is joined up** — one line per linked source record: source,
   match method, who resolved it and when, with the existing unlink/edit forms
   reused rather than reimplemented.
6. **Degraded state** — release offers match against BBR's wider `prod_product`
   catalogue, so a favourited Parent ID may have **no row in `private.products`
   or `catalogue_view`**. The card must render from whatever the release-offer
   suggestion rows carry (name, vintage, producer) and say plainly that the
   wine is not in the tracked book, rather than 404 or show blanks.

---

## 7. Implemented migration

Implemented in
[`20260729203000_wine_favourites.sql`](../supabase/migrations/20260729203000_wine_favourites.sql):

1. `CREATE TABLE public.wine_favourites` (shape above, RLS + grants copied
   verbatim from the existing table: `REVOKE ALL … FROM PUBLIC, anon,
   authenticated`, `GRANT SELECT, INSERT, DELETE TO authenticated`, policy
   `(SELECT auth.uid()) = user_id AND (SELECT private.is_app_owner())`).
2. `INSERT INTO public.wine_favourites SELECT * FROM public.release_price_favourites;`
3. `DROP TABLE public.release_price_favourites;`
4. `CREATE TABLE public.pending_favourites` with the same RLS shape.
5. Promote/demote trigger functions + triggers on
   `cellartracker_product_resolutions` and
   `release_offer_product_resolutions` (INSERT / UPDATE / DELETE).
6. `CREATE VIEW public.favourite_wine_view`.
7. Regenerate `apps/web/src/lib/database.types.ts`.

No data loss: existing favourites carry over by primary key.

---

## 8. Completed build order

Each step leaves the app working.

1. **Schema** — migration + regenerated types. Point the existing
   release-prices query and action at `wine_favourites`. No visible change.
2. **Shared star + read-through** — extract `<FavouriteStar>` and the single
   server action; add read-through and the star to the CellarTracker table,
   both record pages, catalogue browser and BBR cellar. This alone delivers
   "favourite once, see it everywhere".
3. **Pre-link favourites** — allow starring unlinked rows and match groups;
   add the promote/demote triggers.
4. **`/favourites` tab** — `favourite_wine_view` + the two sections.
5. **`/favourites/[parentSku]` wine card**.

---

## 9. Tests

- **SQL**
  ([`supabase/tests/database/wine_favourites.test.sql`](../supabase/tests/database/wine_favourites.test.sql)):
  promote on single-row link; promote on
  match-group confirm; promote on an auto-linked matching run; demote on
  unlink; wine favourite survives record deletion; pending favourite survives a
  re-import; edit A→B favourites B and leaves A; a trigger failure can never
  roll back a link.
- **Vitest**: `<FavouriteStar>` optimistic update and rollback on error;
  effective-favourite resolution (linked vs pending); favourites-tab filtering
  and sorting, mirroring `src/lib/releaseOffers/browser.test.ts`.

---

## 10. Open points

The 31 July review added one correctness item ahead of the scale and navigation
questions below: `favourite_wine_view` must exclude owner-excluded release
offers when it calculates `release_offer_record_count`. Add the regression case
to the pgTAP file above. This remains unresolved.

- **Nav crowding** — shipped as a sixth top-level tab, which is the crowded
  option. Favourites arguably belongs beside "My BBR Cellar" and "My
  CellarTracker" under a "Mine" grouping. Still open, now a change rather than
  a decision.
- **Tab load** — the favourites view fans out across four sources per wine. Fine
  at tens of favourites; if it grows, the view is the thing to materialise, not
  the page to paginate.
- **Format-level interest** — deferred by decision. If "watch the magnum, not
  the bottle" turns out to matter, it is an additive
  `wine_favourite_formats(user_id, parent_sku, format_code)` table, not a
  rework: the wine-level star stays the primary object.
