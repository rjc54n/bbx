"""
Scan store operations for Phase 1B.

All writes use parameterised SQL. The commit_sweep path wraps entity upserts,
event inserts, and run-status update in a single transaction.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from core.db import is_postgres, placeholder, placeholders, _adapt_array_param, _parse_array_column
from core.models import ObservationEvent, Offer, Product, Sku, _now_utc, _uuid

try:
    from psycopg2.extras import execute_values
except ImportError:
    execute_values = None

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# scan_runs
# ---------------------------------------------------------------------------

def start_run(conn, *, scope: str, run_date: str) -> Optional[str]:
    p = placeholder()
    cur = conn.cursor()
    cur.execute(
        f"SELECT id FROM scan_runs WHERE scope = {p} AND run_date = {p} AND status = 'completed'",
        (scope, run_date),
    )
    if cur.fetchone():
        cur.close()
        return None

    run_id = _uuid()
    now = _now_utc()
    cur.execute(
        f"INSERT INTO scan_runs (id, scope, run_date, status, started_at) "
        f"VALUES ({placeholders(5)})",
        (run_id, scope, run_date, "running", now),
    )
    conn.commit()
    cur.close()
    return run_id


def get_last_completed_run_finished_at(conn, *, scope: str) -> Optional[str]:
    """Most recent completed run's finished_at for this scope, or None if
    there isn't one yet (e.g. the very first run). Phase 4 wave pricing uses
    this as the baseline for index_last_update delta selection -- with no
    baseline, nothing can be judged "changed since last time"."""
    p = placeholder()
    cur = conn.cursor()
    cur.execute(
        f"SELECT finished_at FROM scan_runs WHERE scope = {p} AND status = 'completed' "
        f"ORDER BY finished_at DESC LIMIT 1",
        (scope,),
    )
    row = cur.fetchone()
    cur.close()
    if row is None:
        return None
    return dict(row)["finished_at"]


def update_run_discovery(
    conn, run_id: str, *,
    algolia_complete: bool,
    algolia_hits_expected: int,
    algolia_hits_collected: int,
) -> None:
    p = placeholder()
    cur = conn.cursor()
    cur.execute(
        f"UPDATE scan_runs SET algolia_complete = {p}, algolia_hits_expected = {p}, "
        f"algolia_hits_collected = {p} WHERE id = {p}",
        (algolia_complete, algolia_hits_expected, algolia_hits_collected, run_id),
    )
    conn.commit()
    cur.close()


def update_run_rest(
    conn, run_id: str, *,
    rest_skus_expected: int,
    rest_skus_priced: int,
    rest_skus_failed: int,
    rest_failed_skus: List[str],
) -> None:
    p = placeholder()
    cur = conn.cursor()
    cur.execute(
        f"UPDATE scan_runs SET rest_skus_expected = {p}, rest_skus_priced = {p}, "
        f"rest_skus_failed = {p}, rest_failed_skus = {p} WHERE id = {p}",
        (rest_skus_expected, rest_skus_priced, rest_skus_failed,
         _adapt_array_param(rest_failed_skus), run_id),
    )
    conn.commit()
    cur.close()


def update_run_wave_pricing(
    conn, run_id: str, *,
    wave_delta_enabled: bool,
    wave_rotation_count: int,
    wave_delta_changed_count: int,
    wave_shadow_only_count: int,
    wave_priced_count: int,
) -> None:
    """Persists core.sweep.RestPricingPlan's stats for one run -- the
    auditability Phase 4 Step 6 asks for, so the "at least a week" delta-vs-
    rotation comparison is a SQL query against scan_runs, not log-scraping."""
    p = placeholder()
    cur = conn.cursor()
    cur.execute(
        f"UPDATE scan_runs SET wave_delta_enabled = {p}, wave_rotation_count = {p}, "
        f"wave_delta_changed_count = {p}, wave_shadow_only_count = {p}, "
        f"wave_priced_count = {p} WHERE id = {p}",
        (wave_delta_enabled, wave_rotation_count, wave_delta_changed_count,
         wave_shadow_only_count, wave_priced_count, run_id),
    )
    conn.commit()
    cur.close()


def mark_run_failed(conn, run_id: str, error_message: str) -> None:
    p = placeholder()
    cur = conn.cursor()
    cur.execute(
        f"UPDATE scan_runs SET status='failed', finished_at={p}, error_message={p} "
        f"WHERE id={p}",
        (_now_utc(), error_message, run_id),
    )
    conn.commit()
    cur.close()


# ---------------------------------------------------------------------------
# Load current state
# ---------------------------------------------------------------------------

def load_current_products(conn) -> Dict[str, Dict[str, Any]]:
    cur = conn.cursor()
    cur.execute("SELECT * FROM products")
    rows = cur.fetchall()
    cur.close()
    result = {}
    for row in rows:
        d = dict(row)
        d["grape_varieties"] = _parse_array_column(d.get("grape_varieties"))
        result[d["parent_sku"]] = d
    return result


def load_current_skus(conn) -> Dict[str, Dict[str, Any]]:
    cur = conn.cursor()
    cur.execute("SELECT * FROM skus")
    rows = cur.fetchall()
    cur.close()
    return {f"{dict(r)['parent_sku']}|{dict(r)['format_code']}": dict(r) for r in rows}


def load_current_offers(conn) -> Dict[str, Dict[str, Any]]:
    cur = conn.cursor()
    cur.execute("SELECT * FROM offers")
    rows = cur.fetchall()
    cur.close()
    return {dict(r)["bbx_listing_id"]: dict(r) for r in rows}


# ---------------------------------------------------------------------------
# Diff logic
# ---------------------------------------------------------------------------

_PRODUCT_TRACKED_FIELDS = ["name", "vintage", "region", "subregion", "colour",
                           "country", "producer", "product_url"]

_SKU_PRICE_FIELDS = ["least_listing_price_p", "market_price_p",
                      "last_transaction_p", "highest_bid_p"]

# is_listed is a plain field_changed (not a price field) -- tracking it
# gives a visible "listed"/"delisted" event in observation_events for every
# transition, including the ones core.sweep._reconcile_listing_state
# synthesises for SKUs that lost their listing without being REST-repriced
# this run.
_SKU_TRACKED_FIELDS = _SKU_PRICE_FIELDS + ["qty_available", "is_listed"]


def diff_products(
    fresh: Dict[str, Product],
    current: Dict[str, Dict[str, Any]],
    run_id: str,
    now: str,
) -> Tuple[List[Product], List[ObservationEvent]]:
    events = []
    seen_products = []
    for psku, product in fresh.items():
        seen_products.append(product)
        if psku not in current:
            events.append(ObservationEvent(
                scan_run_id=run_id, entity_type="product",
                entity_key=psku, event_type="appeared", observed_at=now,
            ))
        else:
            cur = current[psku]
            for f in _PRODUCT_TRACKED_FIELDS:
                old_val = cur.get(f)
                new_val = getattr(product, f)
                if str(old_val) != str(new_val) and new_val is not None:
                    events.append(ObservationEvent(
                        scan_run_id=run_id, entity_type="product",
                        entity_key=psku, event_type="field_changed",
                        field_name=f, old_value_raw=str(old_val),
                        new_value_raw=str(new_val), observed_at=now,
                    ))
    return seen_products, events


def diff_skus(
    fresh: Dict[str, Sku],
    current: Dict[str, Dict[str, Any]],
    run_id: str,
    now: str,
) -> Tuple[List[Sku], List[ObservationEvent]]:
    events = []
    seen_skus = []
    for key, sku in fresh.items():
        seen_skus.append(sku)
        if key not in current:
            events.append(ObservationEvent(
                scan_run_id=run_id, entity_type="sku",
                entity_key=key, event_type="appeared", observed_at=now,
            ))
        else:
            cur = current[key]
            for f in _SKU_TRACKED_FIELDS:
                old_val = cur.get(f)
                new_val = getattr(sku, f)
                if old_val != new_val and new_val is not None:
                    event_type = "price_changed" if f in _SKU_PRICE_FIELDS else "field_changed"
                    events.append(ObservationEvent(
                        scan_run_id=run_id, entity_type="sku",
                        entity_key=key, event_type=event_type,
                        field_name=f, old_value_raw=str(old_val),
                        new_value_raw=str(new_val), observed_at=now,
                    ))
    return seen_skus, events


def diff_offers(
    fresh: Dict[str, Offer],
    current: Dict[str, Dict[str, Any]],
    run_id: str,
    now: str,
) -> Tuple[List[Offer], List[ObservationEvent]]:
    events = []
    seen_offers = []
    for lid, offer in fresh.items():
        seen_offers.append(offer)
        if lid not in current:
            events.append(ObservationEvent(
                scan_run_id=run_id, entity_type="offer",
                entity_key=lid, event_type="appeared", observed_at=now,
            ))
        else:
            cur = current[lid]
            old_price = cur.get("price_per_case_p")
            new_price = offer.price_per_case_p
            if old_price != new_price and new_price is not None:
                events.append(ObservationEvent(
                    scan_run_id=run_id, entity_type="offer",
                    entity_key=lid, event_type="price_changed",
                    field_name="price_per_case_p",
                    old_value_raw=str(old_price),
                    new_value_raw=str(new_price), observed_at=now,
                ))
            if cur.get("gone_since") is not None:
                events.append(ObservationEvent(
                    scan_run_id=run_id, entity_type="offer",
                    entity_key=lid, event_type="reappeared", observed_at=now,
                ))
    return seen_offers, events


def process_disappearances(
    entity_type: str,
    seen_keys: Set[str],
    current: Dict[str, Dict[str, Any]],
    run_id: str,
    now: str,
    *,
    algolia_complete: bool,
    rest_unchecked_skus: Set[str] = frozenset(),
) -> List[ObservationEvent]:
    """
    rest_unchecked_skus: parent_skus this run couldn't confidently verify as
    present or absent -- either a REST batch genuinely failed, or (Phase 4
    wave pricing) the SKU simply wasn't selected for REST-pricing this run.
    Either way, silence is not evidence of absence, so these are exempted
    from miss-counting the same way -- not just "failed" ones.
    """
    events = []
    if not algolia_complete:
        return events

    for key, cur in current.items():
        if key in seen_keys:
            continue
        if cur.get("gone_since") is not None:
            continue

        if entity_type == "sku":
            psku = cur["parent_sku"]
            if psku in rest_unchecked_skus:
                continue

        misses = cur.get("consecutive_misses", 0) + 1
        if misses >= 2:
            events.append(ObservationEvent(
                scan_run_id=run_id, entity_type=entity_type,
                entity_key=key, event_type="disappeared", observed_at=now,
            ))
    return events


# ---------------------------------------------------------------------------
# Atomic commit
# ---------------------------------------------------------------------------

def commit_sweep(
    conn,
    run_id: str,
    *,
    products: List[Product],
    skus: List[Sku],
    offers: List[Offer],
    events: List[ObservationEvent],
    seen_product_keys: Set[str],
    seen_sku_keys: Set[str],
    seen_offer_keys: Set[str],
    current_products: Dict[str, Dict[str, Any]],
    current_skus: Dict[str, Dict[str, Any]],
    current_offers: Dict[str, Dict[str, Any]],
    algolia_complete: bool,
    rest_unchecked_skus: Set[str],
    final_status: str,
    now: str,
    rest_checked_parent_skus: Set[str] = frozenset(),
) -> None:
    p = placeholder()
    cur = conn.cursor()

    log.info(
        "commit_sweep starting: %d products, %d skus, %d offers, %d events",
        len(products), len(skus), len(offers), len(events),
    )

    try:
        # --- upsert products (batched: execute_values on Postgres, executemany on SQLite) ---
        product_rows = [
            (prod.parent_sku, prod.name, prod.vintage, prod.region,
             prod.subregion, prod.colour, prod.country, prod.producer,
             _adapt_array_param(prod.grape_varieties), prod.product_url,
             run_id, now, run_id, now, 0, None)
            for prod in products
        ]
        if product_rows:
            log.info("Upserting %d products", len(product_rows))
            product_conflict = (
                "ON CONFLICT (parent_sku) DO UPDATE SET "
                "name=excluded.name, vintage=excluded.vintage, region=excluded.region, "
                "subregion=excluded.subregion, colour=excluded.colour, country=excluded.country, "
                "producer=excluded.producer, grape_varieties=excluded.grape_varieties, "
                "product_url=excluded.product_url, last_seen_run_id=excluded.last_seen_run_id, "
                "last_seen_at=excluded.last_seen_at, consecutive_misses=0, gone_since=NULL"
            )
            if is_postgres():
                execute_values(
                    cur,
                    "INSERT INTO products (parent_sku, name, vintage, region, subregion, "
                    "colour, country, producer, grape_varieties, product_url, "
                    "first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at, "
                    "consecutive_misses, gone_since) VALUES %s " + product_conflict,
                    product_rows, page_size=1000,
                )
            else:
                cur.executemany(
                    f"INSERT INTO products (parent_sku, name, vintage, region, subregion, "
                    f"colour, country, producer, grape_varieties, product_url, "
                    f"first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at, "
                    f"consecutive_misses, gone_since) VALUES ({placeholders(16)}) " + product_conflict,
                    product_rows,
                )

        # REST is requested per parent_sku and returns every known format.
        # A successful batch is a freshness observation even when a parent
        # has no pricing entries in the response. Failed batches are excluded
        # by the caller. Update only these parents so Algolia-only listing
        # reconciliation cannot make stale REST data look fresh.
        if rest_checked_parent_skus:
            checked = sorted(rest_checked_parent_skus)
            log.info(
                "Recording successful REST checks for %d products", len(checked)
            )
            batch_size = 400
            for offset in range(0, len(checked), batch_size):
                batch = checked[offset:offset + batch_size]
                cur.execute(
                    f"UPDATE products SET last_rest_checked_at = {p} "
                    f"WHERE parent_sku IN ({placeholders(len(batch))})",
                    (now, *batch),
                )

        # --- upsert skus ---
        sku_rows = [
            (sku.parent_sku, sku.format_code, sku.case_size,
             sku.bottle_volume_ml, sku.least_listing_price_p,
             sku.market_price_p, sku.last_transaction_p,
             sku.highest_bid_p, sku.qty_available, sku.source_agreement,
             sku.is_listed, run_id, now, run_id, now, 0, None)
            for sku in skus
        ]
        if sku_rows:
            log.info("Upserting %d skus", len(sku_rows))
            sku_conflict = (
                "ON CONFLICT (parent_sku, format_code) DO UPDATE SET "
                "least_listing_price_p=excluded.least_listing_price_p, "
                "market_price_p=excluded.market_price_p, "
                "last_transaction_p=excluded.last_transaction_p, "
                "highest_bid_p=excluded.highest_bid_p, "
                "qty_available=excluded.qty_available, "
                "source_agreement=excluded.source_agreement, "
                "is_listed=excluded.is_listed, "
                "last_seen_run_id=excluded.last_seen_run_id, "
                "last_seen_at=excluded.last_seen_at, "
                "consecutive_misses=0, gone_since=NULL"
            )
            if is_postgres():
                execute_values(
                    cur,
                    "INSERT INTO skus (parent_sku, format_code, case_size, bottle_volume_ml, "
                    "least_listing_price_p, market_price_p, last_transaction_p, highest_bid_p, "
                    "qty_available, source_agreement, is_listed, first_seen_run_id, first_seen_at, "
                    "last_seen_run_id, last_seen_at, consecutive_misses, gone_since) VALUES %s "
                    + sku_conflict,
                    sku_rows, page_size=1000,
                )
            else:
                cur.executemany(
                    f"INSERT INTO skus (parent_sku, format_code, case_size, bottle_volume_ml, "
                    f"least_listing_price_p, market_price_p, last_transaction_p, highest_bid_p, "
                    f"qty_available, source_agreement, is_listed, first_seen_run_id, first_seen_at, "
                    f"last_seen_run_id, last_seen_at, consecutive_misses, gone_since) "
                    f"VALUES ({placeholders(17)}) " + sku_conflict,
                    sku_rows,
                )

        # --- upsert offers ---
        offer_rows = [
            (offer.bbx_listing_id, offer.parent_sku, offer.format_code,
             offer.match_confidence, offer.case_size, offer.bottle_volume_ml,
             offer.price_per_case_p, run_id, now, run_id, now, 0, None)
            for offer in offers
        ]
        if offer_rows:
            log.info("Upserting %d offers", len(offer_rows))
            offer_conflict = (
                "ON CONFLICT (bbx_listing_id) DO UPDATE SET "
                "price_per_case_p=excluded.price_per_case_p, "
                "format_code=excluded.format_code, "
                "match_confidence=excluded.match_confidence, "
                "last_seen_run_id=excluded.last_seen_run_id, "
                "last_seen_at=excluded.last_seen_at, "
                "consecutive_misses=0, gone_since=NULL"
            )
            if is_postgres():
                execute_values(
                    cur,
                    "INSERT INTO offers (bbx_listing_id, parent_sku, format_code, "
                    "match_confidence, case_size, bottle_volume_ml, price_per_case_p, "
                    "first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at, "
                    "consecutive_misses, gone_since) VALUES %s " + offer_conflict,
                    offer_rows, page_size=1000,
                )
            else:
                cur.executemany(
                    f"INSERT INTO offers (bbx_listing_id, parent_sku, format_code, "
                    f"match_confidence, case_size, bottle_volume_ml, price_per_case_p, "
                    f"first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at, "
                    f"consecutive_misses, gone_since) VALUES ({placeholders(13)}) " + offer_conflict,
                    offer_rows,
                )

        # --- disappearances (only on completed runs) ---
        if final_status == "completed":
            log.info("Applying disappearance checks")
            _apply_disappearances(cur, "product", seen_product_keys,
                                  current_products, run_id, now,
                                  algolia_complete, rest_unchecked_skus, events)
            _apply_disappearances(cur, "sku", seen_sku_keys,
                                  current_skus, run_id, now,
                                  algolia_complete, rest_unchecked_skus, events)
            _apply_disappearances(cur, "offer", seen_offer_keys,
                                  current_offers, run_id, now,
                                  algolia_complete, rest_unchecked_skus, events)

        # --- insert events (batched) ---
        event_rows = [
            (evt.scan_run_id, evt.observed_at, evt.entity_type,
             evt.entity_key, evt.event_type, evt.field_name,
             evt.old_value_raw, evt.new_value_raw,
             json.dumps(evt.metadata) if evt.metadata else None)
            for evt in events
        ]
        if event_rows:
            log.info("Inserting %d observation events", len(event_rows))
            if is_postgres():
                execute_values(
                    cur,
                    "INSERT INTO observation_events "
                    "(scan_run_id, observed_at, entity_type, entity_key, event_type, "
                    "field_name, old_value_raw, new_value_raw, metadata) VALUES %s "
                    "ON CONFLICT (scan_run_id, entity_type, entity_key, event_type, field_name) DO NOTHING",
                    event_rows, page_size=1000,
                )
            else:
                cur.executemany(
                    f"INSERT INTO observation_events "
                    f"(scan_run_id, observed_at, entity_type, entity_key, event_type, "
                    f"field_name, old_value_raw, new_value_raw, metadata) "
                    f"VALUES ({placeholders(9)}) ON CONFLICT DO NOTHING",
                    event_rows,
                )

        # --- finish run ---
        finished_at = _now_utc()
        cur.execute(
            f"UPDATE scan_runs SET status={p}, finished_at={p} WHERE id={p}",
            (final_status, finished_at, run_id),
        )

        conn.commit()
        log.info("commit_sweep committed as '%s'", final_status)
    except BaseException:
        conn.rollback()
        raise
    finally:
        cur.close()


def _apply_disappearances(
    cur, entity_type, seen_keys, current, run_id, now,
    algolia_complete, rest_unchecked_skus, events,
):
    if not algolia_complete:
        return

    p = placeholder()
    table = {"product": "products", "sku": "skus", "offer": "offers"}[entity_type]

    for key, rec in current.items():
        if key in seen_keys:
            continue
        if rec.get("gone_since") is not None:
            continue

        if entity_type == "sku":
            if rec["parent_sku"] in rest_unchecked_skus:
                continue

        misses = rec.get("consecutive_misses", 0) + 1

        if entity_type == "product":
            pk_clause = f"parent_sku = {p}"
            pk_vals = (key,)
        elif entity_type == "sku":
            parts = key.split("|", 1)
            pk_clause = f"parent_sku = {p} AND format_code = {p}"
            pk_vals = tuple(parts)
        else:
            pk_clause = f"bbx_listing_id = {p}"
            pk_vals = (key,)

        if misses >= 2:
            cur.execute(
                f"UPDATE {table} SET consecutive_misses = {p}, gone_since = {p}, "
                f"last_seen_run_id = {p} WHERE {pk_clause}",
                (misses, now, run_id, *pk_vals),
            )
            events.append(ObservationEvent(
                scan_run_id=run_id, entity_type=entity_type,
                entity_key=key, event_type="disappeared", observed_at=now,
            ))
        else:
            cur.execute(
                f"UPDATE {table} SET consecutive_misses = {p}, "
                f"last_seen_run_id = {p} WHERE {pk_clause}",
                (misses, run_id, *pk_vals),
            )
