# Roadmap: revised 24 July 2026

## Purpose

**This is a tool for running a drinking cellar for pleasure. Trading exists to
fund the drinking.** Every feature is judged against that order. A signal that
finds a profitable trade in a wine we would never drink and cannot easily exit
is worth less than one that keeps the cellar stocked with wine we want to open.

The original framing — hunt arbitrage on BBX — was too narrow, and the premise
was half wrong: new listings are usually well-informed, because sellers price
off the same references we do. The work below is built on a different premise,
established by measurement this session: **the reference everyone anchors to is
structurally wrong in specific, predictable places.** That is a durable edge,
not a transient one.

---

## Findings this roadmap is built on

All measured on 23 July 2026. See `docs/EVIDENCE-2026-07.md` for method.

1. **BBX `market_price` is identical to the Liv-ex market price** — exactly
   equal on 115/115 cellar holdings. Liv-ex is therefore not an independent
   cross-check; it is the anchor every BBX seller already uses, and the 20%
   minimum-bid floor is a Liv-ex floor.
2. **That guide is purely volume-linear across formats** — a constant £/litre
   per wine, so it prices a magnum and a half-bottle at the same rate as a
   standard bottle. BBR's own release offers show the real premiums:

   | format | median premium over bottle £/litre | n |
   |---|---|---|
   | half bottle | +3.1% | 140 |
   | magnum | +3.1% | 423 |
   | double magnum | +17.8% | 220 |
   | imperial / methuselah | +10.9% | 200 |
   | salmanazar | +14.3% | 81 |

   The guide assumes +0.0% for all of them.
3. **The biddable universe is 52,430 products** in a separate Algolia index
   (`prod_biddable`), against the **27,142 active SKU rows (15,483 distinct
   wines) currently tracked** — the store's existing scope, confirmed live
   2026-07-23 — so `prod_biddable` is roughly the current book's scale again
   in wines we don't yet track at all. REST returns full pricing for unlisted
   wines, so the minimum-bid floor is computable across the whole book.
   Already, **9,592 of today's 27,142 tracked SKU rows have no ask** —
   unlisted formats of wines that do have some listing. "Available to bid" is
   not a new database entity: it's this same shape (products → skus with no
   offer), just far more of it once discovery widens.
4. **Algolia can do almost everything** — discovery, metadata, listing prices
   (`bbx_listings[].price_per_case_exact`), per-record change detection
   (`index_last_update`), and entity resolution (~78% of historic offer names
   resolve to a same-vintage product). It is arms-length and built for the load.
5. **REST is the scarce resource** and the one politeness constraint that binds.
   It uniquely holds guide price, highest bid, last transaction and quantity.
   Batch size caps at ~98 product codes, not the 24 currently used.
6. **Release prices anchor bids.** Sellers anchor on what they paid and
   discount accrued storage. Ducru-Beaucaillou 2010 was re-offered by BBR in
   January 2026 at £894/6 against a £870 original — sixteen years for +2.8%
   nominal, before storage.

---

## Phases

### Phase 3 — Format-basis correction

**No new data, no new API load.** The highest value per unit of effort in the
project, and it re-ranks everything later phases surface.

- Format premium curve as a stored lookup; `adjusted_guide_p` and
  `price_vs_adjusted_guide_pct` in the read model.
- Per-bottle and per-litre normalisation columns — required to compare across
  case sizes and regions at all, and a prerequisite for the cellar views.
- Surface both in the catalogue browser, labelled as a modelled correction.

**Unlocks:** large-format listings priced "at market" are identifiably cheap;
the bid floor on those formats is anchored 10–18% low, which is more legal bid
room exactly where the asset is most under-priced.

### Phase 4 — The biddable universe

Grows the addressable catalogue from the 15,483 wines currently tracked to
52,430.

- Ingest `prod_biddable` with sharded discovery (region → vintage → colour →
  maturity; live-verified 2026-07-23 that three dimensions alone truncated
  several Burgundy vintage/colour leaf shards).
- Raise `REST_BATCH_SIZE` 24 → 96. Fewer requests for the same data.
- **Wave pricing**, not brute force, for the *unlisted* tier only: a daily
  delta driven by Algolia's `index_last_update` (~19 calls) plus a 1/30th
  rotation (~18 calls) — call this the **incremental wave cost**, ~40/day.
  The **listed tier is always fully priced regardless**, which an earlier
  pass of this doc conflated with the total: at today's book size
  (~15,483 listed parent_skus) that's ~161 more calls/day on its own, every
  day, forever — so **total steady-state cost is ~180–200 calls/day, not
  ~40.** `biddable_full_book` is the permanent successor to the legacy
  `full_book` run scope. Its first completed run is a resumable baseline:
  every discovered parent must have a successful REST check recorded in
  `products.last_rest_checked_at`. Failed parents remain `NULL` and are
  retried on the next dispatch. Built, tested, and
  **wired into `run_daily_sweep`** 2026-07-24 (`select_biddable_rest_pricing`;
  discovery swapped from `prod_product` to `prod_biddable`, REST pricing
  tiered by listed/unlisted). After the baseline, unlisted parents are
  selected by rotation, enabled delta selection, or missing/stale REST
  freshness (more than 30 days). Newly discovered parents are therefore
  checked immediately rather than waiting for their rotation day. Delta
  selection stays off by default
  (`WAVE_PRICING_DELTA_ENABLED`) pending the week-long verification the plan
  calls for — see docs/PHASE3-4-IMPLEMENTATION.md Step 6. **Measured across
  three manual `workflow_dispatch` runs, 2026-07-24:** discovery came back
  **identical all three times** — 51,492/52,107 expected `prod_biddable`
  hits. Three live crawls, each 10+ minutes apart, returning a bit-for-bit
  identical shortfall rules out transient index drift; treated as a
  reproducible, structural ~1.2% gap in the sharded discovery. Root cause
  not yet found — **deliberately deferred as a non-blocker**, see below.
  REST on run 1: all 51,492 discovered parents checked successfully
  (~536 batches at batch size 96, close to the ~547-call estimate), 0
  failures, 0 rate-limit (429) responses, REST phase ~6m, full run 18m —
  comfortably inside the 90-minute timeout. **Two real bugs surfaced by
  the discovery gap being reproducible, both fixed same-day:** run 2
  skipped REST pricing entirely, including the always-priced listed tier,
  because the resumable-baseline selection didn't union in
  `listed_parent_skus` while a baseline stayed pending. Fixing that exposed
  a second, larger issue: "baseline pending" was gated on a *completed*
  scan_run existing for this scope, which can never happen while discovery
  stays incomplete — meaning unlisted-tier wave-pricing rotation would have
  been permanently dead code in production, not merely delayed. Both fixed
  by decoupling backfill/wave-pricing selection from `algolia_complete`
  entirely, driving it off live per-parent REST freshness instead — see
  docs/PHASE3-4-IMPLEMENTATION.md Step 6 for detail and regression tests.
  **Why the discovery gap itself is safe to defer:** with that decoupling
  in place, a persistent ~1.2% Algolia shortfall no longer blocks REST
  pricing, wave-pricing rotation, or delta selection from operating
  normally on the ~98.8% it does find — it only means ~615 parents stay
  undiscovered until the sharding root cause is found. Separately, 170
  pre-Phase-4 products (tracked under the legacy `full_book` scope) don't
  appear in `prod_biddable` at all and so can never get a
  `biddable_full_book` REST check — expected, since they're stock that has
  left the biddable universe; the existing miss-counting disappearance
  logic will mark them `gone_since` in the ordinary course rather than
  leaving them stuck.
- Model unlisted-but-biddable SKUs as first-class: `skus.is_listed`, a real
  stored column (not a new entity) — **built 2026-07-24**, derived from
  Algolia discovery every run independent of REST tiering, specifically
  because the obvious alternative (`ask IS NOT NULL`) goes stale for up to
  30 days under wave pricing (external review caught this before Step 7 was
  built on top of it).
- Split "Explore catalogue" from "live listings" via a **checkbox filter**
  (`is_listed`) — **shipped 2026-07-24** (Step 7, docs/PHASE3-4-IMPLEMENTATION.md).
  "Only listed wines" next to the format-adjusted toggle, wired as a real,
  URL-serialized filter (not component-local display state). **Defaults to
  the whole biddable catalogue, not live-listings-only** — a direct product
  decision overriding the original spec's "default to live listings" call
  on the same day it shipped; the staleness/completeness concern that
  motivated that original default is instead addressed by the "Listed"
  column, shown by default, which makes unlisted rows visibly distinct
  rather than hiding them. Verified live: 68,575 rows by default, 18,338
  with "Only listed wines" checked (matches the live listed-row count),
  URL round-trips through a fresh page load. The "Listed" column itself
  wasn't in the original spec either — added because rows would otherwise
  be indistinguishable once unlisted rows are the default view.

**Unlocks:** the part of the market with no competing seller and therefore no
competing price anchor. This is where the guide being wrong actually pays.

### Phase 5: Cellar holdings and history

The point of the whole exercise.

**Product decision, 25 July 2026:** BBX is a single-owner, single-cellar
application. It requires one secure Supabase Auth identity and owner-only RLS,
but does not support registration, separate user cellars, invitations or
sharing. Personal tables do not carry unused tenant columns. See
`ADR-001-single-owner-application.md` and `PHASE5-IMPLEMENTATION.md`.

- Upload the current BBR holdings CSV and maintain it in the backend as a
  dated source snapshot. `Parent ID` joins straight to `parent_sku`, so no
  entity resolution is required for matched BBR rows. Preserve each import's
  source file, imported-at time and row-level provenance rather than replacing
  the previous upload without an audit trail.
- Upload the CellarTracker all-time history and normalise its records into a
  lifetime cellar ledger. It must distinguish purchased, held remotely,
  physically in stock and consumed wine. Preserve unmatched source rows so
  they can be resolved later without losing their original names or history.
- Keep source responsibilities explicit. BBR is the current source for wine
  held with BBR. CellarTracker supplies lifetime purchase, movement, stock and
  consumption history, including wine held elsewhere or at home. Reconcile
  overlapping records; do not silently add both sources together or let one
  overwrite the other.
- Maintain a backend current-holdings projection from the imported evidence,
  with source, location, quantity, format and last-confirmed time visible.
  Repeated uploads must be idempotent and must report additions, removals,
  quantity changes, unmatched rows and source conflicts before updating the
  current view.
- Drinking windows, maturity, per-region and per-vintage concentration.
- **Drink-now view:** what is at best or closing, how many bottles, and what is
  under-drunk relative to its window.
- **Gap view:** what the cellar lacks for near-term drinking, which becomes the
  buy list that Phases 3–4 are searched against.

**Unlocks:** one backend record of what has been bought, where it is now and
what has been consumed. Catalogue opportunities can then be judged against the
actual cellar rather than market data alone.

### Phase 6: Wishlists and favourites

- Favourites record wines we actively value, independent of whether we intend
  to buy them now. Preserve notes and preferred formats.
- Wishlists record purchase intent: desired quantity, acceptable formats,
  priority and the cellar gap the wine would fill.
- A wine may be a favourite without being on a wishlist, and a practical gap
  substitute may be on a wishlist without being a favourite. Keep those
  meanings separate.
- Saved catalogue queries can feed candidate lists, but adding or removing a
  wine remains an explicit user action.

**Unlocks:** catalogue ranking can distinguish personal preference from an
actual cellar requirement.

### Phase 7: Release-price connector

Value is in **anchoring bids on purchases**, not in P&L on existing holdings.

- Gmail connector, incremental, replacing the one-off Takeout extraction.
- Extract one row per `(offer_date, wine, format)`. 696 of 3,288 rows price
  multiple formats in one string and that content is the format-premium signal.
- Algolia resolution at ingest, storing `parent_sku`, a confidence score and
  the raw name, so unmatched rows stay queryable and can be re-resolved.
- Distinguish release from re-offer by offer date versus vintage.
- Use CellarTracker purchase history as evidence of what we paid. Use release
  emails as evidence of what was offered to the market. Do not collapse those
  into one price type.

**Unlocks:** bid anchoring. The seller's mental floor is what they paid, and
they discount accrued storage; knowing the release price tells us where that
floor sits.

### Phase 8: Strategies

- Store named, versioned strategies that combine cellar state, favourites,
  wishlists and catalogue evidence. The inputs, rules and exclusions must be
  inspectable; a strategy cannot be an unexplained score.
- Initial strategies should cover drink-now selection, cellar-gap buying,
  bid candidates and rotation funding.
- Bid strategy uses a ladder per wine: guide, adjusted guide, ask, highest
  bid, last transaction, purchase or release anchor and minimum legal bid
  (0.8 x guide; verify against the site before building on it).
- Sell strategy remains a rotation-funding list, not a trigger: appreciated,
  outside its drinking window or over-supplied, in an over-weight region and
  carrying a live bid. Never a bare "bid exceeds market" signal.
- Saved queries and strategies may produce alerts. Every candidate must show
  the evidence and rule that selected it.

**Unlocks:** repeatable decisions that can be reviewed, compared and improved
without hiding judgement inside UI code or an agent prompt.

### Phase 9: Agents

- Add an agent tool surface over holdings, history, favourites, wishlists,
  strategies and the existing `QueryState` registry seam.
- Start read-only: answer cellar questions, explain strategy results, find
  source conflicts and prepare proposed changes.
- Later write access may maintain favourites, wishlists and strategy drafts
  with explicit user confirmation and an audit record.
- Bids are **proposed, never placed.** A BBX bid is a binding commitment to
  buy. Human confirmation is permanent.

**Unlocks:** agents can apply the user's stored data and strategies without
becoming the source of truth or gaining authority to trade.

---

## Backlog (not blocking current work)

- **`prod_biddable` sharded discovery undercounts by ~615 hits (~1.2%),
  reproducibly.** Four consecutive live `biddable_full_book` runs on
  2026-07-24 all collected exactly 51,492 of an expected 52,107 hits —
  identical across runs 10+ minutes apart, which rules out index drift.
  `truncated=True` has never fired, so it isn't the 1,000-hit pagination
  cap; the likely candidate is a facet value the recursive NOT-filter
  catch-all in `core/fetch_listings.py` isn't reaching. Root-causing it
  needs a `parent_sku`-level diff between two runs' collected hits, not
  just counts — nobody has done that yet. **Not urgent:** as of
  2026-07-24, backfill and wave-pricing selection were decoupled from
  `algolia_complete` specifically so this gap can't block REST pricing or
  rotation (see Phase 4 above) — it only means ~615 parents stay
  undiscovered until this is fixed. One side effect worth remembering: as
  long as this gap persists, `scan_runs.status` for `biddable_full_book`
  will read `partial` on every run, forever — that's the discovery gap
  showing through, not a sign anything is broken.

## Standing constraints

- Algolia may be queried freely. REST is rationed — delta and rotation only,
  never a full daily sweep.
- Never present Liv-ex as corroborating a BBX guide price. They are one number.
- Every derived metric carries its provenance: observed, stored estimate, or
  modelled correction.
- Drinkability is the downside backstop. A wine that will not trade must be one
  we are happy to open.
