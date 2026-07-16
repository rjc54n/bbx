# core/pipeline.py
# --------------------------------------------------------------
# The shared BBX bargain-scan funnel, used by both the Streamlit
# app and the arbitrage bot:
#
#   Phase 1: Algolia discovery        (cheap, wide net)
#   Phase 2: REST pricing, batched    (ask / market / last transaction)
#   Phase 3: GraphQL order book       (next-lowest competing ask)
#
# Threshold semantics (deliberate, shared by both consumers):
#   - pct_market must meet its threshold (ask and market are always present).
#   - pct_last / pct_next are only enforced when computable. A wine with no
#     last transaction or no competing seller still passes on pct_market
#     alone; the missing metrics are shown as None downstream.
# --------------------------------------------------------------

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import requests

from core.fetch_listings import fetch_listings
from core.fetch_bbx_variants import fetch_bbx_listing_variants, load_payload

# REST endpoint for the quick pricing lookup (getBiddableCprStock).
REST_URL = "https://www.bbr.com/api/cellarServices/getBiddableCprStock"
REST_HEADERS = {
    "accept": "application/json, text/plain, */*",
    "content-type": "application/json",
    "referer": "https://www.bbr.com/bbx-listings",
    "user-agent": "Mozilla/5.0",
}

REST_BATCH_SIZE = 24
REST_TIMEOUT = 10

# progress(phase, done, total) — phases are "rest" and "graphql".
ProgressFn = Callable[[str, int, int], None]


@dataclass
class ScanConfig:
    """All knobs for one scan: Algolia facets plus discount thresholds."""
    # Algolia facets
    days_label: Optional[str] = None      # e.g. "1 Day", "7 Days"; None = all BBX
    colour_choice: str = "Any"
    price_bands: Optional[List[str]] = None
    bottle_format: Optional[str] = None   # "Bottle" or None

    # Discount thresholds (percent)
    min_pct_market: float = 15.0
    min_pct_last: float = 15.0
    min_pct_next: float = 15.0

    # Ask-price sanity floor (rejects £0/£1 placeholder listings)
    min_case_price: float = 1.0


@dataclass
class ScanOutcome:
    candidates: List[Dict[str, Any]] = field(default_factory=list)
    listings_count: int = 0
    rest_pass_count: int = 0
    debug_rest: List[Dict[str, Any]] = field(default_factory=list)
    debug_gql: List[Dict[str, Any]] = field(default_factory=list)


# --------------------------------------------------------------
# Pure helpers (unit-tested)
# --------------------------------------------------------------

def extract_variant_prices(gql_data: dict) -> List[float]:
    """Pull all well-formed per-case variant prices out of a GraphQL response."""
    try:
        items = gql_data.get("data", {}).get("products", {}).get("items", [])
        variants = items[0].get("variants", []) if items else []
    except AttributeError:
        return []

    prices: List[float] = []
    for variant in variants:
        try:
            amt = (
                variant["product"]
                ["custom_prices"]
                ["price_per_case"]
                ["amount"]
                ["value"]
            )
            prices.append(float(amt))
        except (KeyError, TypeError, ValueError):
            # Skip variants with malformed price data
            pass
    return prices


def compute_discounts(
    rest_rec: Dict[str, Any],
    variant_prices: Optional[List[float]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Compute pct_market, pct_last and (if variant prices given) pct_next
    for one REST pricing record. Returns None when ask/market are unusable.
    """
    ask_raw = rest_rec.get("least_listing_price")
    mkt_raw = rest_rec.get("market_price")
    last_raw = rest_rec.get("last_bbx_transaction")

    try:
        ask = float(ask_raw)
        mkt = float(mkt_raw)
    except (TypeError, ValueError):
        return None

    if ask <= 0 or mkt <= 0:
        return None

    pct_market = round((mkt - ask) / mkt * 100, 1)

    last = None
    pct_last = None
    try:
        last_val = float(last_raw)
        if last_val > 0:
            last = last_val
            pct_last = round((last_val - ask) / last_val * 100, 1)
    except (TypeError, ValueError):
        pass

    next_lowest = None
    pct_next = None
    if variant_prices:
        higher = sorted(p for p in variant_prices if p > ask)
        if higher:
            next_lowest = higher[0]
            pct_next = round((next_lowest - ask) / next_lowest * 100, 1)

    return {
        "ask": ask,
        "mkt": mkt,
        "last": last,
        "pct_market": pct_market,
        "pct_last": pct_last,
        "next_lowest": next_lowest,
        "pct_next": pct_next,
    }


def threshold_failures(disc: Dict[str, Any], config: ScanConfig) -> List[str]:
    """Return human-readable reasons this record fails thresholds ([] = passes)."""
    reasons: List[str] = []
    if disc["ask"] <= config.min_case_price:
        reasons.append(f"ask £{disc['ask']} <= floor £{config.min_case_price}")
    if disc["pct_market"] < config.min_pct_market:
        reasons.append(f"mkt {disc['pct_market']}% < {config.min_pct_market}%")
    if disc["pct_last"] is not None and disc["pct_last"] < config.min_pct_last:
        reasons.append(f"last {disc['pct_last']}% < {config.min_pct_last}%")
    if disc["pct_next"] is not None and disc["pct_next"] < config.min_pct_next:
        reasons.append(f"next {disc['pct_next']}% < {config.min_pct_next}%")
    return reasons


def derive_case_format(entry: Dict[str, Any]) -> str:
    """
    Derive a compact case format string, e.g. "6x75cl".

    Priority:
      1) case_size + bottle_volume if both present.
      2) entry["format"], normalised.
      3) "N/A".
    """
    case_size = entry.get("case_size")
    bottle_volume = entry.get("bottle_volume")

    if case_size and bottle_volume:
        return f"{case_size}x{bottle_volume}"

    fmt = entry.get("format")
    if isinstance(fmt, str) and fmt.strip():
        return fmt.replace(" x ", "x").replace(" ", "")

    return "N/A"


def build_bbx_url(entry: Dict[str, Any]) -> str:
    """Build a browsable bbr.com URL from an Algolia hit's path fields."""
    raw_path = entry.get("product_path") or entry.get("product_url") or ""
    if raw_path.startswith("http"):
        return raw_path
    return f"https://www.bbr.com/{raw_path.lstrip('/')}"


# --------------------------------------------------------------
# Phase 2: batched REST pricing
# --------------------------------------------------------------

def fetch_rest_pricing(
    skus: List[str],
    *,
    batch_size: int = REST_BATCH_SIZE,
    progress: Optional[ProgressFn] = None,
) -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Fetch REST pricing for a list of SKUs in batches.

    Returns (results keyed by SKU, debug rows for batch-level errors).
    """
    results: Dict[str, Dict[str, Any]] = {}
    debug: List[Dict[str, Any]] = []
    total_batches = (len(skus) + batch_size - 1) // batch_size

    for b in range(total_batches):
        batch = skus[b * batch_size:(b + 1) * batch_size]
        sku_list = ",".join(batch)

        try:
            resp = requests.post(
                REST_URL,
                headers=REST_HEADERS,
                json=[{
                    "account_id": "",
                    "product_codes": sku_list,
                    "is_biddable": True,
                }],
                timeout=REST_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logging.error(f"REST batch {b + 1}/{total_batches} failed: {e}")
            for sku in batch:
                debug.append({"sku": sku, "reason": f"batch REST error: {e}", "passed": False})
            if progress:
                progress("rest", b + 1, total_batches)
            continue

        for sku in batch:
            entries = data.get(sku) or []
            if entries:
                results[sku] = entries[0]

        if progress:
            progress("rest", b + 1, total_batches)

    return results, debug


# --------------------------------------------------------------
# Full scan
# --------------------------------------------------------------

def run_scan(
    algolia_app_id: str,
    algolia_api_key: str,
    config: ScanConfig,
    payload_path: Path,
    progress: Optional[ProgressFn] = None,
) -> ScanOutcome:
    """
    Run the full three-phase scan and return scored candidates plus debug rows.
    """
    outcome = ScanOutcome()

    # ---- Phase 1: Algolia discovery ----
    listings = fetch_listings(
        algolia_app_id,
        algolia_api_key,
        days_label=config.days_label,
        colour_choice=config.colour_choice,
        price_bands=config.price_bands,
        bottle_format=config.bottle_format,
    )
    outcome.listings_count = len(listings)
    logging.info(f"Fetched {len(listings)} listings from Algolia.")

    prelim = [(v, str(v["parent_sku"])) for v in listings if v.get("parent_sku")]
    if not prelim:
        logging.warning("No listings had a parent_sku. Nothing to process.")
        return outcome

    # ---- Phase 2: REST pricing + preliminary thresholds ----
    skus = [sku for _, sku in prelim]
    rest_results, outcome.debug_rest = fetch_rest_pricing(skus, progress=progress)

    rest_candidates: List[Tuple[Dict[str, Any], str, Dict[str, Any]]] = []
    for entry, sku in prelim:
        rest_rec = rest_results.get(sku)
        row: Dict[str, Any] = {"sku": sku}

        if not rest_rec:
            row.update(reason="no REST data", passed=False)
            outcome.debug_rest.append(row)
            continue

        disc = compute_discounts(rest_rec)
        if disc is None:
            row.update(reason="invalid ask/market", passed=False)
            outcome.debug_rest.append(row)
            continue

        row.update(
            ask=disc["ask"], mkt=disc["mkt"],
            pct_market=disc["pct_market"], pct_last=disc["pct_last"],
        )

        # Preliminary check on the REST-only metrics (pct_next comes later).
        failures = [
            r for r in threshold_failures(disc, config)
            if not r.startswith("next ")
        ]
        if failures:
            row.update(reason="; ".join(failures), passed=False)
            outcome.debug_rest.append(row)
            continue

        row.update(reason="passed", passed=True)
        outcome.debug_rest.append(row)
        rest_candidates.append((entry, sku, rest_rec))

    outcome.rest_pass_count = len(rest_candidates)
    logging.info(f"{len(rest_candidates)} candidates passed REST-level thresholds.")

    if not rest_candidates:
        return outcome

    # ---- Phase 3: GraphQL order book + final thresholds ----
    payload = load_payload(payload_path)
    session = requests.Session()
    total = len(rest_candidates)

    for idx, (entry, sku, rest_rec) in enumerate(rest_candidates, start=1):
        row = {"sku": sku}
        path = (entry.get("product_path") or entry.get("product_url") or "").lstrip("/")

        try:
            gql = fetch_bbx_listing_variants(sku, path, payload, session=session)
        except Exception as e:
            logging.error(f"GraphQL error for SKU {sku}: {e}")
            row.update(passed=False, reason=f"GraphQL error: {e}")
            outcome.debug_gql.append(row)
            if progress:
                progress("graphql", idx, total)
            continue

        prices = extract_variant_prices(gql)
        disc = compute_discounts(rest_rec, prices)
        if disc is None:
            row.update(passed=False, reason="invalid ask/market")
            outcome.debug_gql.append(row)
            if progress:
                progress("graphql", idx, total)
            continue

        row.update(
            variant_prices=prices,
            next_lowest=disc["next_lowest"],
            pct_next=disc["pct_next"],
        )

        failures = threshold_failures(disc, config)
        if failures:
            row.update(passed=False, reason="; ".join(failures))
            outcome.debug_gql.append(row)
            if progress:
                progress("graphql", idx, total)
            continue

        row.update(passed=True)
        outcome.debug_gql.append(row)

        outcome.candidates.append({
            "name": entry.get("name"),
            "vintage": entry.get("vintage"),
            "region": entry.get("region"),
            "sku": sku,
            "case_format": derive_case_format(entry),
            **disc,
            "url": build_bbx_url(entry),
        })

        if progress:
            progress("graphql", idx, total)

    logging.info(f"Scan complete: {len(outcome.candidates)} candidates.")
    return outcome
