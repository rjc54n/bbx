# Roadmap — revised 23 July 2026

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
- **Wave pricing**, not brute force: one-time full backfill (~535 REST calls),
  then a daily delta driven by Algolia's `index_last_update` (~19 calls) plus a
  1/30th background rotation (~18 calls). Roughly 40 REST calls a day at steady
  state against 535 for a naive daily sweep.
- Model unlisted-but-biddable SKUs as first-class: an `is_listed` flag on the
  existing `skus`/`catalogue_view` shape, not a new entity (see box above).
- Split "Explore catalogue" from "live listings" via a **checkbox filter**
  (`is_listed`), not a separate mode or tab — the same widget as the
  format-adjusted-values toggle, but wired as a real filter (URL-serialized,
  affects returned rows) rather than component-local display state, since
  unlike that toggle this one changes which wines appear at all. Needed
  because the unlisted share jumps from today's minority (9,592/27,142) to
  the large majority the moment `prod_biddable` lands.

**Unlocks:** the part of the market with no competing seller and therefore no
competing price anchor. This is where the guide being wrong actually pays.

### Phase 5 — The cellar

The point of the whole exercise.

- Import BBR cellar CSV. `Parent ID` joins straight to `parent_sku` — no
  entity resolution required.
- Drinking windows, maturity, per-region and per-vintage concentration.
- **Drink-now view:** what is at best or closing, how many bottles, and what is
  under-drunk relative to its window.
- **Gap view:** what the cellar lacks for near-term drinking, which becomes the
  buy list that Phases 3–4 are searched against.

### Phase 6 — Bid engine

- Bid ladder per wine: guide, adjusted guide, ask, highest bid, last
  transaction, minimum legal bid (0.8 × guide — **verify against the site
  before building on it**).
- Watchlists and saved queries promoted to alerts.
- Sell side stays a *rotation-funding list*, not a trigger: appreciated, plus
  outside its drinking window or over-supplied, plus in an over-weight region,
  plus carrying a live bid. Never a bare "bid exceeds market" signal.

### Phase 7 — Release-price connector

Value is in **anchoring bids on purchases**, not in P&L on existing holdings.

- Gmail connector, incremental, replacing the one-off Takeout extraction.
- Extract one row per `(offer_date, wine, format)` — 696 of 3,288 rows price
  multiple formats in one string and that content is the format-premium signal.
- Algolia resolution at ingest, storing `parent_sku`, a confidence score and
  the raw name, so unmatched rows stay queryable and can be re-resolved.
- Distinguish release from re-offer by offer date versus vintage.

**Unlocks:** bid anchoring. The seller's mental floor is what they paid, and
they discount accrued storage; knowing the release price tells us where that
floor sits.

### Phase 8 — Agentic

- Read-only tool surface over the existing `QueryState` + registry seam.
- Bids are **proposed, never placed.** A BBX bid is a binding commitment to
  buy. Human confirmation is a permanent requirement, not a starting posture.

---

## Standing constraints

- Algolia may be queried freely. REST is rationed — delta and rotation only,
  never a full daily sweep.
- Never present Liv-ex as corroborating a BBX guide price. They are one number.
- Every derived metric carries its provenance: observed, stored estimate, or
  modelled correction.
- Drinkability is the downside backstop. A wine that will not trade must be one
  we are happy to open.
