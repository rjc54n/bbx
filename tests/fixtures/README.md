# API fixtures (Phase 1A)

Real BBX API responses captured **2026-07-18** to validate the Phase 1A entity
model (`docs/PHASE1A-entity-model.md`). Prices, not secrets — but eyeballed
before committing (no tokens/cookies/account ids).

Captured with the existing helpers (`core.fetch_listings`,
`core.pipeline.fetch_rest_pricing` / `_fetch_rest_batch`,
`core.fetch_bbx_variants.fetch_bbx_listing_variants`) against the live endpoints,
a handful of requests over one session.

| Fixture | Source endpoint | What it shows |
|---|---|---|
| `algolia_listing_hit.json` | Algolia `prod_product` | One object per `parent_sku`; `purchase_options[]` enumerates every live seller offer (across formats), each with its own `bbx_listing_id` + exact price. Includes a multi-offer and a sole-offer wine. `_highlightResult` (search-highlight noise) stripped. |
| `rest_pricing.json` | `getBiddableCprStock` | Raw batch for 6 `parent_sku`s. Each maps to a **list, one entry per format** (`format` = `casesize-bottleml`, e.g. `06-00750`). `20158007342` has 7 formats. Fields: `least_listing_price`, `market_price`, `last_bbx_transaction`, `highest_bid`, `qty_available`, `has_already_bidded`. |
| `gql_order_book_sole.json` | `customProductDetail` | Sole-seller SKU `20158024224`: 1 variant. |
| `gql_order_book_multi.json` | `customProductDetail` | Multi-offer SKU `20171135668`: 4 variants, each `product.listing_id` matching an Algolia `bbx_listing_id`. Two offers share £250 (distinct only by `listing_id`). |
| `gql_order_book_multi_lagging.json` | `customProductDetail` | Same SKU captured minutes earlier, **before** the newly-created £240 offer (`listing_id` 169009) had propagated to GraphQL — 3 variants instead of 4. A real cross-endpoint eventual-consistency artifact; kept as a regression fixture. |

The key identity fact: **GraphQL `variants[].product.listing_id` == Algolia
`purchase_options[].bbx_listing_id`** — a stable, durable per-offer id. See the
design doc for the full analysis.

These are unversioned internal APIs; field names may change without notice.
