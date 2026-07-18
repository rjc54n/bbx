"""
Scan store operations for Phase 1B.

All writes use parameterised SQL. The commit_sweep path wraps entity upserts,
event inserts, and run-status update in a single transaction.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from core.db import is_postgres, placeholder, placeholders, _adapt_array_param, _parse_array_column
from core.models import ObservationEvent, Offer, Product, Sku, _now_utc, _uuid


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


def update_run_discovery(
    conn, run_id: str, *,
    algolia_complete: bool,
    algolia_hits_expected: int,
    algolia_hits_collected: int,
) -> None:
    p = placeholder()
    conn.execute(
        f"UPDATE scan_runs SET algolia_complete = {p}, algolia_hits_expected = {p}, "
        f"algolia_hits_collected = {p} WHERE id = {p}",
        (algolia_complete, algolia_hits_expected, algolia_hits_collected, run_id),
    )
    conn.commit()


def update_run_rest(
    conn, run_id: str, *,
    rest_skus_expected: int,
    rest_skus_priced: int,
    rest_skus_failed: int,
    rest_failed_skus: List[str],
) -> None:
    p = placeholder()
    conn.execute(
        f"UPDATE scan_runs SET rest_skus_expected = {p}, rest_skus_priced = {p}, "
        f"rest_skus_failed = {p}, rest_failed_skus = {p} WHERE id = {p}",
        (rest_skus_expected, rest_skus_priced, rest_skus_failed,
         _adapt_array_param(rest_failed_skus), run_id),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Load current state
# ---------------------------------------------------------------------------

def load_current_products(conn) -> Dict[str, Dict[str, Any]]:
    cur = conn.execute("SELECT * FROM products")
    rows = cur.fetchall()
    result = {}
    for row in rows:
        d = dict(row)
        d["grape_varieties"] = _parse_array_column(d.get("grape_varieties"))
        result[d["parent_sku"]] = d
    return result


def load_current_skus(conn) -> Dict[str, Dict[str, Any]]:
    cur = conn.execute("SELECT * FROM skus")
    rows = cur.fetchall()
    return {f"{dict(r)['parent_sku']}|{dict(r)['format_code']}": dict(r) for r in rows}


def load_current_offers(conn) -> Dict[str, Dict[str, Any]]:
    cur = conn.execute("SELECT * FROM offers")
    rows = cur.fetchall()
    return {dict(r)["bbx_listing_id"]: dict(r) for r in rows}


# ---------------------------------------------------------------------------
# Diff logic
# ---------------------------------------------------------------------------

_PRODUCT_TRACKED_FIELDS = ["name", "vintage", "region", "subregion", "colour",
                           "country", "producer", "product_url"]

_SKU_PRICE_FIELDS = ["least_listing_price_p", "market_price_p",
                      "last_transaction_p", "highest_bid_p"]

_SKU_TRACKED_FIELDS = _SKU_PRICE_FIELDS + ["qty_available"]


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
    rest_failed_skus: Set[str] = frozenset(),
) -> List[ObservationEvent]:
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
            if psku in rest_failed_skus:
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
    rest_failed_skus: Set[str],
    final_status: str,
    now: str,
) -> None:
    p = placeholder()
    cur = conn.cursor()

    try:
        # --- upsert products ---
        for prod in products:
            gv = _adapt_array_param(prod.grape_varieties)
            cur.execute(
                f"INSERT INTO products (parent_sku, name, vintage, region, subregion, "
                f"colour, country, producer, grape_varieties, product_url, "
                f"first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at, "
                f"consecutive_misses, gone_since) "
                f"VALUES ({placeholders(16)}) "
                f"ON CONFLICT (parent_sku) DO UPDATE SET "
                f"name=excluded.name, vintage=excluded.vintage, region=excluded.region, "
                f"subregion=excluded.subregion, colour=excluded.colour, country=excluded.country, "
                f"producer=excluded.producer, grape_varieties=excluded.grape_varieties, "
                f"product_url=excluded.product_url, last_seen_run_id=excluded.last_seen_run_id, "
                f"last_seen_at=excluded.last_seen_at, consecutive_misses=0, gone_since=NULL",
                (prod.parent_sku, prod.name, prod.vintage, prod.region,
                 prod.subregion, prod.colour, prod.country, prod.producer,
                 gv, prod.product_url, run_id, now, run_id, now, 0, None),
            )

        # --- upsert skus ---
        for sku in skus:
            cur.execute(
                f"INSERT INTO skus (parent_sku, format_code, case_size, bottle_volume_ml, "
                f"least_listing_price_p, market_price_p, last_transaction_p, highest_bid_p, "
                f"qty_available, source_agreement, first_seen_run_id, first_seen_at, "
                f"last_seen_run_id, last_seen_at, consecutive_misses, gone_since) "
                f"VALUES ({placeholders(16)}) "
                f"ON CONFLICT (parent_sku, format_code) DO UPDATE SET "
                f"least_listing_price_p=excluded.least_listing_price_p, "
                f"market_price_p=excluded.market_price_p, "
                f"last_transaction_p=excluded.last_transaction_p, "
                f"highest_bid_p=excluded.highest_bid_p, "
                f"qty_available=excluded.qty_available, "
                f"source_agreement=excluded.source_agreement, "
                f"last_seen_run_id=excluded.last_seen_run_id, "
                f"last_seen_at=excluded.last_seen_at, "
                f"consecutive_misses=0, gone_since=NULL",
                (sku.parent_sku, sku.format_code, sku.case_size,
                 sku.bottle_volume_ml, sku.least_listing_price_p,
                 sku.market_price_p, sku.last_transaction_p,
                 sku.highest_bid_p, sku.qty_available, sku.source_agreement,
                 run_id, now, run_id, now, 0, None),
            )

        # --- upsert offers ---
        for offer in offers:
            cur.execute(
                f"INSERT INTO offers (bbx_listing_id, parent_sku, format_code, "
                f"match_confidence, case_size, bottle_volume_ml, price_per_case_p, "
                f"first_seen_run_id, first_seen_at, last_seen_run_id, last_seen_at, "
                f"consecutive_misses, gone_since) "
                f"VALUES ({placeholders(13)}) "
                f"ON CONFLICT (bbx_listing_id) DO UPDATE SET "
                f"price_per_case_p=excluded.price_per_case_p, "
                f"format_code=excluded.format_code, "
                f"match_confidence=excluded.match_confidence, "
                f"last_seen_run_id=excluded.last_seen_run_id, "
                f"last_seen_at=excluded.last_seen_at, "
                f"consecutive_misses=0, gone_since=NULL",
                (offer.bbx_listing_id, offer.parent_sku, offer.format_code,
                 offer.match_confidence, offer.case_size, offer.bottle_volume_ml,
                 offer.price_per_case_p, run_id, now, run_id, now, 0, None),
            )

        # --- disappearances (only on completed runs) ---
        if final_status == "completed":
            _apply_disappearances(cur, "product", seen_product_keys,
                                  current_products, run_id, now,
                                  algolia_complete, rest_failed_skus, events)
            _apply_disappearances(cur, "sku", seen_sku_keys,
                                  current_skus, run_id, now,
                                  algolia_complete, rest_failed_skus, events)
            _apply_disappearances(cur, "offer", seen_offer_keys,
                                  current_offers, run_id, now,
                                  algolia_complete, rest_failed_skus, events)

        # --- insert events ---
        for evt in events:
            md = json.dumps(evt.metadata) if evt.metadata else None
            cur.execute(
                f"INSERT INTO observation_events "
                f"(scan_run_id, observed_at, entity_type, entity_key, event_type, "
                f"field_name, old_value_raw, new_value_raw, metadata) "
                f"VALUES ({placeholders(9)}) "
                + ("ON CONFLICT DO NOTHING" if not is_postgres()
                   else "ON CONFLICT (scan_run_id, entity_type, entity_key, event_type, field_name) DO NOTHING"),
                (evt.scan_run_id, evt.observed_at, evt.entity_type,
                 evt.entity_key, evt.event_type, evt.field_name,
                 evt.old_value_raw, evt.new_value_raw, md),
            )

        # --- finish run ---
        finished_at = _now_utc()
        cur.execute(
            f"UPDATE scan_runs SET status={p}, finished_at={p} WHERE id={p}",
            (final_status, finished_at, run_id),
        )

        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        cur.close()


def _apply_disappearances(
    cur, entity_type, seen_keys, current, run_id, now,
    algolia_complete, rest_failed_skus, events,
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
            if rec["parent_sku"] in rest_failed_skus:
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
