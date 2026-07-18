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
import time
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
REST_MAX_RETRIES = 3       # attempts per batch before giving up on it
REST_BACKOFF_BASE = 1.5    # seconds; doubles each retry

# Order-book classification (from the GraphQL variant listings for a SKU).
#   NOT_CHECKED : the order book has not been fetched yet (REST-only phase).
#   SOLE        : this listing is the only live offer -> pass without a next-price test.
#   COMPETING   : other offers exist -> enforce the next-lowest discount threshold.
#   UNAVAILABLE : the order book could not be read (empty/malformed) -> do NOT
#                 treat as a sole seller; reject rather than alert on unverified data.
#   CHANGED     : the order-book floor disagrees with the REST ask (a cheaper or
#                 different offer appeared mid-scan) -> reject/recompute.
OB_NOT_CHECKED = "not_checked"
OB_SOLE = "sole"
OB_COMPETING = "competing"
OB_UNAVAILABLE = "unavailable"
OB_CHANGED = "changed"

# How close a GraphQL variant price must be to the REST ask to count as "the
# same offer" (the listing's own), absorbing cross-endpoint float/rounding noise.
def _ask_match_tol(ask: float) -> float:
    return max(0.005 * ask, 0.01)

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

    # Coverage metrics — how much of the discovered book we actually priced.
    expected_skus: int = 0        # listings with a parent_sku
    queried_skus: int = 0         # SKUs in REST batches that succeeded
    priced_skus: int = 0          # SKUs that returned pricing
    failed_skus: int = 0          # SKUs in REST batches that never succeeded

    @property
    def coverage(self) -> float:
        """Fraction of expected SKUs we successfully queried (1.0 if none)."""
        if self.expected_skus == 0:
            return 1.0
        return self.queried_skus / self.expected_skus


# --------------------------------------------------------------
# Pure helpers (unit-tested)
# --------------------------------------------------------------

def count_variant_nodes(gql_data: dict) -> int:
    """Number of variant nodes present in the response, regardless of whether
    each one's price parses. Used to detect a partially-parseable order book."""
    try:
        items = gql_data.get("data", {}).get("products", {}).get("items", [])
        variants = items[0].get("variants", []) if items else []
    except AttributeError:
        return 0
    return len(variants)


def order_book_readable(gql_data: dict, prices: List[float]) -> bool:
    """
    Whether the order book can be trusted as complete.

    False if the response carries GraphQL errors, or if any variant node failed
    to yield a price. A partial parse must NOT be trusted: if a competing offer
    silently drops out, the survivors can look like a confirmed sole seller.
    """
    if gql_data.get("errors"):
        return False
    return len(prices) == count_variant_nodes(gql_data)


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


def classify_order_book(
    ask: float, variant_prices: Optional[List[float]]
) -> Tuple[str, Optional[float], Optional[float]]:
    """
    Classify the GraphQL order book for a listing whose REST ask is `ask`.

    Returns (status, next_lowest, pct_next):
      - variant_prices is None      -> (NOT_CHECKED, None, None)   order book not fetched
      - empty / no parseable prices -> (UNAVAILABLE, None, None)   cannot verify
      - a price below the ask floor  -> (CHANGED, None, None)       data shifted mid-scan
      - the ask floor disagrees      -> (CHANGED, None, None)       endpoints inconsistent
      - two or more offers at the ask-> (COMPETING, ask, 0.0)       tie: no headroom
      - a cheaper competing offer    -> (COMPETING, next, pct)
      - only this listing at the ask -> (SOLE, None, None)          confirmed sole seller

    The key correctness point: a tie at the ask means ZERO headroom (not the gap
    to the next *distinct* price), and an unreadable book is UNAVAILABLE, never
    silently treated as a sole seller.
    """
    if variant_prices is None:
        return OB_NOT_CHECKED, None, None
    if not variant_prices:
        return OB_UNAVAILABLE, None, None

    tol = _ask_match_tol(ask)
    lo = min(variant_prices)

    # The REST ask is defined as the least listing price, so the order-book
    # floor should equal it. Any material disagreement means the data changed
    # between the REST and GraphQL calls (or the endpoints are inconsistent).
    if abs(lo - ask) > tol:
        return OB_CHANGED, None, None

    n_at_floor = sum(1 for p in variant_prices if abs(p - ask) <= tol)
    higher = sorted(p for p in variant_prices if p > ask + tol)

    if n_at_floor >= 2:
        # Another seller is level with this listing at the floor.
        return OB_COMPETING, ask, 0.0
    if higher:
        nxt = higher[0]
        return OB_COMPETING, nxt, round((nxt - ask) / nxt * 100, 1)
    return OB_SOLE, None, None


def compute_discounts(
    rest_rec: Dict[str, Any],
    variant_prices: Optional[List[float]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Compute pct_market, pct_last and the order-book classification for one REST
    pricing record. Returns None when ask/market are unusable.

    Pass variant_prices=None during the REST-only phase (order book not yet
    fetched). Pass the list (possibly empty) once GraphQL has been consulted.
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

    ob_status, next_lowest, pct_next = classify_order_book(ask, variant_prices)

    return {
        "ask": ask,
        "mkt": mkt,
        "last": last,
        "pct_market": pct_market,
        "pct_last": pct_last,
        "ob_status": ob_status,
        "next_lowest": next_lowest,
        "pct_next": pct_next,
    }


def threshold_failures(disc: Dict[str, Any], config: ScanConfig) -> List[str]:
    """
    Return human-readable reasons this record fails thresholds ([] = passes).

    Order-book handling (only once it has been checked):
      - UNAVAILABLE / CHANGED -> fail: we will not alert on an unverified book.
      - COMPETING             -> enforce the next-lowest discount threshold.
      - SOLE / NOT_CHECKED    -> no next-price test.
    """
    reasons: List[str] = []
    if disc["ask"] <= config.min_case_price:
        reasons.append(f"ask £{disc['ask']} <= floor £{config.min_case_price}")
    if disc["pct_market"] < config.min_pct_market:
        reasons.append(f"mkt {disc['pct_market']}% < {config.min_pct_market}%")
    if disc["pct_last"] is not None and disc["pct_last"] < config.min_pct_last:
        reasons.append(f"last {disc['pct_last']}% < {config.min_pct_last}%")

    ob_status = disc.get("ob_status", OB_NOT_CHECKED)
    if ob_status in (OB_UNAVAILABLE, OB_CHANGED):
        reasons.append(f"order book {ob_status}")
    elif ob_status == OB_COMPETING and disc["pct_next"] is not None \
            and disc["pct_next"] < config.min_pct_next:
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

def _fetch_rest_batch(sku_list: str) -> Dict[str, Any]:
    """One REST pricing POST, with retry/backoff on any failure. Raises if all
    attempts fail so the caller can record the whole batch as uncovered."""
    last_exc: Optional[Exception] = None
    for attempt in range(REST_MAX_RETRIES):
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
            return resp.json()
        except Exception as e:  # noqa: BLE001 - transport/HTTP/JSON all retriable
            last_exc = e
            if attempt < REST_MAX_RETRIES - 1:
                time.sleep(REST_BACKOFF_BASE * (2 ** attempt))
    assert last_exc is not None
    raise last_exc


def fetch_rest_pricing(
    skus: List[str],
    *,
    batch_size: int = REST_BATCH_SIZE,
    progress: Optional[ProgressFn] = None,
) -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, Any]], List[str]]:
    """
    Fetch REST pricing for a list of SKUs in batches, retrying each batch.

    Returns (results keyed by SKU, debug rows, failed_skus). `failed_skus`
    are those in batches that never succeeded — coverage gaps, distinct from
    SKUs that were queried successfully but simply returned no pricing.
    """
    results: Dict[str, Dict[str, Any]] = {}
    debug: List[Dict[str, Any]] = []
    failed_skus: List[str] = []
    total_batches = (len(skus) + batch_size - 1) // batch_size

    for b in range(total_batches):
        batch = skus[b * batch_size:(b + 1) * batch_size]
        sku_list = ",".join(batch)

        try:
            data = _fetch_rest_batch(sku_list)
        except Exception as e:
            logging.error(
                f"REST batch {b + 1}/{total_batches} failed after "
                f"{REST_MAX_RETRIES} attempts: {e}"
            )
            failed_skus.extend(batch)
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

    return results, debug, failed_skus


def fetch_rest_pricing_full(
    skus: List[str],
    *,
    batch_size: int = REST_BATCH_SIZE,
    progress: Optional[ProgressFn] = None,
) -> Tuple[Dict[str, List[Dict[str, Any]]], List[str]]:
    """
    Fetch REST pricing keeping ALL format entries per SKU (not just entries[0]).

    Returns (results keyed by SKU → list of format entries, failed_skus).
    Used by the daily sweep where per-format detail matters.
    """
    results: Dict[str, List[Dict[str, Any]]] = {}
    failed_skus: List[str] = []
    total_batches = (len(skus) + batch_size - 1) // batch_size

    for b in range(total_batches):
        batch = skus[b * batch_size:(b + 1) * batch_size]
        sku_list = ",".join(batch)

        try:
            data = _fetch_rest_batch(sku_list)
        except Exception as e:
            logging.error(
                f"REST batch {b + 1}/{total_batches} failed after "
                f"{REST_MAX_RETRIES} attempts: {e}"
            )
            failed_skus.extend(batch)
            if progress:
                progress("rest", b + 1, total_batches)
            continue

        for sku in batch:
            entries = data.get(sku) or []
            if entries:
                results[sku] = entries

        if progress:
            progress("rest", b + 1, total_batches)

    return results, failed_skus


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
    fetch_result = fetch_listings(
        algolia_app_id,
        algolia_api_key,
        days_label=config.days_label,
        colour_choice=config.colour_choice,
        price_bands=config.price_bands,
        bottle_format=config.bottle_format,
    )
    listings = fetch_result.hits
    outcome.listings_count = len(listings)
    logging.info(f"Fetched {len(listings)} listings from Algolia.")

    prelim = [(v, str(v["parent_sku"])) for v in listings if v.get("parent_sku")]
    if not prelim:
        logging.warning("No listings had a parent_sku. Nothing to process.")
        return outcome

    # ---- Phase 2: REST pricing + preliminary thresholds ----
    skus = [sku for _, sku in prelim]
    rest_results, outcome.debug_rest, failed_skus = fetch_rest_pricing(
        skus, progress=progress
    )

    outcome.expected_skus = len(skus)
    outcome.failed_skus = len(failed_skus)
    outcome.queried_skus = len(skus) - len(failed_skus)
    outcome.priced_skus = len(rest_results)
    if outcome.coverage < 1.0:
        logging.warning(
            f"REST coverage {outcome.coverage:.1%} "
            f"({outcome.failed_skus}/{outcome.expected_skus} SKUs in failed batches)."
        )

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
        # A partially-parseable or errored order book must not be trusted: pass
        # no prices so it classifies as UNAVAILABLE rather than a false "sole".
        readable = order_book_readable(gql, prices)
        disc = compute_discounts(rest_rec, prices if readable else [])
        if disc is None:
            row.update(passed=False, reason="invalid ask/market")
            outcome.debug_gql.append(row)
            if progress:
                progress("graphql", idx, total)
            continue

        row.update(
            variant_prices=prices,
            variant_nodes=count_variant_nodes(gql),
            book_readable=readable,
            ob_status=disc["ob_status"],
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
