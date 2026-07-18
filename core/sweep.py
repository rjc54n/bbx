"""
Daily sweep orchestration: fetch full book → extract entities → diff → atomic commit.

This module is the bridge between the API-fetching pipeline and the persistent
scan store. It does not handle DB connections or entry-point concerns (env vars,
error reporting) — those belong in the caller (apps/daily_sweep/run_sweep.py).
"""
from __future__ import annotations

import logging
from datetime import date, timezone, datetime
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from core.db import bootstrap_schema
from core.fetch_listings import FetchResult, fetch_listings
from core.models import (
    ObservationEvent,
    Offer,
    Product,
    Sku,
    format_code_from,
    _now_utc,
)
from core.pipeline import fetch_rest_pricing_full
from core.store import (
    commit_sweep,
    diff_offers,
    diff_products,
    diff_skus,
    load_current_offers,
    load_current_products,
    load_current_skus,
    mark_run_failed,
    start_run,
    update_run_discovery,
    update_run_rest,
)

log = logging.getLogger(__name__)

REST_COVERAGE_THRESHOLD = 0.80


def _determine_final_status(algolia_complete: bool, rest_coverage: float) -> str:
    if algolia_complete and rest_coverage >= REST_COVERAGE_THRESHOLD:
        return "completed"
    return "partial"


def _extract_products(hits: List[Dict[str, Any]]) -> Dict[str, Product]:
    products: Dict[str, Product] = {}
    for hit in hits:
        psku = hit.get("parent_sku")
        if not psku:
            continue
        psku = str(psku)
        if psku not in products:
            products[psku] = Product.from_algolia_hit(hit)
    return products


def _extract_skus(
    rest_data: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Sku]:
    skus: Dict[str, Sku] = {}
    for parent_sku, entries in rest_data.items():
        for entry in entries:
            sku = Sku.from_rest_entry(parent_sku, entry)
            key = f"{sku.parent_sku}|{sku.format_code}"
            skus[key] = sku
    return skus


def _extract_offers(
    hits: List[Dict[str, Any]],
    known_format_codes: Dict[str, Set[str]],
) -> Dict[str, Offer]:
    offers: Dict[str, Offer] = {}
    for hit in hits:
        psku = hit.get("parent_sku")
        if not psku:
            continue
        psku = str(psku)
        for opt in hit.get("purchase_options") or []:
            if "bbx_listing_id" not in opt:
                continue
            codes = known_format_codes.get(psku)
            offer = Offer.from_purchase_option(psku, opt, known_format_codes=codes)
            if offer.price_per_case_p is not None:
                offers[offer.bbx_listing_id] = offer
    return offers


def _compute_source_agreement(
    skus: Dict[str, Sku],
    offers: Dict[str, Offer],
) -> None:
    sku_by_parent: Dict[str, Dict[str, Sku]] = {}
    for key, sku in skus.items():
        sku_by_parent.setdefault(sku.parent_sku, {})[sku.format_code] = sku

    offer_floor_by_format: Dict[Tuple[str, str], int] = {}
    for offer in offers.values():
        if offer.format_code is None or offer.price_per_case_p is None:
            continue
        key = (offer.parent_sku, offer.format_code)
        current = offer_floor_by_format.get(key)
        if current is None or offer.price_per_case_p < current:
            offer_floor_by_format[key] = offer.price_per_case_p

    for (psku, fc), offer_floor in offer_floor_by_format.items():
        parent_skus = sku_by_parent.get(psku, {})
        sku = parent_skus.get(fc)
        if sku is None:
            continue
        if sku.least_listing_price_p is None:
            sku.source_agreement = "unchecked"
        elif sku.least_listing_price_p == offer_floor:
            sku.source_agreement = "ok"
        else:
            sku.source_agreement = "disagree"


def _known_format_codes_by_sku(
    rest_data: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Set[str]]:
    result: Dict[str, Set[str]] = {}
    for parent_sku, entries in rest_data.items():
        codes = set()
        for entry in entries:
            fmt = entry.get("format")
            if fmt:
                codes.add(fmt)
        if codes:
            result[parent_sku] = codes
    return result


def run_daily_sweep(
    conn,
    *,
    algolia_app_id: str,
    algolia_api_key: str,
    run_date: Optional[str] = None,
    progress: Optional[Callable] = None,
) -> Optional[str]:
    """
    Run one full-book sweep and persist results.

    Returns the run_id on success, or None if a completed run already exists
    for today. Raises on fatal errors (the caller should catch and set
    status='failed' on the run if one was started).
    """
    bootstrap_schema(conn)

    if run_date is None:
        run_date = date.today().isoformat()

    run_id = start_run(conn, scope="full_book", run_date=run_date)
    if run_id is None:
        log.info("Completed run already exists for %s — skipping.", run_date)
        return None

    log.info("Started sweep run %s for %s", run_id, run_date)

    try:
        # --- Phase 1: Algolia discovery ---
        fetch_result = fetch_listings(
            algolia_app_id, algolia_api_key, days_label=None
        )
        hits = fetch_result.hits
        algolia_complete = fetch_result.discovery_complete

        if fetch_result.collected_count > fetch_result.total_index_hits:
            log.warning(
                "Algolia collected %d hits but expected %d at sweep start — the "
                "index likely grew during the sweep window. Discovery is still "
                "treated as complete, but this is worth keeping an eye on.",
                fetch_result.collected_count, fetch_result.total_index_hits,
            )

        update_run_discovery(
            conn, run_id,
            algolia_complete=algolia_complete,
            algolia_hits_expected=fetch_result.total_index_hits,
            algolia_hits_collected=fetch_result.collected_count,
        )
        log.info(
            "Algolia: %d hits collected (expected %d, complete=%s)",
            fetch_result.collected_count, fetch_result.total_index_hits, algolia_complete,
        )

        # --- Phase 2: REST pricing (full) ---
        parent_skus = list({
            str(h["parent_sku"]) for h in hits if h.get("parent_sku")
        })
        rest_data, failed_skus = fetch_rest_pricing_full(
            parent_skus, progress=progress
        )
        rest_failed_set = set(failed_skus)

        rest_skus_expected = len(parent_skus)
        rest_skus_priced = len(rest_data)
        rest_skus_failed = len(failed_skus)
        rest_coverage = rest_skus_priced / rest_skus_expected if rest_skus_expected else 1.0

        update_run_rest(
            conn, run_id,
            rest_skus_expected=rest_skus_expected,
            rest_skus_priced=rest_skus_priced,
            rest_skus_failed=rest_skus_failed,
            rest_failed_skus=failed_skus,
        )
        log.info(
            "REST: %d/%d priced, %d failed (coverage %.1f%%)",
            rest_skus_priced, rest_skus_expected, rest_skus_failed, rest_coverage * 100,
        )

        # --- Phase 3: Extract entities ---
        fresh_products = _extract_products(hits)
        fresh_skus = _extract_skus(rest_data)
        known_fcs = _known_format_codes_by_sku(rest_data)
        fresh_offers = _extract_offers(hits, known_fcs)

        _compute_source_agreement(fresh_skus, fresh_offers)

        log.info(
            "Extracted %d products, %d SKUs, %d offers",
            len(fresh_products), len(fresh_skus), len(fresh_offers),
        )

        # --- Phase 4: Diff against current state ---
        now = _now_utc()

        log.info("Loading current state from store...")
        current_products = load_current_products(conn)
        current_skus = load_current_skus(conn)
        current_offers = load_current_offers(conn)
        log.info(
            "Current store state: %d products, %d SKUs, %d offers",
            len(current_products), len(current_skus), len(current_offers),
        )

        # An empty store means every entity is new. Diffing would emit an
        # "appeared" event per entity — ~75k rows on the first full-book
        # population, doubling an already-heavy write. Seed state instead
        # and record one summary event; real transitions start from run two.
        is_bootstrap = len(current_products) == 0

        if is_bootstrap:
            log.info(
                "Store is empty — bootstrap run, seeding state with a single "
                "summary event instead of one 'appeared' event per entity."
            )
            seen_products = list(fresh_products.values())
            seen_skus = list(fresh_skus.values())
            seen_offers = list(fresh_offers.values())
            all_events = [ObservationEvent(
                scan_run_id=run_id, entity_type="run", entity_key=run_id,
                event_type="bootstrap", observed_at=now,
                metadata={
                    "products": len(seen_products),
                    "skus": len(seen_skus),
                    "offers": len(seen_offers),
                },
            )]
        else:
            log.info("Diffing fresh vs current state...")
            seen_products, prod_events = diff_products(fresh_products, current_products, run_id, now)
            seen_skus, sku_events = diff_skus(fresh_skus, current_skus, run_id, now)
            seen_offers, offer_events = diff_offers(fresh_offers, current_offers, run_id, now)
            all_events = prod_events + sku_events + offer_events
            log.info("Diff complete: %d events", len(all_events))

        # --- Phase 5: Atomic commit ---
        final_status = _determine_final_status(algolia_complete, rest_coverage)

        log.info("Committing sweep as '%s'...", final_status)
        commit_sweep(
            conn,
            run_id,
            products=seen_products,
            skus=seen_skus,
            offers=seen_offers,
            events=all_events,
            seen_product_keys=set(fresh_products.keys()),
            seen_sku_keys=set(fresh_skus.keys()),
            seen_offer_keys=set(fresh_offers.keys()),
            current_products=current_products,
            current_skus=current_skus,
            current_offers=current_offers,
            algolia_complete=algolia_complete,
            rest_failed_skus=rest_failed_set,
            final_status=final_status,
            now=now,
        )

        log.info(
            "Sweep %s finished as '%s' — %d events recorded",
            run_id, final_status, len(all_events),
        )
        return run_id

    except Exception as e:
        log.exception("Sweep run %s failed", run_id)
        mark_run_failed(conn, run_id, str(e))
        raise
