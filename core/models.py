"""
Phase 1B entity models — dataclasses for the scan store.

Pure data: no DB access, no I/O. Conversion helpers turn raw Algolia/REST
dicts into these types at ingestion time.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uuid() -> str:
    return str(uuid.uuid4())


def pounds_to_pence(value) -> Optional[int]:
    if value is None:
        return None
    v = int(round(float(value) * 100))
    return v if v != 0 else None


def format_code_from(case_size, bottle_volume_ml: int) -> str:
    return f"{int(case_size):02d}-{int(bottle_volume_ml):05d}"


def bottle_volume_to_ml(volume_str: str) -> int:
    cleaned = volume_str.lower().replace("cl", "").strip()
    return int(round(float(cleaned) * 10))


# ---------------------------------------------------------------------------
# Entities
# ---------------------------------------------------------------------------

@dataclass
class Product:
    parent_sku: str
    name: Optional[str] = None
    vintage: Optional[int] = None
    region: Optional[str] = None
    subregion: Optional[str] = None
    colour: Optional[str] = None
    country: Optional[str] = None
    producer: Optional[str] = None
    grape_varieties: List[str] = field(default_factory=list)
    product_url: Optional[str] = None

    @classmethod
    def from_algolia_hit(cls, hit: Dict[str, Any]) -> Product:
        vintage = hit.get("vintage")
        if vintage is not None:
            try:
                vintage = int(vintage)
            except (ValueError, TypeError):
                vintage = None
        return cls(
            parent_sku=hit["parent_sku"],
            name=hit.get("name"),
            vintage=vintage,
            region=hit.get("region"),
            subregion=hit.get("subregion"),
            colour=hit.get("colour"),
            country=hit.get("country"),
            producer=hit.get("producer"),
            grape_varieties=hit.get("grape_varieties") or [],
            product_url=hit.get("product_url"),
        )


@dataclass
class Sku:
    parent_sku: str
    format_code: str
    case_size: Optional[int] = None
    bottle_volume_ml: Optional[int] = None
    least_listing_price_p: Optional[int] = None
    market_price_p: Optional[int] = None
    last_transaction_p: Optional[int] = None
    highest_bid_p: Optional[int] = None
    qty_available: Optional[int] = None
    source_agreement: str = "unchecked"
    # Whether Algolia discovery (which runs in full every sweep, independent
    # of REST wave-pricing tiering -- see core/sweep.py's
    # _reconcile_listing_state) saw a live listing for this exact format this
    # run. Listing presence, NOT a derived fact -- never infer "listed" from
    # least_listing_price_p being non-null, which can go stale for up to
    # ROTATION_BUCKETS days after a wine's last listing actually disappears.
    is_listed: bool = False

    @classmethod
    def from_rest_entry(cls, parent_sku: str, entry: Dict[str, Any]) -> Sku:
        fmt = entry["format"]
        parts = fmt.split("-")
        case_size = int(parts[0]) if len(parts) == 2 else None
        bottle_volume_ml = int(parts[1]) if len(parts) == 2 else None
        return cls(
            parent_sku=parent_sku,
            format_code=fmt,
            case_size=case_size,
            bottle_volume_ml=bottle_volume_ml,
            least_listing_price_p=pounds_to_pence(entry.get("least_listing_price")),
            market_price_p=pounds_to_pence(entry.get("market_price")),
            last_transaction_p=pounds_to_pence(entry.get("last_bbx_transaction")),
            highest_bid_p=pounds_to_pence(entry.get("highest_bid")),
            qty_available=entry.get("qty_available"),
        )


@dataclass
class Offer:
    bbx_listing_id: str
    parent_sku: str
    format_code: Optional[str] = None
    match_confidence: str = "inferred"
    case_size: Optional[int] = None
    bottle_volume_ml: Optional[int] = None
    price_per_case_p: Optional[int] = None

    @classmethod
    def from_purchase_option(
        cls, parent_sku: str, opt: Dict[str, Any], known_format_codes: set = None,
    ) -> Offer:
        cs = opt.get("case_size")
        bv_str = opt.get("bottle_volume", "")
        bv_ml = bottle_volume_to_ml(bv_str) if bv_str else None

        if cs is not None and bv_ml is not None:
            inferred = format_code_from(cs, bv_ml)
            if known_format_codes and inferred not in known_format_codes:
                fc = None
                confidence = "unmatched"
            else:
                fc = inferred
                confidence = "inferred"
        else:
            fc = None
            confidence = "unmatched"

        price_raw = None
        prices = opt.get("prices") or {}
        if "price_per_case_exact" in prices:
            price_raw = prices["price_per_case_exact"]

        return cls(
            bbx_listing_id=str(opt["bbx_listing_id"]),
            parent_sku=parent_sku,
            format_code=fc,
            match_confidence=confidence,
            case_size=int(cs) if cs is not None else None,
            bottle_volume_ml=bv_ml,
            price_per_case_p=pounds_to_pence(price_raw),
        )


@dataclass
class ObservationEvent:
    scan_run_id: str
    entity_type: str
    entity_key: str
    event_type: str
    observed_at: str = field(default_factory=_now_utc)
    field_name: str = ""
    old_value_raw: Optional[str] = None
    new_value_raw: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
