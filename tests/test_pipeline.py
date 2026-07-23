# tests/test_pipeline.py
# Unit tests for the pure helpers in core.pipeline and the Algolia
# filter builders in core.fetch_listings.

import core.pipeline as pipeline
from core.pipeline import (
    ScanConfig,
    ScanOutcome,
    OB_NOT_CHECKED, OB_SOLE, OB_COMPETING, OB_UNAVAILABLE, OB_CHANGED,
    build_bbx_url,
    classify_order_book,
    compute_discounts,
    count_variant_nodes,
    derive_case_format,
    extract_variant_prices,
    fetch_rest_pricing,
    fetch_rest_pricing_full,
    order_book_readable,
    threshold_failures,
)
from core.fetch_listings import _build_price_filter, _build_bottle_filter


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def _priced(skus):
    return {s: [{"least_listing_price": 100, "market_price": 130}] for s in skus}


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
    assert disc["ob_status"] == OB_NOT_CHECKED  # no variant prices supplied
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


def test_compute_discounts_includes_order_book_status():
    rest = {"least_listing_price": 80, "market_price": 100, "last_bbx_transaction": 90}
    disc = compute_discounts(rest, variant_prices=[80.0, 90.0, 120.0])
    assert disc["ob_status"] == OB_COMPETING
    assert disc["next_lowest"] == 90.0
    assert disc["pct_next"] == 11.1


# ----------------------------------------------------------------
# classify_order_book — the three-way order-book classification
# ----------------------------------------------------------------

def test_order_book_not_checked_when_prices_none():
    assert classify_order_book(80.0, None) == (OB_NOT_CHECKED, None, None)


def test_order_book_unavailable_when_empty():
    # Empty/malformed order book must NOT read as a confirmed sole seller.
    assert classify_order_book(80.0, []) == (OB_UNAVAILABLE, None, None)


def test_order_book_sole_seller():
    assert classify_order_book(80.0, [80.0]) == (OB_SOLE, None, None)


def test_order_book_tie_at_floor_is_zero_headroom():
    # Two sellers level at £80: the next competing offer is £80, not £100.
    status, nxt, pct = classify_order_book(80.0, [80.0, 80.0, 100.0])
    assert (status, nxt, pct) == (OB_COMPETING, 80.0, 0.0)


def test_order_book_competing_higher_offer():
    status, nxt, pct = classify_order_book(80.0, [80.0, 90.0, 120.0])
    assert (status, nxt, pct) == (OB_COMPETING, 90.0, 11.1)


def test_order_book_changed_when_price_below_ask():
    # A listing cheaper than the REST ask appeared mid-scan.
    assert classify_order_book(80.0, [70.0, 90.0])[0] == OB_CHANGED


def test_order_book_changed_when_floor_disagrees():
    # No offer near the ask floor: REST and GraphQL disagree -> reject.
    assert classify_order_book(80.0, [90.0, 120.0])[0] == OB_CHANGED


def test_order_book_tolerates_float_noise_at_floor():
    assert classify_order_book(80.0, [80.001]) == (OB_SOLE, None, None)


# ----------------------------------------------------------------
# threshold_failures
# ----------------------------------------------------------------

def _disc(**over):
    base = {
        "ask": 80.0, "mkt": 100.0, "last": 100.0,
        "pct_market": 20.0, "pct_last": 20.0,
        "ob_status": OB_COMPETING,
        "next_lowest": 100.0, "pct_next": 20.0,
    }
    base.update(over)
    return base


def test_thresholds_all_pass():
    assert threshold_failures(_disc(), ScanConfig()) == []


def test_thresholds_market_failure():
    failures = threshold_failures(_disc(pct_market=10.0), ScanConfig())
    assert any("mkt" in f for f in failures)


def test_thresholds_missing_last_passes():
    # pct_last is only enforced when computable
    assert threshold_failures(_disc(pct_last=None), ScanConfig()) == []


def test_thresholds_sole_seller_passes_without_next():
    assert threshold_failures(
        _disc(ob_status=OB_SOLE, next_lowest=None, pct_next=None), ScanConfig()
    ) == []


def test_thresholds_competing_next_failure():
    failures = threshold_failures(_disc(ob_status=OB_COMPETING, pct_next=5.0), ScanConfig())
    assert any("next" in f for f in failures)


def test_thresholds_unavailable_order_book_fails():
    failures = threshold_failures(
        _disc(ob_status=OB_UNAVAILABLE, next_lowest=None, pct_next=None), ScanConfig()
    )
    assert any("order book" in f for f in failures)


def test_thresholds_changed_order_book_fails():
    failures = threshold_failures(
        _disc(ob_status=OB_CHANGED, next_lowest=None, pct_next=None), ScanConfig()
    )
    assert any("order book" in f for f in failures)


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
# count_variant_nodes / order_book_readable — parse-integrity guard
# ----------------------------------------------------------------

def test_count_variant_nodes():
    assert count_variant_nodes(_gql_response([100, 90])) == 2
    assert count_variant_nodes({}) == 0


def test_order_book_readable_when_all_variants_parse():
    gql = _gql_response([80, 100])
    assert order_book_readable(gql, extract_variant_prices(gql)) is True


def test_order_book_not_readable_on_partial_parse():
    # Two variant nodes, but one has no parseable price: must NOT be trusted,
    # or the surviving [80] would look like a confirmed sole seller.
    gql = _gql_response([80])
    gql["data"]["products"]["items"][0]["variants"].append({"product": {}})
    prices = extract_variant_prices(gql)
    assert prices == [80.0]
    assert order_book_readable(gql, prices) is False


def test_order_book_not_readable_on_graphql_errors():
    gql = _gql_response([80, 100])
    gql["errors"] = [{"message": "boom"}]
    assert order_book_readable(gql, extract_variant_prices(gql)) is False


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


# ----------------------------------------------------------------
# fetch_rest_pricing — batching, retries, coverage
# ----------------------------------------------------------------

def test_fetch_rest_pricing_success(monkeypatch):
    def fake_post(url, headers=None, json=None, timeout=None):
        skus = json[0]["product_codes"].split(",")
        return _Resp(_priced(skus))

    monkeypatch.setattr(pipeline.requests, "post", fake_post)
    monkeypatch.setattr(pipeline.time, "sleep", lambda *_: None)
    results, debug, failed = fetch_rest_pricing([str(i) for i in range(30)])
    assert len(results) == 30
    assert failed == []


def test_rest_batch_size_fits_a_single_request_up_to_the_measured_cap(monkeypatch):
    """REST_BATCH_SIZE was raised 24 -> 96 (measured cap ~98/request, 2026-07-23)
    so a book-sized SKU list costs a quarter of the requests it used to."""
    calls = []

    def fake_post(url, headers=None, json=None, timeout=None):
        skus = json[0]["product_codes"].split(",")
        calls.append(skus)
        return _Resp(_priced(skus))

    monkeypatch.setattr(pipeline.requests, "post", fake_post)
    monkeypatch.setattr(pipeline.time, "sleep", lambda *_: None)
    skus = [str(i) for i in range(pipeline.REST_BATCH_SIZE)]
    results, debug, failed = fetch_rest_pricing(skus)

    assert len(calls) == 1                  # exactly one request for a full batch
    assert len(calls[0]) == pipeline.REST_BATCH_SIZE
    assert len(results) == pipeline.REST_BATCH_SIZE
    assert failed == []


def test_fetch_rest_pricing_sleeps_a_jittered_interval_after_every_request(monkeypatch):
    """Politeness applies on the happy path too, not just before a retry --
    mirrors fetch_listings.py's REQUEST_JITTER, which sleeps after every
    Algolia request regardless of outcome."""
    sleeps = []

    def fake_post(url, headers=None, json=None, timeout=None):
        skus = json[0]["product_codes"].split(",")
        return _Resp(_priced(skus))

    monkeypatch.setattr(pipeline.requests, "post", fake_post)
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: sleeps.append(s))

    fetch_rest_pricing([str(i) for i in range(10)])

    assert len(sleeps) == 1                 # one request -> one jitter sleep, no retry backoff
    assert pipeline.REST_JITTER[0] <= sleeps[0] <= pipeline.REST_JITTER[1]


def test_fetch_rest_pricing_retries_then_reports_failed_skus(monkeypatch):
    attempts = {"n": 0}

    def fake_post(*a, **k):
        attempts["n"] += 1
        raise RuntimeError("boom")

    monkeypatch.setattr(pipeline.requests, "post", fake_post)
    monkeypatch.setattr(pipeline.time, "sleep", lambda *_: None)

    results, debug, failed = fetch_rest_pricing(["1", "2", "3"])
    assert attempts["n"] == pipeline.REST_MAX_RETRIES   # one batch, retried
    assert set(failed) == {"1", "2", "3"}               # whole batch uncovered
    assert results == {}


def test_fetch_rest_pricing_recovers_on_retry(monkeypatch):
    state = {"n": 0}

    def fake_post(url, headers=None, json=None, timeout=None):
        state["n"] += 1
        if state["n"] == 1:
            raise RuntimeError("transient")
        skus = json[0]["product_codes"].split(",")
        return _Resp(_priced(skus))

    monkeypatch.setattr(pipeline.requests, "post", fake_post)
    monkeypatch.setattr(pipeline.time, "sleep", lambda *_: None)

    results, debug, failed = fetch_rest_pricing(["1", "2"])
    assert failed == []
    assert len(results) == 2


# ----------------------------------------------------------------
# ScanOutcome.coverage
# ----------------------------------------------------------------

def test_coverage_full_when_no_failures():
    assert ScanOutcome(expected_skus=100, queried_skus=100).coverage == 1.0


def test_coverage_partial_on_failed_batches():
    assert ScanOutcome(expected_skus=100, queried_skus=76, failed_skus=24).coverage == 0.76


def test_coverage_is_one_when_nothing_expected():
    assert ScanOutcome().coverage == 1.0


# ----------------------------------------------------------------
# fetch_rest_pricing_full — keeps all format entries
# ----------------------------------------------------------------

def _priced_multi_format(skus):
    """Return multiple format entries per SKU, like the real API."""
    result = {}
    for s in skus:
        result[s] = [
            {"format": "06-00750", "least_listing_price": 290, "market_price": 168,
             "qty_available": 15, "highest_bid": 0, "last_bbx_transaction": 0},
            {"format": "03-01500", "least_listing_price": 179, "market_price": 168,
             "qty_available": 1, "highest_bid": 0, "last_bbx_transaction": 0},
        ]
    return result


def test_fetch_rest_pricing_full_keeps_all_entries(monkeypatch):
    def fake_post(url, headers=None, json=None, timeout=None):
        skus = json[0]["product_codes"].split(",")
        return _Resp(_priced_multi_format(skus))

    monkeypatch.setattr(pipeline.requests, "post", fake_post)
    monkeypatch.setattr(pipeline.time, "sleep", lambda *_: None)
    results, failed = fetch_rest_pricing_full(["SKU1", "SKU2"])
    assert failed == []
    assert len(results) == 2
    assert len(results["SKU1"]) == 2
    assert results["SKU1"][0]["format"] == "06-00750"
    assert results["SKU1"][1]["format"] == "03-01500"


def test_fetch_rest_pricing_full_reports_failures(monkeypatch):
    monkeypatch.setattr(pipeline.requests, "post", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    monkeypatch.setattr(pipeline.time, "sleep", lambda *_: None)
    results, failed = fetch_rest_pricing_full(["SKU1"])
    assert results == {}
    assert failed == ["SKU1"]
