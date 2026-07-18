# API fixtures (Phase 1A)

Real BBX API responses captured **2026-07-18** to validate the Phase 1A entity
model (`docs/PHASE1A-entity-model.md`). Prices, not secrets — but eyeballed
before committing (no tokens/cookies/account ids).

Captured with the existing helpers (`core.fetch_listings`,
`core.pipeline.fetch_rest_pricing` / `_fetch_rest_batch`,
`core.fetch_bbx_variants.fetch_bbx_listing_variants`) against the live endpoints,
a handful of requests over one session. Per-response provenance (UTC times,
filters, capture order, `index_last_update`) is in
[`MANIFEST.json`](MANIFEST.json). Reproduce with
[`scripts/capture_phase1a_fixtures.py`](../../scripts/capture_phase1a_fixtures.py)
(hits live APIs; the live order book will have drifted from these snapshots).

| Fixture | Source endpoint | What it shows |
|---|---|---|
| `algolia_listing_hit.json` | Algolia `prod_product` | One object per `parent_sku`; `purchase_options[]` enumerates every live seller offer (across formats), each with its own `bbx_listing_id` + exact price. Includes a multi-offer and a sole-offer wine. `_highlightResult` (search-highlight noise) stripped. |
| `algolia_deep_book.json` | Algolia `prod_product` | Deep book: `20158007342` with 30 offers, `listing_id` range 668..168993, and prices shared by multiple offers (5 at £500) — evidences same-price disambiguation and old/new id coexistence. |
| `rest_pricing.json` | `getBiddableCprStock` | Raw batch for 6 `parent_sku`s. Each maps to a **list, one entry per format** (`format` = `casesize-bottleml`, e.g. `06-00750`). `20158007342` has 7 formats. Fields: `least_listing_price`, `market_price`, `last_bbx_transaction`, `highest_bid`, `qty_available`, `has_already_bidded`. |
| `gql_order_book_sole.json` | `customProductDetail` | Sole-seller SKU `20158024224`: 1 variant. |
| `gql_order_book_multi.json` | `customProductDetail` | Multi-offer SKU `20171135668`: 4 variants, each `product.listing_id` matching an Algolia `bbx_listing_id`. Two offers share £250 (distinct only by `listing_id`). |
| `gql_order_book_multi_lagging.json` | `customProductDetail` | Same SKU captured minutes earlier, **before** the newly-created £240 offer (`listing_id` 169009) had propagated to GraphQL — 3 variants instead of 4. A real cross-endpoint eventual-consistency artifact; kept as a regression fixture. |

The key identity finding: **GraphQL `variants[].product.listing_id` == Algolia
`purchase_options[].bbx_listing_id`**. These fixtures prove *same-time
cross-source equality* and *minute-scale continuity* — a strong candidate offer
id. They do **not** prove durability across days / price changes / disappearance
/ relisting; that is longitudinal work for Phase 1B. See the design doc.

These are unversioned internal APIs; field names may change without notice. The
contract tests in [`tests/test_fixtures_contract.py`](../test_fixtures_contract.py)
assert the parse invariants these fixtures anchor.
