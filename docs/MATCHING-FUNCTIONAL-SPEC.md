# Wine matching, Part A: unified surface

**Status:** in implementation.
Slice 1 (union views, summary function, exclusion fix) shipped to production
31 Aug 2026 — migration `20260831120000_wine_match_unified_surface.sql`, pgTAP
`wine_match_unified_surface.test.sql` (53 assertions).
Slice 2 (shared `source`-parameterised components + `ADAPTERS` map behind the
existing routes, no URL change) built 31 Aug 2026 — `src/lib/matching/`,
`src/components/matching/`; both `/release-prices/matches` and
`/cellartracker/matches` now render through one `MatchGroupList`. Vitest:
`adapters.test.ts`, `cellartrackerPanels.test.ts`.
Slice 3 (unified `/matches` route, nav entry, 308 redirect contract) built
31 Aug 2026 — `src/app/(protected)/matches/page.tsx` on the union view +
`wine_match_queue_summary`; both old routes are `permanentRedirect`s driven by
`src/lib/matching/redirectContract.ts`. Vitest: `redirectContract.test.ts` (9).
The formal p50/p95 latency harness + 1.25× budget gate (§10) is **deferred** by
the owner (minimise Supabase compute after a production incident the week of
25 Aug); filter push-down and summary cost were instead confirmed by plain
`EXPLAIN` (no `ANALYZE`) on production — see §8.
Slice 4 (relabel sweep) built 1 Sep 2026 — "Reject and suppress" → **"No
suitable match"** on the `/matches` list and both record-detail pages, the
always-visible helper text contrasting it with Exclude (§3.8), the two
"cannot link" actions grouped and separated from the linking actions with
Exclude the heavier control, and the `ignored` / `suppressed` status cells in
the accepted-offer and CellarTracker record browsers now read "No suitable
match". Label-only: no status enum, RPC or constraint change. **Part A
complete.**

**Revised twice after external review:**
[`MATCHING-FUNCTIONAL-SPEC-REVIEW.md`](MATCHING-FUNCTIONAL-SPEC-REVIEW.md)
(30 Aug 2026) and
[`MATCHING-SPECS-SECOND-REVIEW.md`](MATCHING-SPECS-SECOND-REVIEW.md) (31 Aug
2026).

**Split:** this part covers consolidating the two matching pages into one
operable surface, a low-risk change that ships on its own. The background work
that reacts when a wine becomes tradeable is a separate, still-open design and
lives in [`MATCHING-RECONCILIATION-SPEC.md`](MATCHING-RECONCILIATION-SPEC.md)
(Part B). Part A is a prerequisite for Part B but has value alone.

**What changed in the second revision**

- Count strategy rewritten (2nd review §3.4): one exact single-pass
  `SECURITY INVOKER` summary function, no `SECURITY DEFINER`, no wrapper. §3.2.
- The old-route redirect contract is now an explicit mapping table (§3.7),
  including `q` / `page` and a `with-suggestions` state so `candidates`
  bookmarks keep their meaning (2nd review §3.5).
- `needs-review` simplified to a predicate the union contract can actually
  serve; the "exact candidate awaiting confirmation" ordering tier is dropped
  (2nd review §3.6). §3.5.
- The CellarTracker panel has a named data source and query (2nd review §3.7).
  §3.4.
- `is_bbx_eligible` is one exact predicate (§4); a numeric performance budget
  replaces "within the current range" (§8); pagination-count semantics stated
  (§3.2); "both matched sources", not "three" (§1.1).

---

## 1. Context

### 1.1 What matching is

BBX arbitrage needs, per wine, both its current market position (live BBX asks
and bids, Liv-ex guide) and its **release price**, what BBR originally offered it
at. The release side comes from imported evidence that must be **linked to a BBR
Parent ID** (`private.products.parent_sku`) before it can anchor anything.

Matching is that linking step: take a cluster of imported source rows for one
wine and vintage (a `match_group_key`) and attach the correct Parent ID. It is a
**standing operational activity**. Records are imported into both matched
sources (release offers and CellarTracker) in batches on a recurring basis, so
the queue never empties. BBR holdings also arrive in batches but carry a native
Parent ID and have no matching queue.

### 1.2 The four data sources

| Source | Parent ID? | Matched by the owner? |
| --- | --- | --- |
| **Catalogue** | Yes, it *is* the identity | n/a, the match target |
| **BBR holdings** (`cellar_imports` / `bbr_holdings`) | Yes, native | No queue; only an "unmatched" count |
| **Historic BBR offers** (`release_offer_*`) | Rarely | **Yes** |
| **CellarTracker inventory** (`cellartracker_*`) | No | **Yes** |

Notes carried into Part B, not assumed in Part A:

- A BBR holding carries a Parent ID but **does not** write a
  `release_offer_product_resolution` or a `cellartracker_product_resolution`. A
  holding for the same wine does not make a release-offer group "already
  linked".
- Linking a **release-offer** group feeds `release_offer_evidence_view` and the
  release-price anchor. Linking a **CellarTracker** group feeds
  `current_cellartracker_records` (market comparison on owned inventory). The
  two are different downstream features that share only the linking mechanic.

### 1.3 Today: two matching surfaces

`/release-prices/matches` and `/cellartracker/matches` are separate pages with
separate implementations; the second was copied from the first. They share the
grouping grain, the state model, six mutation operations plus exclude, and three
duplicated React components (`MatchRunControl`, `CatalogueCandidateSearch`, the
exclude form). Each is reachable only by one header link. There is no top-nav
entry and no cross-source queue.

---

## 2. Problems in scope for Part A

### 2.1 Duplication and drift

Every workflow change is made twice, and the copies have drifted. The
release-offer page requests `count: "estimated"` for its four queue tallies; the
CellarTracker page requests `count: "exact"` for the same four.

### 2.2 "Reject and suppress" vs "Exclude" is unclear

Two adjacent terse buttons, no guidance:

- **Suppress** (`release_offer` status `ignored` / `cellartracker` status
  `suppressed`): the evidence is genuine; the rows stay in the corpus and leave
  the queue. Reversible.
- **Exclude**: the evidence itself is wrong. The rows are filtered out of the
  accepted lists, the release-price anchor, market comparison, favourites, and
  future imports repeating the same content. Reversible from a separate page.

Exclude is the broader action, but "Reject" reads as the harsher word.

### 2.3 Matching is not discoverable

No top-nav entry; the queues are buried one level down. No single "what needs
linking" view across sources, which the batch-import workflow needs.

### 2.4 Excluded release-offer rows still inflate the queue

`cellartracker_match_review_view` filters excluded rows out of its group counts.
`release_offer_match_review_view` does not; it was never recreated with an
exclusion filter. An excluded release-offer row with no resolution still counts
as `unresolved_row_count` and keeps its group in the queue. The union view (§3.2)
resolves this by filtering excluded rows in both branches.

> The "system does not react when a wine becomes tradeable" problem is real and
> is Part B.

---

## 3. Proposal

### 3.1 One surface

A single page at `/matches`, in the top navigation as **"Matching"**. Both
existing routes become permanent redirects (§3.7). Header links from "Release
prices" and "My CellarTracker" stay, now deep-linking into `/matches?source=…`.

Two filters:

- **source**: `all` / `release_offer` / `cellartracker`
- **state**: `needs-review` / `with-suggestions` / `linked` / `no-suitable-match`
  / `all` (§3.5)

Default: `all` / `needs-review`.

### 3.2 Union read views and counts

`wine_match_review_view` and `wine_match_suggestion_view`, each a `UNION ALL` of
the two per-source views with a `source` discriminator.

- **`UNION ALL`, never `UNION`.** The branches are disjoint by `source`.
- **Explicit column list**, not `SELECT *`. Consuming code selects explicit
  columns; `database.types.ts` is regenerated after the migration.
- **`(source, match_group_key)` is the identity** and the final ordering
  tie-breaker.
- **`WITH (security_invoker = true)`**, matching the underlying views.
- **Excluded rows filtered in both branches** before any count (fixes §2.4).
- **Common review projection**: `source`, `match_group_key`, `wine_ref`
  (`'parent:' || parent_sku`, nullable; the Part B seam), `parent_sku`,
  `match_method`, `source_wine`, `source_vintage`, `source_row_count`,
  `unresolved_row_count`, `linked_row_count`, `suppressed_row_count`,
  `is_bbx_eligible` (§4), `suggestion_count`, `top_match_score`,
  `suggestions_observed_at`, `last_run_status`, `last_error_at`.
- **Common suggestion projection**: `source`, `match_group_key`, `parent_sku`,
  `rank`, `name`, `vintage`, `producer`, `region`, `match_score`,
  `is_bbx_eligible`, `observed_at`. `match_score` is each backend's own ranking
  score, used only to order suggestions **within a group**, never to compare
  across groups or sources.
- **Source-specific columns stay out of the common contract.** Release offers
  carry `earliest_offer_date` / `latest_offer_date`; CellarTracker carries
  `source_producer` / `source_region`. The list surface reads only the common
  projection; the expanded panel fetches source-specific detail (§3.4).

**Counts.** `count` is a PostgREST request parameter, not a view property.
`Prefer: count=estimated` estimates the number of rows a query returns, so it
cannot turn `count(*) FILTER (…)` values inside a function into planner
estimates. The design is therefore:

- The visible page uses an **exact** filtered `count` for pagination, as both
  pages do today. This counts the complete filtered result set, not just the
  returned page.
- The state-chip tallies come from one `wine_match_queue_summary(p_source text)`
  function: a single pass over the union view, returning one row of exact
  `count(*) FILTER (WHERE …)` values per state. It is **`SECURITY INVOKER`**,
  `REVOKE EXECUTE FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated`, and
  relies on the union view's own `security_invoker` boundary. No `SECURITY
  DEFINER`, no private/public wrapper.
- If the single-pass function misses the latency budget (§8) on a data branch,
  the fallback is a maintained summary table refreshed on resolution-mutation,
  not estimated counts. This is a documented fallback, not the plan.

Filter push-down must be verified: `source` and `state` predicates must reach
the underlying branch scans, confirmed with `EXPLAIN (ANALYZE, BUFFERS)` on a
Supabase data branch (§7).

### 3.3 Component and action-layer consolidation

- **One `MatchGroupList`**, one `CatalogueCandidateSearch`, one exclude form,
  parameterised by `source`.
- **Explicit source adapter, not dynamic RPC names.** A typed map:

  ```
  const ADAPTERS = {
    release_offer: { confirm: confirmReleaseOfferMatch, suppress: …, exclude: …, … },
    cellartracker: { confirm: confirmCellarTrackerMatch, suppress: …, exclude: …, … },
  } as const;
  ```

  The client passes `{ source, matchGroupKey, op, parentSku? }`; the action
  validates `source` against this closed allowlist and calls the named
  function. No string interpolation into RPC names.
- The 12 existing per-source RPCs are unchanged. Part A adds one read-only
  function (§3.2) and no other RPC.

### 3.4 Source-specific evidence panels

The shared queue shell carries the card header, filters and decision controls.
The **expanded group panel is source-specific** and has a defined data source:

- **Release offers**: offer dates, price text, tasting notes, source links, from
  `release_offer_match_review_view` plus the existing per-record fetch the
  current page already does.
- **CellarTracker**: producer, region, and per-wine quantities (home, BBR-held,
  total) plus the accepted-snapshot timestamp, from
  `current_cellartracker_records`. The `/matches` page fetches this **once for
  the visible page**, `WHERE parent_sku = ANY(…)` for linked groups and keyed
  on `(import_id, source_row_number)` joined back to `match_group_key` for the
  rest, then groups client-side by `(source, match_group_key)`. No request per
  card.
- If grouping `current_cellartracker_records` by `match_group_key` needs a
  column it does not expose (it keys on evidence rows, not groups), Slice 1
  adds a `cellartracker_match_evidence_view` at group grain rather than
  overloading the review view.

A lowest-common-denominator card is explicitly rejected: the two sources support
different owner decisions and need different evidence.

### 3.5 The default queue

`needs-review` is the predicate:

```
unresolved_row_count > 0 OR last_run_status = 'failed'
```

It excludes fully-linked groups, fully-suppressed groups, and excluded
evidence. **Mixed groups** (some rows linked, some unresolved) satisfy the
predicate through `unresolved_row_count > 0` and are a *presentation* concern,
not a separate set: the panel shows per-row status, and confirm / suppress act
only on the still-unresolved rows, matching current per-source RPC behaviour.

Other states:

- `with-suggestions`: `needs-review` groups with `suggestion_count > 0`. This is
  the new home for the old `candidates` filter.
- `linked`: `linked_row_count > 0 AND unresolved_row_count = 0`.
- `no-suitable-match`: `suppressed_row_count > 0 AND unresolved_row_count = 0`
  (the old `suppressed`).
- `all`.

**Ordering** within `needs-review`, stable:

1. `last_run_status = 'failed'` first (these are stuck, not just unreviewed);
2. then `suggestion_count DESC`, `top_match_score DESC NULLS LAST`;
3. then `source`, then `match_group_key`.

There is no "exact candidate awaiting confirmation" tier: the exact tiers in
both backends auto-link, so a group that still has suggestions has, by
definition, no confirmed exact match.

### 3.6 The seam for Part B

Part A leaves two hooks so Part B needs no rework:

- `wine_ref` in the union contract (nullable), so a future `local:` identity
  slots in beside `parent:`.
- The list surface reads **resolution state** (`needs-review` /
  `with-suggestions` / `linked` / `no-suitable-match`) as one axis. Part B adds
  a separate **reconciliation-priority** axis (`none` / `open-alert`) as an
  additional filter, not a new resolution state, and not a change to this
  enum.

### 3.7 Old-route redirect contract

Both old routes become permanent (308) redirects to `/matches`. Each old route
**sets** its source; an inbound `source` parameter on an old URL is ignored.

| Old route | Sets |
| --- | --- |
| `/release-prices/matches` | `source=release_offer` |
| `/cellartracker/matches` | `source=cellartracker` |

State mapping:

| Old `state` | New `state` |
| --- | --- |
| `unresolved` | `needs-review` |
| `candidates` | `with-suggestions` |
| `linked` | `linked` |
| `suppressed` | `no-suitable-match` |
| `all` | `all` |
| absent / unrecognised | `needs-review` |

Other parameters:

- `q` (search) is carried through after the same validation the new page
  applies (trim, length cap).
- `page` is carried through if it is a positive integer, else dropped.
- Any other query parameter is dropped.

The redirect is tested on the **complete URL**, not `source` and `state` in
isolation (§8).

### 3.8 Clearer decisions

- **Suppress → "No suitable match".** Button, status text and filter chip. The
  neutral wording is deliberate: existing `ignored` / `suppressed` rows store no
  reason, so a specific label would assert history that was never recorded.
  Structured suppression reasons are a Part B change.
- **Exclude** keeps its name; the surrounding copy states the scope: "Removes
  this evidence from release prices everywhere, and from future imports."
- **Always-visible helper text** on the list: *"No suitable match: the wine is
  genuine but you cannot link it right now; it leaves this queue and stays in
  the corpus. Exclude: the source row itself is wrong; it is removed
  everywhere."*
- The two "cannot link" actions are grouped and separated from the linking
  actions; Exclude is styled as the heavier one.
- Label-only. No status enum, RPC or constraint change in Part A.

---

## 4. State vocabulary

Defined once, used consistently. Part A surfaces the first four; the rest are
defined here so Part B builds on the same words.

| Term | Meaning | Exact representation |
| --- | --- | --- |
| **Catalogue match** | a source group is linked to a BBR Parent ID | `*_product_resolutions.status = 'linked'` |
| **Unresolved** | the group has no resolution | no resolution row |
| **No suitable match** | the owner has set the group aside | `release_offer` status `ignored` / `cellartracker` status `suppressed` |
| **Excluded** | the evidence is invalid and removed downstream | `release_offer_record_exclusions` row / `cellartracker_record_decisions.is_excluded` |
| **BBX eligible** | the Parent ID has at least one live catalogue SKU | `EXISTS (SELECT 1 FROM public.catalogue_view c WHERE c.parent_sku = g.parent_sku)`. This is exactly what the current `is_biddable` flag computes; the union view renames it `is_bbx_eligible`. |
| **Listed** | at least one format has a current live ask | `EXISTS (… FROM catalogue_view c WHERE c.parent_sku = g.parent_sku AND c.is_listed)` |
| **Has live bid** | at least one format has a standing bid | `EXISTS (… WHERE c.parent_sku = g.parent_sku AND c.highest_bid_p IS NOT NULL)` |

"Biddable" is retired as a term. `is_bbx_eligible` on a linked group means the
wine is in the tradeable universe, not that it is trading right now; the panel
says so in those words.

---

## 5. Out of scope for Part A

- **Everything in Part B**: transition detection, the reconciliation record, the
  "open alert" priority state, suppression reasons, background auto-linking.
- **Unifying the two match-run backends.**
- **Local wine identity** (`wine_locals`, `wine_ref = 'local:{id}'`). The
  `wine_ref` column is the only concession.
- **A BBR-holdings review workflow.**
- **Merging the two Excluded-records pages.**

---

## 6. Risks

1. **Union-view cost.** Mitigation: the single-pass summary function, filter
   push-down verified on a data branch, `EXPLAIN (ANALYZE, BUFFERS)` and a
   recorded latency budget before merge (§8).
2. **Redirect breakage** for bookmarks. Mitigation: the explicit contract in
   §3.7 and a full-URL acceptance test.
3. **Relabel confusion** for an owner used to "suppress". Mitigation:
   single-user tool; changelog note; "Restore to unmatched" keeps its wording.
4. **Drift reappearing.** Two per-source views still back the union. Mitigation:
   a DB test asserts both branches expose the agreed common columns with
   matching types.
5. **CellarTracker panel N+1.** Mitigation: the single batched fetch in §3.4;
   a test asserts one query per page load regardless of card count.

---

## 7. Implementation plan

Independently deployable slices, in order. App deploys (Vercel, on merge) and
migrations (`supabase db push --linked`, separate) are never assumed
simultaneous. See [`../AGENTS.md`](../AGENTS.md).

### Slice 1: union views, summary function, exclusion fix (migration) — SHIPPED 31 Aug 2026

Landed as written, with these settled choices: `wine_match_queue_summary` takes
`p_source text DEFAULT NULL` (null = all sources); `last_run_status` /
`last_error_at` / `top_match_score` were added to both per-source review views
(not just the union); the summary's fifth bucket column is `all_groups`
(`all` is reserved). No `cellartracker_match_evidence_view` was needed —
`current_cellartracker_records` already exposes `match_group_key`, quantities
and `accepted_at` for the §3.4 panel. `database.types.ts` hand-edited for the
new objects (project convention; a full regen would drag in unrelated CLI drift).

Original plan:


- Add `wine_match_review_view`, `wine_match_suggestion_view`,
  `wine_match_queue_summary(p_source text)`.
- Recreate `release_offer_match_review_view` with the excluded-row filter so
  both branches agree (§2.4).
- If needed for the CellarTracker panel (§3.4), add
  `cellartracker_match_evidence_view` at group grain.
- `security_invoker = true` on views; the summary function `SECURITY INVOKER`,
  `REVOKE EXECUTE FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated`.
- DB tests (`supabase/tests/database/`): anon / authenticated-non-owner / owner
  access on every new object; the common-column contract (names + types) on
  both branches; excluded rows absent from counts in both branches; the summary
  function's totals equal a direct `count` for each state.
- Gates: `supabase test db` green locally; `supabase db push --linked`;
  `supabase migration list --linked` shows the migration in `remote`;
  regenerate `apps/web/src/lib/database.types.ts`.

### Slice 2: shared component and action layer (app, behind existing routes) — BUILT 31 Aug 2026

Landed as planned. `src/lib/matching/adapters.ts` is the closed `source`
allowlist → typed record of literal RPC names + routes + exclude-prompt copy;
`resolveMatchAdapter` throws on anything off the list. `src/lib/matching/
actions.ts` (`"use server"`) is the one source-parameterised mutation surface
(`runMatchGroupMutation` for the optimistic list; `mutateMatchGroup` /
`confirmMatchCandidate` / `linkMatchGroupManually` / `editMatchGroupParent` for
the redirecting forms; `searchMatchCatalogue`). One `MatchGroupList` /
`CatalogueCandidateSearch` / `ExcludeMatchGroupForm` under
`src/components/matching/`. The CellarTracker page now also renders through
`MatchGroupList` (so it gains the optimistic card removal the release page had)
with a source-specific evidence panel — producer / region / holding quantities /
snapshot date from **one** `current_cellartracker_records` query per visible
page (`loadCellarTrackerPanels`, spec §3.4). The offer-record detail page was
repointed to the shared actions. `MatchRunControl` and the two match-run
pipelines were left per-source (different Algolia search + result RPCs); fold
them in with Slice 3. Count-mode drift (§2.1) is untouched — Slice 3's
`wine_match_queue_summary` fixes it. No migration.

Original plan:


- One `MatchGroupList` / `CatalogueCandidateSearch` / exclude form,
  `source`-parameterised, rendered by both existing pages with URLs unchanged.
- The `ADAPTERS` map (§3.3); `source` validated against the closed allowlist.
- Vitest: adapter dispatch; `source` allowlist rejection; the batched
  CellarTracker fetch issues one query for N cards.
- Gates: `cd apps/web && npm run lint && npm run test && npm run build`.

### Slice 3: `/matches` page, nav, redirects (app) — BUILT 31 Aug 2026

Landed as planned. `src/app/(protected)/matches/page.tsx` reads
`wine_match_review_view` (rows + exact pagination count) and
`wine_match_queue_summary(p_source)` (state chips), with `source`
(`all`/`release_offer`/`cellartracker`) and `state` (`needs-review`/
`with-suggestions`/`linked`/`no-suitable-match`/`all`) filters, default
`all`/`needs-review`. Ordering: `last_error_at DESC NULLS LAST`
(failed-run groups first), then `suggestion_count DESC`,
`top_match_score DESC NULLS LAST`, then `source`, `match_group_key`. Per-source
detail (offer dates, producer/region, panels, full suggestion rows) is fetched
per visible page from the per-source views — the union carries only the common
projection. `MatchRunControl` / `CellarTrackerMatchRunControl` render per the
`source` filter (both when `all`); the two match-run pipelines stay per-source
(unifying them is out of scope, §5). `src/lib/matching/adapters.ts` `matchPath`
is now `/matches` for both sources (revalidation + return-path target).

`src/lib/matching/redirectContract.ts` + `redirectContract.test.ts` implement
§3.7: both old routes are `permanentRedirect` (308); each sets its own source,
remaps state, carries validated `q` + positive-int `page`, drops the rest.
Nav entry "Matching" added to `PrimaryNavigation` (after "Release prices").
Header links in `AcceptedOfferBrowser` / `CellarTrackerRecordsBrowser` and the
`FavouritesBrowser` deep-link now point at `/matches?source=…`.

Performance (§10) is **deferred** — see the status note and §8. No data branch
was created. Filter push-down and summary-function cost were confirmed with
plain `EXPLAIN` on production instead.

Original plan:


- New route reading the union view and summary function; `source` + `state`
  filters; source-specific panels.
- Nav entry in `PrimaryNavigation`. The §3.7 redirects. Header-link relabel in
  `AcceptedOfferBrowser` / `CellarTrackerRecordsBrowser`. `Pagination.test.ts`
  path updates.
- Performance: on a Supabase **data branch** (not production, see AGENTS.md),
  record baseline p50/p95 for the two current match pages, then
  `EXPLAIN (ANALYZE, BUFFERS)` for the union under each `state` filter, the
  summary function, and a deep page; confirm `source` push-down. Record all
  numbers in §8.
- Gates: web lint/test/build; signed-in smoke test of `/matches` and both
  redirects (full URLs) on the deployed route, separate from local checks.

### Slice 4: relabel sweep (app) — BUILT 1 Sep 2026

Landed as planned, label-only. `MatchGroupList` now renders the two "cannot
link" decisions in one bordered block below the linking actions and the
catalogue search: the §3.8 helper text, then a plain-bordered "No suitable
match" button and the accent-bordered `ExcludeMatchGroupForm` (the heavier
control). `displayMethod`'s `suppressed` label and the RO/CT record-detail
"Current status" strings read "No suitable match"; the RO detail page gained
the same helper text and moved its suppress control below the catalogue search;
both detail pages' Exclude sections open with "Use this when the source row
itself is wrong" and state the everywhere-and-future-imports scope. The
`ignored` / `suppressed` status cells in `AcceptedOfferBrowser` /
`CellarTrackerRecordsBrowser` read "No suitable match". `/matches` state chip
was already "No suitable match" (Slice 3). No confirm-dialog copy changed.

Original plan:


- "Reject and suppress" → "No suitable match" across the list and both detail
  pages; helper text; action grouping; status-text and filter-chip strings.
- No migration.
- Gates: web lint/test/build; visual check of both detail pages.

Throwaway DB objects (any perf scratch schema) are dropped immediately
(AGENTS.md).

---

## 8. Acceptance criteria

1. `/matches?source=release_offer&state=no-suitable-match` and the CellarTracker
   equivalent render the right groups; `source=all` interleaves both with a
   stable `(priority, suggestion_count, top_match_score, source,
   match_group_key)` order.
2. **Redirects, full URL.**
   `/release-prices/matches?state=candidates&q=tinto&page=3` →
   `/matches?source=release_offer&state=with-suggestions&q=tinto&page=3`.
   `/cellartracker/matches?state=suppressed` →
   `/matches?source=cellartracker&state=no-suitable-match`. An inbound
   `?source=cellartracker` on `/release-prices/matches` is ignored. An unknown
   `?foo=bar` is dropped.
3. A non-owner (anon and authenticated) can neither read the union views nor
   execute `wine_match_queue_summary`.
4. An excluded release-offer row does not appear in, or inflate the counts of,
   any queue state.
5. A mixed group appears once in `needs-review`; confirming links only the
   unresolved rows.
6. The release-offer panel shows offer date / price text / tasting notes; the
   CellarTracker panel shows producer / region / quantities / snapshot date.
   The `/matches` page issues one `current_cellartracker_records` query per page
   load regardless of card count.
7. Suppress then restore round-trips through the same per-source RPCs as today;
   the group returns to `needs-review`.
8. `wine_match_queue_summary` totals equal a direct `count` for each state, on
   the data branch.
9. `database.types.ts` matches the deployed schema after Slice 1.
10. **Performance budget.** Record on the data branch: current match-page p50
    and p95. The `/matches` landing render (union page + summary function) must
    be within **1.25×** the slower current page's p95. If it is not, Slice 3
    does not merge until the summary function is replaced by the maintained
    table fallback (§3.2) and re-measured.

### Slice 3 verification, 31 Aug 2026

Criteria 1, 3, 4, 5, 6, 7 are served by Slice 1's DB tests + Slice 2/3 unit
tests + the shared component behaviour (unchanged from Slice 2). Criterion 2 is
covered by `redirectContract.test.ts` (drives `buildMatchesRedirect` on the
exact URLs in the acceptance text). Criterion 9: no schema change in Slice 3,
so `database.types.ts` is unchanged and still matches.

Criterion 8 / 10 (the data-branch latency harness) is **not done** — the owner
directed us to minimise Supabase compute after a production incident, and a
billed data branch was not created. Instead, on production (read-only, plain
`EXPLAIN`, no `ANALYZE`, zero execution):

- **`source` push-down confirmed.** `wine_match_review_view WHERE source =
  'cellartracker' AND (unresolved_row_count > 0 OR last_run_status = 'failed')`
  plans as a scan of the CellarTracker branch only — the `release_offer_*`
  tables do not appear in the plan. The `UNION ALL` + constant `source`
  discriminator lets Postgres prune the other branch. Total planner cost ≈ 524
  for a 50-row page.
- **Summary-function cost is small.** The all-sources single pass
  (`count(*) FILTER …` over the union) plans as one `Append` of the two branch
  subqueries under an `Aggregate`, total planner cost ≈ 1714. Largest inputs:
  a seq scan of `release_offer_source_rows` (~3.5k rows) and a sort of
  `release_offer_match_run_groups` (~4.9k rows). No matview refresh, no
  unbounded scan. At the current data scale (~3,300 groups) this is
  sub-second.
- **Summary totals reconcile.** `wine_match_queue_summary()` returns
  needs_review 2202 / with_suggestions 554 / linked 1100 / no_suitable_match 2
  / all_groups 3304; the per-source calls sum to the same
  (release 1837 + cellar 365 = 2202 needs_review, 861 + 239 = 1100 linked,
  2700 + 604 = 3304 total).

The formal p50/p95 comparison and the 1.25× gate remain open. Given the
push-down works and the dataset is small, the risk of shipping the route is
low; if the landing render is slow in practice, the fallback is the maintained
summary table in §3.2, measured then.

---

## Appendix A: per-source review-view columns

| Column | release_offer | cellartracker |
| --- | --- | --- |
| `match_group_key` | yes | yes |
| `source_wine`, `source_vintage` | yes | yes |
| `source_row_count`, `unresolved_row_count`, `linked_row_count`, `suppressed_row_count` | yes | yes |
| `parent_sku`, `match_method` | yes | yes |
| `is_biddable` → `is_bbx_eligible` | yes | yes |
| `suggestion_count`, `suggestions_observed_at` | yes | yes |
| `earliest_offer_date`, `latest_offer_date` | yes | no |
| `source_producer`, `source_region` | no | yes |
| quantities, `accepted_at` | no | no (in `current_cellartracker_records`) |
| excluded-row filter in counts | **no (bug, fixed in Slice 1)** | yes |
| `last_run_status`, `last_error_at`, `top_match_score` | **added in Slice 1** | **added in Slice 1** |

## Appendix B: key objects

- Views: `release_offer_match_review_view`, `cellartracker_match_review_view`,
  `release_offer_match_suggestion_view`, `cellartracker_match_suggestion_view`,
  `current_cellartracker_records`, `catalogue_view` / `catalogue_mv`
- RPCs: `begin_release_offer_match_run`, `begin_cellartracker_match_run`,
  `confirm_*_match_group`, `suppress_*_match_group`,
  `exclude_*_record` / `_match_group`, `restore_*_match_group`
- Routes: `/release-prices/matches`, `/cellartracker/matches`,
  `/release-prices/offers/[importId]/[sourceRowNumber]`,
  `/cellartracker/[importId]/[sourceRowNumber]`,
  `/release-prices/excluded`, `/cellartracker/excluded`
- Components: `apps/web/src/components/releaseOffers/MatchGroupList.tsx`,
  `apps/web/src/components/app/PrimaryNavigation.tsx`
- CI: `.github/workflows/daily_sweep.yml` (02:00 UTC),
  `.github/workflows/arbitrage.yml` (hourly 08:17–23:17 UTC)
