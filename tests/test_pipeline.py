# tests/test_pipeline.py
# Unit tests for the pure helpers in core.pipeline and the Algolia
# filter builders in core.fetch_listings.

from core.pipeline import (
    ScanConfig,
    build_bbx_url,
    compute_discounts,
    derive_case_format,
    extract_variant_prices,
    threshold_failures,
)
from core.fetch_listings import _build_price_filter, _build_bottle_filter


# ----------------------------------------------------------------
# compute_discounts
# ----------------------------------------------------------------

def test_compute_discounts_basic():
    disc = compute_discounts({
        "least_listing_price": 80,
        "market_price": 100,
        "last_bbx_transaction": 90,
    })
    assert disc["ask"] == 80.0
    assert disc["mkt"] == 100.0
    assert disc["pct_market"] == 20.0
    assert disc["pct_last"] == 11.1
    assert disc["next_lowest"] is None
    assert disc["pct_next"] is None


def test_compute_discounts_missing_last_transaction():
    disc = compute_discounts({
        "least_listing_price": 80,
        "market_price": 100,
        "last_bbx_transaction": None,
    })
    assert disc is not None
    assert disc["last"] is None
    assert disc["pct_last"] is None


def test_compute_discounts_invalid_ask_returns_none():
    assert compute_discounts({
        "least_listing_price": "n/a",
        "market_price": 100,
    }) is None


def test_compute_discounts_nonpositive_market_returns_none():
    assert compute_discounts({
        "least_listing_price": 80,
        "market_price": 0,
    }) is None


def test_compute_discounts_next_lowest_selection():
    rest = {"least_listing_price": 80, "market_price": 100, "last_bbx_transaction": 90}

    disc = compute_discounts(rest, variant_prices=[120.0, 90.0, 80.0])
    assert disc["next_lowest"] == 90.0
    assert disc["pct_next"] == 11.1

    # No price above the ask -> sole/cheapest seller, pct_next stays None
    disc = compute_discounts(rest, variant_prices=[80.0, 70.0])
    assert disc["next_lowest"] is None
    assert disc["pct_next"] is None


# ----------------------------------------------------------------
# threshold_failures
# ----------------------------------------------------------------

def _disc(**over):
    base = {
        "ask": 80.0, "mkt": 100.0, "last": 100.0,
        "pct_market": 20.0, "pct_last": 20.0,
        "next_lowest": 100.0, "pct_next": 20.0,
    }
    base.update(over)
    return base


def test_thresholds_all_pass():
    assert threshold_failures(_disc(), ScanConfig()) == []


def test_thresholds_market_failure():
    failures = threshold_failures(_disc(pct_market=10.0), ScanConfig())
    assert any("mkt" in f for f in failures)


def test_thresholds_missing_metrics_pass():
    # pct_last / pct_next are only enforced when computable
    assert threshold_failures(_disc(pct_last=None, pct_next=None), ScanConfig()) == []


def test_thresholds_ask_floor():
    failures = threshold_failures(_disc(ask=0.5), ScanConfig(min_case_price=1.0))
    assert any("floor" in f for f in failures)


# ----------------------------------------------------------------
# extract_variant_prices
# ----------------------------------------------------------------

def _gql_response(prices):
    variants = [
        {"product": {"custom_prices": {"price_per_case": {"amount": {"value": p}}}}}
        for p in prices
    ]
    return {"data": {"products": {"items": [{"variants": variants}]}}}


def test_extract_variant_prices():
    assert extract_variant_prices(_gql_response([100, 90.5])) == [100.0, 90.5]


def test_extract_variant_prices_skips_malformed():
    data = _gql_response([100])
    data["data"]["products"]["items"][0]["variants"].append({"product": {}})
    assert extract_variant_prices(data) == [100.0]


def test_extract_variant_prices_empty_response():
    assert extract_variant_prices({}) == []
    assert extract_variant_prices({"data": {"products": {"items": []}}}) == []


# ----------------------------------------------------------------
# derive_case_format / build_bbx_url
# ----------------------------------------------------------------

def test_derive_case_format_from_parts():
    assert derive_case_format({"case_size": 6, "bottle_volume": "75cl"}) == "6x75cl"


def test_derive_case_format_from_format_string():
    assert derive_case_format({"format": "6 x 75cl"}) == "6x75cl"


def test_derive_case_format_fallback():
    assert derive_case_format({}) == "N/A"


def test_build_bbx_url():
    assert build_bbx_url({"product_path": "/products-x"}) == "https://www.bbr.com/products-x"
    assert build_bbx_url({"product_path": "products-x"}) == "https://www.bbr.com/products-x"
    assert build_bbx_url({"product_url": "https://www.bbr.com/products-x"}) == \
        "https://www.bbr.com/products-x"


# ----------------------------------------------------------------
# Algolia filter builders
# ----------------------------------------------------------------

def test_build_price_filter():
    assert _build_price_filter(None) is None
    assert _build_price_filter([]) is None
    assert _build_price_filter(["up to £200"]) == "(prices.price_per_case:'up to £200')"
    assert _build_price_filter(["a", "b"]) == \
        "(prices.price_per_case:'a' OR prices.price_per_case:'b')"


def test_build_bottle_filter():
    assert _build_bottle_filter("Bottle") == "purchase_options.bottle_order_unit:'Bottle'"
    assert _build_bottle_filter(None) is None
    assert _build_bottle_filter("All Formats") is None
