# Phase 1A — Entity model & API validation

**Status:** validated against real API responses captured 2026-07-18.
**Scope:** decide *what* we store. No schema, no storage code — that is 1B.

This document pins down the entities the scan store will track (product / SKU /
offer), keyed to fields that actually exist in the captured fixtures under
[`tests/fixtures/`](../tests/fixtures/), answers the make-or-break question about
stable seller-offer identity, confirms/revises the coverage split, and reconciles
the "what the store does NOT support" list in [`PHASE1.md`](PHASE1.md).

---

## TL;DR (the findings that matter)

1. **A stable, durable per-offer identifier exists.** Every individual seller
   offer has a numeric id that appears in *both* endpoints:
   - Algolia: `purchase_options[].bbx_listing_id` (and the top-level
     `bbx_listing_id` / `objectID`).
   - GraphQL: `variants[].product.listing_id`.

   They are the **same number**. In the multi-offer fixture the four offers are
   `133111, 137028, 164943, 169009` in both endpoints. This directly answers the
   make-or-break question: **yes**, we can track an individual offer across scans.
   (Evidence and caveats in [§4](#4-the-make-or-break-stable-offer-identity).)

2. **The roadmap conflated four levels, and there really are four.** Product →
   SKU → **format** → offer. The middle "format" split (case size × bottle
   volume) was missing from the roadmap and is load-bearing: REST prices
   *per format*, and one wine can have many. (See [§3](#3-the-entity-model).)

3. **Offer-level data is available for the FULL BOOK from Algolia alone —
   no GraphQL needed.** Each Algolia object already carries
   `purchase_options[]`: the full set of live offers for that wine, each with
   `bbx_listing_id` + exact price + format. This **revises** the roadmap premise
   that offer identity requires a GraphQL page-load, and leaves the Phase-3
   GraphQL call nearly redundant — the recommendation is to **minimise GraphQL**
   (A/B it in 1B, then likely drop it) for politeness, latency, and simplicity.
   (See [§5](#5-coverage-split-revised), esp. [§5.1](#51-is-the-graphql-call-still-pulling-its-weight)–[§5.2](#52-recommendation--minimise-graphql).)

4. **Cross-endpoint eventual consistency is real and observable.** A freshly
   created offer appeared in REST/Algolia minutes before it appeared in GraphQL
   (`gql_order_book_multi_lagging.json`, 3 variants vs the settled 4). The
   pipeline's existing `OB_CHANGED` guard already rejects this state; the store
   must treat a single-scan disagreement as "don't trust", not "offer sold".
   (See [§6](#6-cross-endpoint-consistency-and-fragility).)

---

## 1. Fixtures this is keyed to

All under [`tests/fixtures/`](../tests/fixtures/) (see its `README.md` for the
capture method). Citations below use these paths.

| Fixture | Endpoint | Role |
|---|---|---|
| `algolia_listing_hit.json` | Algolia `prod_product` | `multi_offer` = SKU `20171135668` (4 offers); `sole_offer` = SKU `20158024224` (1 offer) |
| `rest_pricing.json` | `getBiddableCprStock` | 6 SKUs; `20158007342` has 7 formats |
| `gql_order_book_sole.json` | `customProductDetail` | 1 variant |
| `gql_order_book_multi.json` | `customProductDetail` | 4 variants (settled) |
| `gql_order_book_multi_lagging.json` | `customProductDetail` | 3 variants (pre-propagation) |

---

## 2. Vocabulary correction

The roadmap uses "product / SKU / seller-offer / listing" loosely and sometimes
interchangeably. Grounded in the fixtures, the precise terms are:

- **listing** is ambiguous — BBR uses it for an *individual seller offer*
  (`bbx_listing_id`). We retire "listing" as an entity name and say **offer**.
- **SKU** in the roadmap meant "a priced line". The data shows the priced line is
  `(wine, vintage, format)`, not `(wine, vintage)`. We keep **SKU** for the
  priced line and add **product** above it and **offer** below it.

---

## 3. The entity model

```
Product            a wine (producer + cuvée + region), typically vintage-specific
  └─ SKU           product + vintage + FORMAT (case size × bottle volume) = the priced line
       └─ Offer    one seller's ask for that SKU  (bbx_listing_id / listing_id)
```

### 3.1 Product

The wine itself: name, producer, region, colour, grape. Descriptive,
slow-changing. There is no single clean "product id" separate from the SKU
grouping — Algolia keys on `parent_sku`, which already bakes in the vintage.

Fields (all from `algolia_listing_hit.json`, per hit):

| Field | Example | Notes |
|---|---|---|
| `parent_sku` | `20171135668` | Best available product-grouping key (vintage-specific) |
| `name` | `2017 Au Bon Climat, Knox Alexander, Pinot Noir…` | |
| `producer` | `Au Bon Climat` | |
| `region` / `subregion` / `country` | `California` / `North Coast` / `USA` | |
| `colour` | `Red` | |
| `vintage` | `2017` | Integer |
| `grape_varieties` | `["Pinot Noir"]` | |
| `product_url` | `/products-20171135668-…` | Needed for the GraphQL Referer |

> **Fragile:** `parent_sku` groups by vintage, so the same wine across vintages
> is *different* products under this key. That's acceptable for our purposes
> (we price a vintage), but note it if a future "all vintages of X" view is wanted.

### 3.2 SKU (the priced line) — includes FORMAT

**This is the correction the roadmap most needs.** A `parent_sku` is *not* the
unit REST prices. `getBiddableCprStock` returns a **list, one entry per format**:

From `rest_pricing.json`, `20158007342` returns **7 entries**:
`01-03000, 01-06000, 03-01500, 06-00750, 06-01500, 12-00375, 12-00750`
(`format` = `casesize-bottleml`: `06-00750` = 6 × 75 cl; `01-03000` = 1 × 3 L
double-magnum; `12-00375` = 12 × half-bottles). `20138117265` returns 2, most
return 1.

The pipeline today reads only `entries[0]` (`core/pipeline.py`
`fetch_rest_pricing` → `results[sku] = entries[0]`). That is a **known
simplification**: it prices one arbitrary format per wine and silently ignores
the rest. For a *changelog* store this is a correctness issue — a store keyed on
`parent_sku` alone would blend or drop formats. **The store's SKU key must be
`(parent_sku, format)`.** The child `sku` string encodes exactly this:
`2017-`**`06-00750`**`-00-1135668` embeds the format between vintage and the
product code.

SKU fields:

| Field | Source | Example |
|---|---|---|
| `parent_sku` | Algolia / REST batch key | `20158007342` |
| `format` | REST `entry.format` | `06-00750` |
| child `sku` | Algolia `sku` (one representative format only — see below) | `2015-06-00750-00-8007342` |
| `case_size`, `bottle_volume` | Algolia hit / `purchase_options[]` | `6`, `75 cl` |
| `least_listing_price` (ask) | REST `entry.least_listing_price` | `375` |
| `market_price` | REST `entry.market_price` | `372` |
| `last_bbx_transaction` | REST `entry.last_bbx_transaction` | `360` |
| `highest_bid` | REST `entry.highest_bid` | `355` |
| `qty_available` | REST `entry.qty_available` | `1713` |

(Values above are the `06-00750` entry of `20158007342`. Note some of its other
formats have `least_listing_price` = `0` — no live offer, only a bid/market
reference — so "SKU exists" and "SKU has a live offer" are distinct states the
store should keep apart.)

> **Fragile / coverage gap:** Algolia indexes **one object per `parent_sku`** and
> exposes only **one representative format** in its own `sku`/`prices` fields
> (`20158007342`'s Algolia object is `06-00750`, hiding its 6 other formats). So
> Algolia discovery under-counts formats. `purchase_options[]` *does* span
> formats (29 × 6-btl + 1 × 12 × 37.5 cl for that wine), but only for offers of
> that wine. If we want per-format availability for the full book, the authority
> is the **REST** response (all formats), not the Algolia object. Discovery finds
> the wine; REST enumerates its formats.

### 3.3 Offer (the seller ask)

An individual seller's live ask for a SKU. Multiple offers per SKU are normal
(the 30-offer wine `20158007342` has **five** offers at £500, four at £450 —
distinguishable *only* by id).

| Field | Algolia (`purchase_options[]`) | GraphQL (`variants[].product`) |
|---|---|---|
| **offer id** | `bbx_listing_id` | `listing_id` (same value) |
| price/case (exact) | `prices.price_per_case_exact` | `custom_prices.price_per_case.amount.value` |
| price/bottle | — | `custom_prices.price_value.amount.value` |
| case size | `case_size` | `attributes[]` `case_order_unit` + `stock_data.qty` |
| bottle volume | `bottle_volume` | `attributes[]` `bottle_volume` |
| stock | — | `stock_data` `{case_qty, qty, stock_status}` + `stock_status` |
| in-bond / duty | `purchase_mode` (`In Bond`) | payload filters to `IN_BOND` |

`ext_listing_id` is present in GraphQL but was `0` for every captured offer —
**not** a usable identity field here.

---

## 4. The make-or-break: stable offer identity

**Question:** does the public order book expose a stable, durable identifier for
an individual seller's offer that we can track across scans?

**Answer: YES.** `bbx_listing_id` (Algolia) ≡ `listing_id` (GraphQL).

Evidence:

1. **Same ids, both endpoints, back-to-back.** For `20171135668` the offer set
   is `{133111, 137028, 164943, 169009}` in Algolia `purchase_options[].bbx_listing_id`
   **and** in GraphQL `variants[].product.listing_id` — exact match, no id in one
   endpoint missing from the other after propagation settled.
   (`algolia_listing_hit.json` `multi_offer` vs `gql_order_book_multi.json`.)

2. **Ids are assigned once, at offer creation, and persist.** They are
   monotonic integers: today's brand-new offers occupy `168201–169009`
   (the whole "new to BBX, 1 day" window), while long-standing offers on the same
   wines carry small ids (`668` is still live on `20158007342`). A monotonic
   creation-stamped integer that survives from id 668 to 169009 is exactly the
   durable handle we need: an offer keeps its id for its whole life, and a
   *new* id is a genuinely new offer.

3. **Ids disambiguate same-price offers.** Five offers at £500 on one wine share
   nothing *but* their ids. Without `bbx_listing_id` these are indistinguishable;
   with it, each has a trackable lifetime.

**What this unlocks that the roadmap thought we couldn't have:**

- **Offer days-on-market** — first-seen → last-seen per `bbx_listing_id`. The
  roadmap listed this under "NOT supportable… needs stable seller-offer IDs".
  We have the ids, so it *is* supportable (for whatever coverage we scan — see §5).
- **True offer turnover** — the cheapest ask can hold at £250 while the *offer*
  behind it changes (`133111` → `164943`, both £250); tracking ids sees that
  churn that a price-only log misses.

**What it still does NOT unlock (unchanged from the roadmap):**

- **Sold vs. withdrawn.** An id disappearing means the offer is *gone*. BBX is
  anonymised P2P and exposes no fill/settlement event, so we cannot prove a
  disappearance was a sale rather than a cancellation. `last_bbx_transaction`
  (§3.2) is a single scalar "latest price seen", not a trade log; trades between
  scans and repeat trades at one price remain invisible.

So the honest framing: **we can track offer *identity and lifetime*, but not
offer *outcome*.** "Offer 164943 was in the book 14 Jul–17 Jul, then gone" is
provable; "offer 164943 sold" is not.

---

## 5. Coverage split (revised)

The roadmap's split:

> - Full book (~15k) → SKU-level *availability* only, REST-only daily sweep.
> - Candidate subset → seller-offer detail via GraphQL.

**Revision, from evidence: the full-book Algolia sweep already returns
offer-level data for free.** Every Algolia object carries `purchase_options[]` —
the complete live-offer set for that wine, each offer with `bbx_listing_id`,
exact price, and format. We get this in the *same* discovery requests we already
pay for; no extra call, and specifically **no GraphQL page-load**.

Consequences:

- **Full book → SKU availability *and* offer-level price/lifetime**, both from
  Algolia + REST. Offer identity is no longer gated behind GraphQL. We can run
  offer days-on-market across the whole book, politely.
- **GraphQL's job shrinks to almost nothing** — see the redundancy analysis next.

Two honest caveats that keep this from being a free lunch:

1. **Format coverage in discovery.** Algolia objects expose one representative
   format each (§3.2); full per-format availability needs the REST list. The
   daily REST sweep already fetches pricing, so extending it to keep *all*
   `entries` (not just `entries[0]`) closes this — a 1B change, flagged here.
2. **`purchase_options` completeness is not independently proven.** It matched
   REST's `least_listing_price` and GraphQL's settled variant set in our
   fixtures, which is reassuring, but it is one unversioned field. 1B should
   cross-check `min(purchase_options price)` against REST `least_listing_price`
   per scan and mark the SKU untrusted on disagreement (mirroring the existing
   `OB_CHANGED` guard).

Politeness verdict: **unchanged and still satisfied.** We are *not* adding
GraphQL at full-book scale. We are reading a field Algolia already returns.

### 5.1 Is the GraphQL call still pulling its weight?

Once Algolia gives us the full offer set, it is worth asking directly whether the
Phase-3 GraphQL page-load earns its cost. Three sources, on the two axes that
matter:

| Source | Full order-book **depth**? | **Live** (transactional backend)? | Offer **identity**? |
|---|---|---|---|
| REST `getBiddableCprStock` | ❌ floor only (`least_listing_price`) | ✅ live | ❌ |
| Algolia `purchase_options[]` | ✅ every offer | ❌ **snapshot** (`index_last_update`, ~2 h stale in our capture) | ✅ `bbx_listing_id` |
| GraphQL `customProductDetail` | ✅ every offer | ✅ backend | ✅ `listing_id` |

The **per-offer field delta is thin**: everything GraphQL carries — id, price/case,
format, `sale_by_case_only` — is already in Algolia `purchase_options[]`. GraphQL
*uniquely* adds only per-offer `stock_status` / `stock_data.qty` (and per-bottle
price, which is just price ÷ `case_size`). For BBX that is low value: an offer is
typically one case.

So GraphQL is **redundant for everything the pipeline currently uses it for**
except one thing: it is the only source of full order-book **depth drawn from the
transactional backend** rather than the Algolia search snapshot. That only matters
for the `pct_next` "headroom to the next-lowest competing ask" test and the
`OB_CHANGED` cross-check — and only *if* we don't trust Algolia's freshness at the
moment of acting.

Two things weaken even that residual value:

- **The freshness edge is unproven, and our one observation went the other way.**
  GraphQL *lagged* Algolia on the new offer `169009` (§6). That was creation
  propagation; the freshness risk we actually care about is offer *disappearance*
  (the £680→£950 "gone" case), where we have no evidence GraphQL beats Algolia.
  Both are cached; neither is instant.
- **The `OB_CHANGED` cross-check doesn't need GraphQL specifically.** Its value is
  comparing the REST floor to an *independent* depth source. Algolia is an
  independent system too, so REST-vs-Algolia is still a real cross-check.

### 5.2 Recommendation — minimise GraphQL

Politeness, latency, and simplicity all point the same way: **use GraphQL as
little as possible.** Concretely:

- **Full book:** offer identity / history / depth from Algolia + REST. **No
  GraphQL.** (Never was the plan; now positively unnecessary.)
- **Candidates:** treat the Phase-3 GraphQL call as **on probation, not load-bearing.**
  The freshness re-check before alerting can be served by a live REST floor plus
  Algolia depth. Before committing to that in 1B, run a cheap A/B over N
  candidates comparing three depth pictures — REST floor, Algolia
  `purchase_options`, GraphQL variants — and measure how often GraphQL disagrees
  with Algolia by more than `_ask_match_tol`. If disagreement is rare, **drop the
  GraphQL call entirely** and the pipeline simplifies to **Algolia + REST**: one
  fewer endpoint, no per-candidate product-page GET + POST, and the politest
  footprint of the three designs.
- If the A/B shows GraphQL *does* catch disappearances Algolia misses, keep it
  **only** for the final pre-action re-verify on the handful of wines a user is
  about to act on — not for scanning.

The bar for keeping GraphQL is therefore explicit: it survives only if measured
evidence shows its backend-sourced depth beats the Algolia snapshot on offer
*disappearance* often enough to matter. Absent that, 1B should remove it.

---

## 6. Cross-endpoint consistency and fragility

**Eventual consistency is real.** `gql_order_book_multi_lagging.json` was
captured minutes before `gql_order_book_multi.json`: the newly-created £240 offer
`169009` was already in REST (`least_listing_price` = 240) and Algolia, but not
yet in GraphQL (3 variants, `is_more_variant_available: false`). Ten minutes
later GraphQL had all 4. So:

- A single scan can catch endpoints mid-disagreement, especially for
  same-day-new offers.
- The store must **never** infer "offer sold/withdrawn" from one scan's
  disagreement. Offer disappearance requires confirmation across scans
  (`PHASE1.md` already proposes *two consecutive misses* before `gone` — apply
  the same to offer-level `gone`).
- The pipeline's `classify_order_book` already turns this into `OB_CHANGED` and
  rejects it. That behaviour is correct and should carry into the writer: an
  `OB_CHANGED`/disagreeing scan contributes availability, **not** offer-outcome
  signal.

Other fragilities to record (all unversioned internal APIs):

- Field names (`bbx_listing_id`, `least_listing_price`,
  `custom_prices.price_per_case.amount.value`, `purchase_options`) can change
  without notice. The fixtures are the regression anchor.
- `hybris_bbx_listing_id` is present but empty (`""`) throughout — ignore it.
- `ext_listing_id` is `0` throughout — not an identity field.
- Algolia `objectID` equals the *representative* offer's `bbx_listing_id`, which
  is not stable across time (a cheaper new offer can become the representative).
  Do **not** key products on `objectID`; key on `parent_sku`.
- GraphQL `is_more_variant_available` was `false` in all captures; we have not
  observed a paginated order book, so we cannot confirm how pagination behaves if
  it is ever `true`. Flag for 1B if a very deep book appears.

---

## 7. Minimal fields per entity → API source

The store's minimum viable columns, each mapped to where it comes from.

**Product** (slow-changing; Algolia discovery):
`parent_sku` (key), `name`, `producer`, `region`, `subregion`, `country`,
`colour`, `vintage`, `grape_varieties`, `product_url`.

**SKU** = `(parent_sku, format)` (priced line; REST authoritative for formats):
`parent_sku`, `format`, `case_size`, `bottle_volume`,
`least_listing_price` (ask), `market_price`, `last_bbx_transaction`,
`highest_bid`, `qty_available`.

**Offer** (seller ask; Algolia `purchase_options[]` for the full book, GraphQL
for candidates):
`bbx_listing_id` (key), `parent_sku`, `format` (`case_size`+`bottle_volume`),
`price_per_case_exact`, and — candidate-only, from GraphQL — `stock_status`,
`stock_data.qty`, per-bottle price.

**Scan bookkeeping** (`scan_runs`, already produced by `ScanOutcome`): scope,
timestamps, `expected/queried/priced/failed` counts, `coverage`, status — plus
the still-open **discovery completeness** field (`PHASE1.md` 1B prerequisite;
separate from pricing coverage).

Everything appended to `observation_events` carries its `scan_runs` id so
"unchanged" is distinguishable from "not observed".

---

## 8. Reconciliation with `PHASE1.md` "what the store does NOT support"

`PHASE1.md` split capabilities into "supportable from SKU-level" and "NOT
supportable… needs stable seller-offer IDs". The evidence moves items across that
line. Proposed reconciliation (to fold into `PHASE1.md` when 1B lands):

| `PHASE1.md` claim | Verdict after 1A | Why |
|---|---|---|
| "Seller-offer days-on-market — NOT supportable" | **Now supportable** | `bbx_listing_id` is a durable per-offer id (§4); available full-book via Algolia (§5) |
| "True liquidity / turnover — invisible" | **Partially supportable** | Offer *churn* (ids appearing/disappearing) is visible; actual *fills* are not |
| "Sold vs. withdrawn — can't distinguish" | **Still unsupported** | No settlement event in anonymised P2P (§4) |
| "Transaction history — lost between scans" | **Still unsupported** | `last_bbx_transaction` is one scalar, not a trade log |
| "Offer identity needs GraphQL / candidate-only" | **Revised** | Offer identity is in Algolia discovery too; GraphQL is now near-redundant and a candidate for removal (§5.1–5.2) |
| SKU availability, observed reference-price changes, ask-change dedup | **Confirmed** | Directly from REST fields per scan |

New unsupported/limitations surfaced by 1A (were not in `PHASE1.md`):

- **Per-format availability requires keeping all REST `entries`**, not
  `entries[0]`. Until 1B does this, availability is one-format-per-wine.
- **Cross-endpoint propagation lag** means offer-outcome inference needs
  multi-scan confirmation, never a single scan.
- **`purchase_options` completeness is assumed, not proven** — cross-check
  against REST floor each scan.

---

## 9. What 1B should carry forward (hand-off checklist)

- Key the SKU entity on **`(parent_sku, format)`**; stop dropping REST
  `entries[1:]`.
- Key the offer entity on **`bbx_listing_id`**; treat it as durable; a new id =
  new offer, a vanished id = offer gone (not sold).
- Source offers full-book from Algolia `purchase_options[]`. **Minimise GraphQL**
  (§5.1–5.2): A/B GraphQL depth vs Algolia depth over N candidates, and if
  disagreement is rare, drop the Phase-3 call so the pipeline is Algolia + REST.
  Keep GraphQL at most for a final pre-action re-verify, never for scanning.
- Never emit offer/SKU `gone` from a single scan or a scan with endpoint
  disagreement; require two consecutive misses **and** discovery completeness.
- Cross-check `min(purchase_options price)` vs REST `least_listing_price` per
  scan; mark untrusted on disagreement.
- Keep the fixtures as regression anchors for the parse paths above.
