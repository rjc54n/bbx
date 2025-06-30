# core/enrichment.py
# ----------------------------------------------
# A two-phase enrichment to minimise slow GraphQL calls:
# 1) Quick REST pricing lookup (getBiddableCprStock) to compute discounts
# 2) Preliminary filter on thresholds
# 3) Detailed GraphQL fetch (fetch_bbx_listing_variants) only for passing records

import requests
from core.fetch_bbx_variants import fetch_bbx_listing_variants

# REST endpoint and headers for quick pricing lookup
REST_URL = "https://www.bbr.com/api/cellarServices/getBiddableCprStock"
REST_HEADERS = {
    "accept": "application/json, text/plain, */*",
    "content-type": "application/json",
    "referer": "https://www.bbr.com/bbx-listings",
    "user-agent": "Mozilla/5.0"
}


def enrich_bbx_listings(
    variants: list[dict],
    min_pct_market: float,
    min_pct_last: float,
    max_price_per_case: float,
    case_format: str | None = None
) -> list[dict]:
    """
    Enriches BBX listings in three steps:
      1) REST GETBiddableCprStock call for base pricing info
      2) Compute discount metrics and apply thresholds
      3) Call GraphQL helper only on passing records for final details

    Args:
      variants: list of dicts from Algolia (must contain 'parent_sku' and 'format')
      min_pct_market: threshold for discount vs market
      min_pct_last:   threshold for discount vs last transaction
      max_price_per_case: maximum ask price per case
      case_format:    optional exact case format filter (e.g. '6 x 75 cl')

    Returns:
      A list of fully enriched listing dicts (with GraphQL data) that pass filters.
    """
    enriched: list[dict] = []

    # 1) Quick REST pricing lookup for each variant
    for v in variants:
        sku = str(v.get("parent_sku") or v.get("sku") or "")
        fmt = v.get("format") or v.get("case_size")
        if not sku:
            continue
        if case_format and fmt != case_format:
            # Skip formats not in our filter
            continue

        # REST body for single-SKU pricing
        body = [{
            "account_id": "",
            "product_codes": sku,
            "is_biddable": True
        }]
        try:
            resp = requests.post(REST_URL, headers=REST_HEADERS, json=body)
            resp.raise_for_status()
            data = resp.json().get(sku, [])
            # Each entry has fields like 'market_price', 'least_listing_price', 'last_bbx_transaction'
            # We'll take the first entry (if multiple)
            if not data:
                continue
            entry = data[0]

            # 2) Compute key pricing metrics for filtering
            ask_price = entry.get("least_listing_price")
            market_price = entry.get("market_price")
            last_tx = entry.get("last_bbx_transaction")
            if not (ask_price and market_price and last_tx):
                continue

            # percentage discounts
            pct_market = round((market_price - ask_price) / market_price * 100, 1)
            pct_last   = round((last_tx - ask_price) / last_tx * 100, 1)

            # Skip if outside thresholds
            if pct_market < min_pct_market or pct_last < min_pct_last or ask_price > max_price_per_case:
                continue

            # Merge REST fields for downstream
            v.update({
                "price_per_case": ask_price,
                "pct_discount_market": pct_market,
                "pct_discount_last": pct_last
            })

            # 3) Detailed GraphQL call for final enrichment
            gql = fetch_bbx_listing_variants(
                sku=sku,
                path=v.get("product_path", v.get("product_url", "")).split("/bbx/")[-1],
                payload_path=None  # default payload.json
            )
            # gql returns a dict of deep variant info
            if isinstance(gql, dict):
                v.update(gql)

            enriched.append(v)
        except Exception:
            # On any failure, skip this variant
            continue

    return enriched

