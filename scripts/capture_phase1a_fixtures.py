#!/usr/bin/env python3
"""
Reproducible capture of the Phase 1A validation fixtures (tests/fixtures/).

Hits the LIVE BBX endpoints — run sparingly and politely. It re-fetches the same
SKUs the committed fixtures were captured from; because the order book is live,
exact prices/offers WILL drift from the committed snapshots. The point is
reproducibility of the *shape* and the capture method, not byte-identical output.

Usage:
    .venv/bin/python scripts/capture_phase1a_fixtures.py [--out DIR]

Credentials: .streamlit/secrets.toml (ALGOLIA_APP_ID, ALGOLIA_API_KEY).

Provenance for each response (UTC time, endpoint, filter/SKU, source
index_last_update) is written to <out>/MANIFEST.json.
"""
from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import tomllib

import requests

from core.fetch_listings import _fetch_with_filters, _count_and_facets
from core.pipeline import _fetch_rest_batch
from core.fetch_bbx_variants import fetch_bbx_listing_variants, load_payload

# The SKUs the committed fixtures were captured from (2026-07-18).
SOLE_SKU = "20158024224"
MULTI_SKU = "20171135668"
DEEP_SKU = "20158007342"          # 30 offers, many formats, id range 668..168993
REST_SKUS = [SOLE_SKU, MULTI_SKU, DEEP_SKU,
             "20138117265", "20201335042", "20171130940"]


def _utc() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _strip(hit: dict) -> dict:
    """Drop Algolia search-highlight metadata (not product data)."""
    return {k: v for k, v in hit.items() if k != "_highlightResult"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=pathlib.Path, default=pathlib.Path("tests/fixtures"))
    args = ap.parse_args()
    out = args.out
    out.mkdir(parents=True, exist_ok=True)

    secrets = tomllib.loads(pathlib.Path(".streamlit/secrets.toml").read_text())
    app, key = secrets["ALGOLIA_APP_ID"], secrets["ALGOLIA_API_KEY"]
    payload = load_payload(pathlib.Path("data/payload.json"))
    session = requests.Session()

    manifest: list[dict] = []

    def record(fixture, endpoint, query, resp_meta):
        manifest.append({
            "fixture": fixture, "endpoint": endpoint, "query": query,
            "captured_utc": _utc(), **resp_meta,
        })

    # --- Algolia: full-book count (context only, not a fixture) ---
    nb, _ = _count_and_facets(app, key, ["stock_origin:'BBX'"], ["colour"])
    record("(context)", "algolia prod_product count", "stock_origin:'BBX'",
           {"nbHits": nb})

    # --- Algolia: multi-offer + sole-offer hit ---
    multi = _fetch_with_filters(app, key, ["stock_origin:'BBX'", f"parent_sku:'{MULTI_SKU}'"])[0]
    sole = _fetch_with_filters(app, key, ["stock_origin:'BBX'", f"parent_sku:'{SOLE_SKU}'"])[0]
    (out / "algolia_listing_hit.json").write_text(json.dumps({
        "_note": "Real BBX Algolia prod_product hits. _highlightResult removed. "
                 "Each object is one parent_sku; purchase_options enumerates all "
                 "live seller offers (across formats), each with its bbx_listing_id.",
        "multi_offer": _strip(multi), "sole_offer": _strip(sole),
    }, indent=2, ensure_ascii=False) + "\n")
    record("algolia_listing_hit.json", "algolia prod_product",
           f"parent_sku in [{MULTI_SKU}, {SOLE_SKU}]",
           {"multi_index_last_update": multi.get("index_last_update"),
            "sole_index_last_update": sole.get("index_last_update")})

    # --- Algolia: deep book (30 offers) ---
    deep = _fetch_with_filters(app, key, ["stock_origin:'BBX'", f"parent_sku:'{DEEP_SKU}'"])[0]
    d = _strip(deep)
    d["_note"] = ("Deep order book (30 offers) for parent_sku %s. Evidences "
                  "listing_id durability at a point in time and same-price offer "
                  "disambiguation." % DEEP_SKU)
    (out / "algolia_deep_book.json").write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
    record("algolia_deep_book.json", "algolia prod_product", f"parent_sku:'{DEEP_SKU}'",
           {"n_offers": len(deep.get("purchase_options") or []),
            "index_last_update": deep.get("index_last_update")})

    # --- REST pricing (raw batch) ---
    rest = _fetch_rest_batch(",".join(REST_SKUS))
    (out / "rest_pricing.json").write_text(json.dumps({
        "_note": "Raw getBiddableCprStock. Each parent_sku maps to a LIST, one "
                 "entry per format (format = casesize-bottleml).",
        **rest,
    }, indent=2, ensure_ascii=False) + "\n")
    record("rest_pricing.json", "getBiddableCprStock", f"product_codes={REST_SKUS}",
           {"formats_per_sku": {k: len(v) for k, v in rest.items()}})

    # --- GraphQL: sole + multi (settled) ---
    for label, sku, hit in [("sole", SOLE_SKU, sole), ("multi", MULTI_SKU, multi)]:
        data = fetch_bbx_listing_variants(sku, hit["product_url"].lstrip("/"), payload, session=session)
        (out / f"gql_order_book_{label}.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        variants = data.get("data", {}).get("products", {}).get("items", [{}])[0].get("variants", [])
        record(f"gql_order_book_{label}.json", "customProductDetail", f"sku={sku}",
               {"n_variants": len(variants)})

    # NOTE: gql_order_book_multi_lagging.json cannot be reproduced on demand — it
    # captured a transient pre-propagation state (a new offer present in
    # REST/Algolia but not yet in GraphQL). It is kept as a committed artifact.

    (out / "MANIFEST.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote fixtures + MANIFEST.json to {out}")


if __name__ == "__main__":
    main()
