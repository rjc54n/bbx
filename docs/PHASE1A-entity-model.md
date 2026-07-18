# Phase 1A — Entity model & API validation

**Status:** initial validation complete (real API responses captured
2026-07-18); **longitudinal validation pending** (see §4, §5). Enough to start a
*provisional* Phase 1B schema that preserves the open uncertainties.
**Scope:** decide *what* we store. No schema, no storage code — that is 1B.

This document pins down the entities the scan store will track (product / SKU /
offer), keyed to fields that actually exist in the captured fixtures under
[`tests/fixtures/`](../tests/fixtures/), answers the make-or-break question about
stable seller-offer identity, confirms/revises the coverage split, and reconciles
the "what the store does NOT support" list in [`PHASE1.md`](PHASE1.md).

---

## TL;DR (the findings that matter)

1. **A strong candidate per-offer identifier exists** (durability not yet proven
   longitudinally). Every individual seller offer has a numeric id that appears
   in *both* endpoints:
   - Algolia: `purchase_options[].bbx_listing_id` (and the top-level
     `bbx_listing_id` / `objectID`).
   - GraphQL: `variants[].product.listing_id`.

   They are the **same number**. In the multi-offer fixture the four offers are
   `133111, 137028, 164943, 169009` in both endpoints. What this *proves* is
   same-scan cross-source equality and minute-scale continuity; treating the id
   as durable across days / price changes / disappearance / relisting is a
   high-confidence **assumption** still to be validated longitudinally in 1B.
   (Evidence and its limits in [§4](#4-the-make-or-break-stable-offer-identity).)

2. **Three persisted entities, with format inside the SKU key.** Product → SKU
   → offer, where the **format** (case size × bottle volume) is part of the SKU's
   identity, not a fourth stored level. This was the roadmap's real gap: REST
   prices *per format*, one wine has many, so the priced line is
   `(parent_sku, format)` — not `parent_sku`. (See [§3](#3-the-entity-model).)

3. **Offer-level data appears available for the FULL BOOK from Algolia alone**
   (broad coverage not yet proven — see caveats). Each Algolia object carries
   `purchase_options[]`: the offer set for that wine, each with `bbx_listing_id`
   + exact price + format. On the sampled wines this **revises** the roadmap
   premise that offer identity requires a GraphQL page-load, and makes the
   full-book GraphQL sweep unnecessary. Whether it also lets us *drop* GraphQL
   from candidate verification is a separate, unproven question — the answer
   needs a concordance study, not an assumption.
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

**This is three persisted entities, not four.** Format is a component of the
SKU's identity key, not a stored level of its own. A genuine four-level model
would be *wine/cuvée → vintage product → format SKU → offer*, but there is **no
dependable cross-vintage wine identifier** in the data (`parent_sku` already
bakes in the vintage — see §3.1), so the top level cannot be stored without a
separate identity strategy. We therefore keep three entities and treat format as
part of the SKU.

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

2. **Ids *look* creation-stamped and long-lived — but this is inference, not
   proof.** In `algolia_deep_book.json` a single wine (`20158007342`) carries
   live offers spanning `listing_id` `668 .. 168993`: tiny (old) and large (new)
   ids coexist in the *same* book at one instant. Brand-new offers observed that
   day clustered near the top of the range (the freshly-created `169009`). That
   is consistent with "ids are assigned once at creation and persist," which is
   the durability we want — but a single-instant snapshot cannot *prove* an id
   survives a price change, several days, disappearance, or a relisting. **1B
   must confirm this longitudinally** before we rely on "a vanished id = a gone
   offer" or "a new id = a genuinely new offer."

3. **Ids disambiguate same-price offers.** In `algolia_deep_book.json` five
   offers sit at £500 and four at £450, sharing nothing *but* their ids
   (asserted in `test_same_price_offers_stay_separate`). Without `bbx_listing_id`
   these collapse into one; with it, each is separately trackable.

**What this unlocks that the roadmap thought we couldn't have** (conditional on
the durability assumption in point 2 holding up in 1B):

- **Offer days-on-market** — first-seen → last-seen per `bbx_listing_id`. The
  roadmap listed this under "NOT supportable… needs stable seller-offer IDs".
  We now have the ids, so it *becomes* supportable — for whatever coverage we
  scan (see §5) and once durability is confirmed longitudinally.
- **True offer turnover** — the cheapest ask can hold at £250 while the *offer*
  behind it changes (`133111` → `164943`, both £250); tracking ids sees that
  churn that a price-only log misses.

Until that longitudinal check exists, offer-lifetime analytics should be treated
as **provisional** and each observation tagged with a trust/consistency status
(see §5, §9), not published as authoritative.

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

**Revision, from evidence (sampled, not yet proven at index scale): the
full-book Algolia sweep already returns offer-level data for free.** Every
Algolia object we sampled carries `purchase_options[]` — the offer set for that
wine (appearing complete against REST/GraphQL on those wines), each offer with
`bbx_listing_id`, exact price, and format. We get this in the *same* discovery
requests we already pay for; no extra call, and specifically **no GraphQL
page-load**. Broad coverage — one object per `parent_sku` across the whole index,
and `purchase_options[]` completeness — is a caveat below, not yet established.

Consequences (contingent on that coverage holding up):

- **Full book → SKU availability *and* offer-level price/lifetime**, both from
  Algolia + REST. Offer identity is no longer gated behind GraphQL. We can run
  offer days-on-market across the whole book, politely.
- **GraphQL's job shrinks to candidate verification only** — redundant for
  full-book discovery/history, but still the sole live source of order-book depth
  for the `pct_next` check. See the analysis next.

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

So GraphQL is **redundant for offer discovery, identity, and history** — Algolia
covers those. But it is **not** redundant for candidate verification, and an
earlier draft of this doc got that wrong. Here is the correction:

**REST validates only the floor, so it cannot cross-check the second-lowest
price** — and the second-lowest price is exactly what the `pct_next` "headroom to
the next competing ask" threshold depends on. Worked example (the bug that
motivates keeping GraphQL):

```
Candidate floor (REST least_listing_price):  £80   ✓ live
Algolia purchase_options second offer:       £100  → implied headroom 20%
A new £82 offer exists but hasn't reached the Algolia snapshot yet.
REST still reports floor £80; Algolia still reports next £100.
→ REST and Algolia AGREE, both look fine, and we alert "20% headroom"…
   when the true headroom is ~2.4%.
```

REST + Algolia agreeing on the floor tells us nothing about a *stale second
price*, because REST never sees the second price at all. Only GraphQL gives a
**live** reading of order-book **depth** (the 2nd/3rd offers), which is what
`pct_next` and the `OB_CHANGED` guard actually rely on. That is a real,
non-redundant job.

The genuinely open question is narrower: **how often does GraphQL's live depth
actually differ from Algolia's snapshot depth enough to flip a candidate's
verdict?** We don't know. Our one datapoint (§6) showed GraphQL *lagging* Algolia
on a creation event — but the risk that bites is a stale Algolia *second price*,
which we have not measured. Until we have, GraphQL stays.

### 5.2 Recommendation — minimise GraphQL where proven, keep it where it earns its place

Politeness, latency, and simplicity all favour less GraphQL — but only where
evidence shows it is safe. Split by scope:

- **Full book: no GraphQL.** Offer identity / history from Algolia + REST.
  (Never was the plan; now positively unnecessary — this part is settled.)
- **Candidates: keep the Phase-3 GraphQL call for now.** It is the only live
  source of order-book depth, which `pct_next` needs (see the worked example
  above). Dropping it here would be a correctness regression, not a
  simplification. Do **not** replace it with "REST floor + Algolia depth".
- **Then run a concordance study** (not a quick A/B) before changing anything.
  Over a **stratified sample across several days** — sole offers, tied floors,
  deep books, multiple formats — capture REST, Algolia and GraphQL together per
  candidate and measure:
  - offer-id set equality (Algolia vs GraphQL);
  - cheapest **and second-cheapest** price equality;
  - candidate pass/fail disagreement (the decision-relevant metric);
  - direction and duration of propagation lag, split by event type
    (creation / price-change / disappearance).
  Only if the study shows Algolia's depth matches GraphQL closely enough that
  candidate verdicts don't flip may we retire GraphQL from candidate
  verification — and even then, keep it for the final pre-action re-verify on the
  handful of wines a user is about to act on.

The bar is therefore explicit and **evidence-gated**: full-book GraphQL is gone
today; candidate GraphQL stays until a concordance study proves the Algolia
snapshot is a safe substitute for its live depth.

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
| "Seller-offer days-on-market — NOT supportable" | **Provisionally supportable** | `bbx_listing_id` is a strong candidate per-offer id (§4), available full-book via Algolia (§5) — pending longitudinal durability + coverage validation |
| "True liquidity / turnover — invisible" | **Partially supportable** | Offer *churn* (ids appearing/disappearing) is visible; actual *fills* are not |
| "Sold vs. withdrawn — can't distinguish" | **Still unsupported** | No settlement event in anonymised P2P (§4) |
| "Transaction history — lost between scans" | **Still unsupported** | `last_bbx_transaction` is one scalar, not a trade log |
| "Offer identity needs GraphQL / candidate-only" | **Revised** | Offer identity is in Algolia discovery too, so full-book GraphQL is dropped; GraphQL stays for candidate depth verification pending a concordance study (§5.1–5.2) |
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

Proceed with storage, but **preserve the open uncertainties in the model** — do
not bake in claims 1A only made provisionally.

**Entities & keys**

- `products`: `parent_sku` + descriptive fields (§3.1).
- `skus`: key on **`(parent_sku, format)`** (normalised `case_size`,
  `bottle_volume`), plus a nullable child `sku` string. **Stop dropping REST
  `entries[1:]`** — keep every format (§3.2).
- `offers`: key on provider + **`bbx_listing_id`**, linked to a format SKU.
  Treat the id as a *strong candidate* identifier, **not yet proven durable** —
  keep the "new id = new offer / vanished id = gone offer" rule behind the
  longitudinal check (§4). A vanished id is `gone`, never `sold`.
- `source_observations`: one row per (source, scan, entity) with observed time,
  the source's own `index_last_update`, raw identity, and a **trust/consistency
  status**. Store the Algolia snapshot stamp **separately** from the scanner's
  own observed-at time.
- `current_state`: materialised latest state for fast reads.
- `observation_events`: change history derived **only from trusted, complete
  scans**.

**Data-quality rules**

- Store prices as **integer pence / fixed-decimal**, never float (the fixtures
  show values like `41.666666666667` per bottle — round-trip through pence).
- **Do not treat `qty_available` as live offer quantity yet.** The REST fixture
  has positive `qty_available` for formats whose `least_listing_price` is `0`
  (no live offer) — its semantics need separate validation (§3.2).
- Cross-check `min(purchase_options price)` vs REST `least_listing_price` per
  scan; mark the SKU untrusted on disagreement (mirrors `OB_CHANGED`).

**Disappearance / `gone`**

- Require **discovery completeness** (the still-open `fetch_listings` prerequisite)
  **and** two consecutive Algolia misses. Record `gone`, not `sold`. A GraphQL
  disagreement alone must **not** advance the missing counter.

**GraphQL**

- **No full-book GraphQL.** Keep the candidate-verification GraphQL call (it is
  the only live source of order-book *depth* for `pct_next` — §5.1). Retire it
  from candidate verification **only** after the concordance study (§5.2) shows
  the Algolia snapshot doesn't flip candidate verdicts.

**Validation still owed (why this is "initial, not complete")**

- Longitudinal offer-id durability across days / price-changes / disappearance /
  relisting (§4).
- Broad Algolia coverage: one-object-per-`parent_sku` at index scale,
  `purchase_options[]` completeness, offer-id global uniqueness, deep-book
  pagination behaviour when `is_more_variant_available` is `true` (§5, §6).
- The GraphQL-vs-Algolia depth concordance study (§5.2).

**Regression anchors**

- The contract tests in `tests/test_fixtures_contract.py` lock the parse
  invariants above; extend them as the 1B parsers land.
