"""Integration tests for core.sweep — daily sweep orchestration against SQLite."""
import sqlite3
from datetime import datetime

import pytest

from core.db import bootstrap_schema
from core.fetch_listings import FetchResult
from core.models import _now_utc
from core.store import load_current_offers, load_current_products, load_current_skus
import core.sweep as sweep
from core.sweep import (
    ROTATION_BUCKETS,
    RestPricingPlan,
    _compute_source_agreement,
    _determine_final_status,
    _extract_offers,
    _extract_products,
    _extract_skus,
    _known_format_codes_by_sku,
    _sku_rotation_bucket,
    parse_index_last_update,
    rotation_bucket_for_date,
    run_daily_sweep,
    select_biddable_rest_pricing,
)


@pytest.fixture(autouse=True)
def force_sqlite(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    bootstrap_schema(c)
    return c


# ---------------------------------------------------------------
# Helpers — fake Algolia hits and REST data
# ---------------------------------------------------------------

def _hit(parent_sku="SKU1", name="Test Wine", vintage=2020, bbx_listings=None, index_last_update=None):
    """A prod_biddable-shaped hit (what fetch_biddable_universe actually
    returns) -- listed by default (bbx_listings has one entry); pass
    bbx_listings=[] for an unlisted wine, or a custom list for multiple/
    specific listings."""
    return {
        "parent_sku": parent_sku,
        "name": name,
        "vintage": vintage,
        "region": "Bordeaux",
        "colour": "Red",
        "country": "France",
        "bbx_listings": bbx_listings if bbx_listings is not None else [
            {
                "bbx_listing_id": f"{parent_sku}-001",
                "case_size": 6,
                "bottle_volume": "75cl",
                "prices": {"price_per_case_exact": 250},
            },
        ],
        "index_last_update": index_last_update,
    }


def _rest_entries(parent_sku="SKU1", price=250, formats=None):
    if formats is None:
        formats = [{"format": "06-00750", "least_listing_price": price,
                     "market_price": 300, "last_bbx_transaction": 280,
                     "highest_bid": 240, "qty_available": 5}]
    return {parent_sku: formats}


def _fetch_result(hits, complete=True):
    return FetchResult(
        hits=hits,
        total_index_hits=len(hits),
        collected_count=len(hits),
        truncated=not complete,
    )


# ---------------------------------------------------------------
# Unit tests: _determine_final_status
# ---------------------------------------------------------------


class TestDetermineStatus:
    def test_completed_when_all_good(self):
        assert _determine_final_status(True, 0.95) == "completed"

    def test_partial_when_algolia_incomplete(self):
        assert _determine_final_status(False, 1.0) == "partial"

    def test_partial_when_rest_coverage_low(self):
        assert _determine_final_status(True, 0.5) == "partial"

    def test_completed_at_threshold(self):
        assert _determine_final_status(True, 0.80) == "completed"

    def test_partial_just_below_threshold(self):
        assert _determine_final_status(True, 0.79) == "partial"


# ---------------------------------------------------------------
# Unit tests: extraction helpers
# ---------------------------------------------------------------


class TestExtractProducts:
    def test_extracts_from_hits(self):
        hits = [_hit("A"), _hit("B")]
        products = _extract_products(hits)
        assert set(products.keys()) == {"A", "B"}
        assert products["A"].name == "Test Wine"

    def test_dedupes_by_parent_sku(self):
        hits = [_hit("A", name="First"), _hit("A", name="Second")]
        products = _extract_products(hits)
        assert len(products) == 1
        assert products["A"].name == "First"

    def test_skips_missing_parent_sku(self):
        hits = [{"name": "No SKU"}]
        assert _extract_products(hits) == {}


class TestExtractSkus:
    def test_extracts_all_formats(self):
        rest = {
            "SKU1": [
                {"format": "06-00750", "least_listing_price": 200, "market_price": 300},
                {"format": "12-00750", "least_listing_price": 400, "market_price": 500},
            ]
        }
        skus = _extract_skus(rest)
        assert len(skus) == 2
        assert "SKU1|06-00750" in skus
        assert "SKU1|12-00750" in skus

    def test_empty_rest(self):
        assert _extract_skus({}) == {}


class TestExtractOffers:
    def test_extracts_offers_with_price(self):
        hits = [_hit("SKU1")]
        offers = _extract_offers(hits, {})
        assert len(offers) == 1
        offer = list(offers.values())[0]
        assert offer.parent_sku == "SKU1"
        assert offer.price_per_case_p == 25000

    def test_skips_offers_without_price(self):
        hits = [_hit("SKU1", bbx_listings=[
            {"bbx_listing_id": "X", "case_size": 6, "bottle_volume": "75cl",
             "prices": {"price_per_case_exact": 0}},
        ])]
        offers = _extract_offers(hits, {})
        assert len(offers) == 0

    def test_reads_purchase_options_field_too(self):
        # prod_product (fetch_listings, still used elsewhere -- e.g. the
        # hourly arbitrage bot) denormalises offers under purchase_options[]
        # rather than bbx_listings[]. _extract_offers must handle both.
        hits = [{
            "parent_sku": "SKU1",
            "purchase_options": [
                {"bbx_listing_id": "X", "case_size": 6, "bottle_volume": "75cl",
                 "prices": {"price_per_case_exact": 250}},
            ],
        }]
        offers = _extract_offers(hits, {})
        assert len(offers) == 1
        assert list(offers.values())[0].price_per_case_p == 25000

    def test_matches_known_format_codes(self):
        hits = [_hit("SKU1")]
        known = {"SKU1": {"06-00750"}}
        offers = _extract_offers(hits, known)
        offer = list(offers.values())[0]
        assert offer.format_code == "06-00750"
        assert offer.match_confidence == "inferred"

    def test_unmatched_format_code(self):
        hits = [_hit("SKU1")]
        known = {"SKU1": {"12-00750"}}
        offers = _extract_offers(hits, known)
        offer = list(offers.values())[0]
        assert offer.format_code is None
        assert offer.match_confidence == "unmatched"


class TestKnownFormatCodes:
    def test_collects_codes(self):
        rest = {"SKU1": [{"format": "06-00750"}, {"format": "12-00750"}]}
        codes = _known_format_codes_by_sku(rest)
        assert codes == {"SKU1": {"06-00750", "12-00750"}}

    def test_empty(self):
        assert _known_format_codes_by_sku({}) == {}


class TestSourceAgreement:
    def test_ok_when_prices_match(self):
        from core.models import Sku, Offer
        skus = {"SKU1|06-00750": Sku(parent_sku="SKU1", format_code="06-00750",
                                     least_listing_price_p=25000)}
        offers = {"X": Offer(bbx_listing_id="X", parent_sku="SKU1",
                             format_code="06-00750", price_per_case_p=25000)}
        _compute_source_agreement(skus, offers)
        assert skus["SKU1|06-00750"].source_agreement == "ok"

    def test_disagree_when_prices_differ(self):
        from core.models import Sku, Offer
        skus = {"SKU1|06-00750": Sku(parent_sku="SKU1", format_code="06-00750",
                                     least_listing_price_p=25000)}
        offers = {"X": Offer(bbx_listing_id="X", parent_sku="SKU1",
                             format_code="06-00750", price_per_case_p=20000)}
        _compute_source_agreement(skus, offers)
        assert skus["SKU1|06-00750"].source_agreement == "disagree"

    def test_unchecked_when_no_rest_price(self):
        from core.models import Sku, Offer
        skus = {"SKU1|06-00750": Sku(parent_sku="SKU1", format_code="06-00750",
                                     least_listing_price_p=None)}
        offers = {"X": Offer(bbx_listing_id="X", parent_sku="SKU1",
                             format_code="06-00750", price_per_case_p=25000)}
        _compute_source_agreement(skus, offers)
        assert skus["SKU1|06-00750"].source_agreement == "unchecked"

    def test_offer_floor_uses_cheapest(self):
        from core.models import Sku, Offer
        skus = {"SKU1|06-00750": Sku(parent_sku="SKU1", format_code="06-00750",
                                     least_listing_price_p=20000)}
        offers = {
            "A": Offer(bbx_listing_id="A", parent_sku="SKU1",
                       format_code="06-00750", price_per_case_p=25000),
            "B": Offer(bbx_listing_id="B", parent_sku="SKU1",
                       format_code="06-00750", price_per_case_p=20000),
        }
        _compute_source_agreement(skus, offers)
        assert skus["SKU1|06-00750"].source_agreement == "ok"


# ---------------------------------------------------------------
# Phase 4 Step 6: wave-pricing selection (not yet wired into run_daily_sweep)
# ---------------------------------------------------------------


class TestParseIndexLastUpdate:
    def test_parses_real_observed_formats(self):
        assert parse_index_last_update("23-07-2026 1pm") == datetime(2026, 7, 23, 13, 0)
        assert parse_index_last_update("20-02-2026 9pm") == datetime(2026, 2, 20, 21, 0)
        assert parse_index_last_update("22-01-2026 6am") == datetime(2026, 1, 22, 6, 0)

    def test_midnight_and_noon(self):
        assert parse_index_last_update("23-07-2026 12am") == datetime(2026, 7, 23, 0, 0)
        assert parse_index_last_update("23-07-2026 12pm") == datetime(2026, 7, 23, 12, 0)

    def test_unpadded_day_and_month(self):
        assert parse_index_last_update("1-1-2026 1am") == datetime(2026, 1, 1, 1, 0)

    def test_lowercase_am_pm(self):
        # The real data is always lowercase ("1pm"), not "1PM" -- confirm
        # case isn't fragile either way.
        assert parse_index_last_update("23-07-2026 1PM") == datetime(2026, 7, 23, 13, 0)

    def test_none_empty_and_garbage_return_none(self):
        assert parse_index_last_update(None) is None
        assert parse_index_last_update("") is None
        assert parse_index_last_update("garbage") is None
        assert parse_index_last_update("23-07-2026") is None  # missing time


class TestRotationBucketForDate:
    def test_deterministic_for_same_date(self):
        assert rotation_bucket_for_date("2026-07-18") == rotation_bucket_for_date("2026-07-18")

    def test_regression_known_value(self):
        # Locks in the concrete mapping -- a future change to the bucketing
        # algorithm should be a deliberate, visible decision, not silent.
        assert rotation_bucket_for_date("2026-07-18") == 15

    def test_cycles_through_every_bucket_over_rotation_buckets_days(self):
        from datetime import date, timedelta
        start = date(2026, 7, 18)
        buckets = {
            rotation_bucket_for_date((start + timedelta(days=i)).isoformat())
            for i in range(ROTATION_BUCKETS)
        }
        assert buckets == set(range(ROTATION_BUCKETS))

    def test_wraps_around_after_rotation_buckets_days(self):
        from datetime import date, timedelta
        d0 = date(2026, 7, 18)
        d30 = d0 + timedelta(days=ROTATION_BUCKETS)
        assert rotation_bucket_for_date(d0.isoformat()) == rotation_bucket_for_date(d30.isoformat())


class TestSkuRotationBucket:
    def test_deterministic_across_repeated_calls(self):
        assert _sku_rotation_bucket("20138117265") == _sku_rotation_bucket("20138117265")

    def test_regression_known_value(self):
        assert _sku_rotation_bucket("20138117265") == 26

    def test_stays_within_bucket_range(self):
        for sku in ["A", "B", "20138117265", "SKU-with-dashes", ""]:
            assert 0 <= _sku_rotation_bucket(sku) < ROTATION_BUCKETS

    def test_distributes_reasonably_evenly(self):
        # Not cryptographically rigorous -- just a sanity check that this
        # isn't secretly bucketing everything into #0. 3000 synthetic SKUs
        # over 30 buckets: expect ~100 each, allow generous slack either way.
        from collections import Counter
        counts = Counter(_sku_rotation_bucket(f"SKU{i}") for i in range(3000))
        assert set(counts.keys()) == set(range(ROTATION_BUCKETS))
        assert min(counts.values()) > 40
        assert max(counts.values()) < 200


def _biddable_hit(parent_sku, index_last_update=None):
    return {"parent_sku": parent_sku, "index_last_update": index_last_update}


class TestSelectBiddableRestPricing:
    def test_delta_disabled_by_default_prices_rotation_only(self):
        # SKU2's index_last_update is after last_run, so delta WOULD select
        # it -- but delta_enabled defaults to False, so it must not be priced
        # unless it also happens to land in today's rotation bucket.
        hits = [
            _biddable_hit("SKU1", "18-07-2026 1am"),   # before last run -- unchanged
            _biddable_hit("SKU2", "19-07-2026 1am"),   # after last run -- delta-flagged
        ]
        last_run = datetime(2026, 7, 18, 12, 0)
        plan = select_biddable_rest_pricing(hits, last_run_finished_at=last_run, run_date="2026-07-19")

        assert plan.delta_enabled is False
        assert plan.delta_changed == {"SKU2"}
        # Rotation-only means to_price is EXACTLY the rotation set when the
        # flag is off, regardless of what delta flagged -- this must hold
        # even though SKU2 is delta-changed.
        assert set(plan.to_price) == plan.rotation_selected

    def test_delta_enabled_adds_delta_changed_to_rotation(self):
        hits = [
            _biddable_hit("SKU1", "18-07-2026 1am"),
            _biddable_hit("SKU2", "19-07-2026 1am"),
        ]
        last_run = datetime(2026, 7, 18, 12, 0)
        plan = select_biddable_rest_pricing(
            hits, last_run_finished_at=last_run, run_date="2026-07-19", delta_enabled=True,
        )

        assert plan.delta_enabled is True
        assert set(plan.to_price) == plan.rotation_selected | plan.delta_changed
        assert "SKU2" in plan.to_price  # delta-flagged, must be priced when enabled

    def test_shadow_only_reports_delta_beyond_rotation_regardless_of_flag(self):
        hits = [_biddable_hit(f"SKU{i}", "19-07-2026 1am") for i in range(50)]
        last_run = datetime(2026, 7, 18, 12, 0)

        plan_off = select_biddable_rest_pricing(hits, last_run_finished_at=last_run, run_date="2026-07-19")
        plan_on = select_biddable_rest_pricing(
            hits, last_run_finished_at=last_run, run_date="2026-07-19", delta_enabled=True,
        )

        # delta_changed/shadow_only don't depend on the flag -- only to_price does.
        assert plan_off.delta_changed == plan_on.delta_changed
        assert plan_off.shadow_only == plan_on.shadow_only
        assert plan_off.shadow_only == plan_off.delta_changed - plan_off.rotation_selected
        assert set(plan_off.to_price) == plan_off.rotation_selected
        assert set(plan_on.to_price) == plan_on.rotation_selected | plan_on.delta_changed

    def test_no_last_run_means_no_delta_selection(self):
        # First-ever run: nothing to compare index_last_update against, so
        # nothing should be flagged as "changed" -- there's no baseline.
        hits = [_biddable_hit(f"SKU{i}", "23-07-2026 1pm") for i in range(20)]
        plan = select_biddable_rest_pricing(hits, last_run_finished_at=None, run_date="2026-07-23")
        assert plan.delta_changed == set()
        assert plan.shadow_only == set()
        assert set(plan.to_price) == plan.rotation_selected

    def test_missing_or_unparseable_index_last_update_excluded_from_delta_but_still_rotates(self):
        hits = [
            _biddable_hit("SKU1", None),
            _biddable_hit("SKU2", "garbage"),
            _biddable_hit("SKU3"),  # no index_last_update key at all
        ]
        last_run = datetime(2026, 7, 18, 12, 0)
        plan = select_biddable_rest_pricing(hits, last_run_finished_at=last_run, run_date="2026-07-19")

        assert plan.delta_changed == set()
        # All three are still eligible for the rotation slice on their own terms.
        expected_rotation = {
            h["parent_sku"] for h in hits
            if _sku_rotation_bucket(h["parent_sku"]) == rotation_bucket_for_date("2026-07-19")
        }
        assert plan.rotation_selected == expected_rotation

    def test_hits_missing_parent_sku_are_skipped(self):
        hits = [{"index_last_update": "23-07-2026 1pm"}, _biddable_hit("SKU1", "23-07-2026 1pm")]
        plan = select_biddable_rest_pricing(hits, last_run_finished_at=None, run_date="2026-07-23")
        # Must not raise, and the sku-less hit contributes nothing.
        assert all(psku for psku in plan.to_price)

    def test_rotation_selection_matches_the_underlying_bucket_functions(self):
        hits = [_biddable_hit(f"SKU{i}") for i in range(200)]
        run_date = "2026-07-19"
        plan = select_biddable_rest_pricing(hits, last_run_finished_at=None, run_date=run_date)

        bucket = rotation_bucket_for_date(run_date)
        expected = {h["parent_sku"] for h in hits if _sku_rotation_bucket(h["parent_sku"]) == bucket}
        assert plan.rotation_selected == expected
        assert set(plan.to_price) == expected

    def test_null_and_more_than_30_day_old_checks_are_selected(self):
        run_date = "2026-07-31"
        bucket = rotation_bucket_for_date(run_date)
        fresh = _find_sku_not_in_bucket(bucket)
        missing = _find_sku_not_in_bucket(bucket, exclude={fresh})
        overdue = _find_sku_not_in_bucket(bucket, exclude={fresh, missing})
        hits = [_biddable_hit(sku) for sku in (fresh, missing, overdue)]

        plan = select_biddable_rest_pricing(
            hits,
            last_run_finished_at=datetime(2026, 7, 30, 12, 0),
            run_date=run_date,
            last_rest_checked_at_by_parent={
                fresh: "2026-07-30T02:00:00+00:00",
                missing: None,
                overdue: "2026-06-30T02:00:00+00:00",
            },
        )

        assert plan.overdue_selected == {missing, overdue}
        assert set(plan.to_price) == {missing, overdue}


# ---------------------------------------------------------------
# Integration tests: run_daily_sweep
# ---------------------------------------------------------------


def _patch_fetchers(monkeypatch, hits, rest_data, complete=True, failed_skus=None):
    """Monkeypatch both fetch_biddable_universe and fetch_rest_pricing_full.

    fetch_rest_pricing_full is patched to return rest_data for WHATEVER
    parent_skus it's called with (ignoring the actual argument) -- fine for
    tests where every hit is listed (the common case, since listed-tier
    SKUs are always fully priced regardless of wave-pricing selection), but
    tests that mix listed and unlisted hits and want to assert exactly which
    parent_skus got REST-priced should patch fetch_rest_pricing_full
    themselves to inspect its argument instead of using this helper.
    """
    result = _fetch_result(hits, complete=complete)
    monkeypatch.setattr(sweep, "fetch_biddable_universe", lambda *a, **kw: result)
    monkeypatch.setattr(
        sweep, "fetch_rest_pricing_full",
        lambda *a, **kw: (rest_data, failed_skus or []),
    )


def _patch_fetchers_strict(
    monkeypatch,
    hits,
    rest_data,
    complete=True,
    failed_skus=None,
    requested_batches=None,
):
    """Like _patch_fetchers, but fetch_rest_pricing_full only returns data
    for parent_skus actually present in its `skus` argument -- required for
    any test asserting that a specific SKU WAS or WASN'T REST-priced (tiering,
    rotation, delta selection), since the naive _patch_fetchers mock returns
    the same rest_data regardless of what was actually requested and can't
    tell a correctly-excluded SKU from an incorrectly-included one.
    """
    result = _fetch_result(hits, complete=complete)
    monkeypatch.setattr(sweep, "fetch_biddable_universe", lambda *a, **kw: result)

    def fake_fetch_rest_pricing_full(skus, **kw):
        requested = set(skus)
        if requested_batches is not None:
            requested_batches.append(requested)
        filtered = {k: v for k, v in rest_data.items() if k in requested}
        failed = [s for s in (failed_skus or []) if s in requested]
        return filtered, failed

    monkeypatch.setattr(sweep, "fetch_rest_pricing_full", fake_fetch_rest_pricing_full)


class TestRunDailySweep:
    def test_first_sweep_creates_entities(self, conn, monkeypatch):
        hits = [_hit("SKU1")]
        rest = _rest_entries("SKU1")
        _patch_fetchers(monkeypatch, hits, rest)

        run_id = run_daily_sweep(
            conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18",
        )
        assert run_id is not None

        products = load_current_products(conn)
        assert "SKU1" in products
        assert products["SKU1"]["name"] == "Test Wine"

        skus = load_current_skus(conn)
        assert "SKU1|06-00750" in skus
        assert skus["SKU1|06-00750"]["least_listing_price_p"] == 25000

        offers = load_current_offers(conn)
        assert len(offers) == 1
        offer = list(offers.values())[0]
        assert offer["parent_sku"] == "SKU1"
        assert offer["price_per_case_p"] == 25000

    def test_completed_run_blocks_second(self, conn, monkeypatch):
        hits = [_hit("SKU1")]
        rest = _rest_entries("SKU1")
        _patch_fetchers(monkeypatch, hits, rest)

        run1 = run_daily_sweep(
            conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18",
        )
        assert run1 is not None

        run2 = run_daily_sweep(
            conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18",
        )
        assert run2 is None

    def test_completed_legacy_scope_does_not_block_biddable_baseline(
        self, conn, monkeypatch
    ):
        run_date = "2026-07-18"
        conn.execute(
            "INSERT INTO scan_runs "
            "(id, scope, run_date, status, started_at, finished_at) "
            "VALUES (?, 'full_book', ?, 'completed', ?, ?)",
            (
                "legacy-run",
                run_date,
                "2026-07-18T01:00:00+00:00",
                "2026-07-18T01:10:00+00:00",
            ),
        )
        conn.commit()
        hits = [
            _hit("LEGACY-A", bbx_listings=[]),
            _hit("LEGACY-B", bbx_listings=[]),
        ]
        rest = {
            **_rest_entries("LEGACY-A"),
            **_rest_entries("LEGACY-B"),
        }
        requested = []
        _patch_fetchers_strict(
            monkeypatch,
            hits,
            rest,
            requested_batches=requested,
        )

        run_id = run_daily_sweep(
            conn,
            algolia_app_id="app",
            algolia_api_key="key",
            run_date=run_date,
        )

        assert run_id is not None
        assert requested == [{"LEGACY-A", "LEGACY-B"}]
        row = dict(
            conn.execute(
                "SELECT scope, status FROM scan_runs WHERE id=?",
                (run_id,),
            ).fetchone()
        )
        assert row == {
            "scope": sweep.BIDDABLE_FULL_BOOK_SCOPE,
            "status": "completed",
        }
        products = load_current_products(conn)
        assert all(
            products[sku]["last_rest_checked_at"] is not None
            for sku in ("LEGACY-A", "LEGACY-B")
        )

    def test_partial_run_allows_retry(self, conn, monkeypatch):
        hits = [_hit("SKU1")]
        rest = _rest_entries("SKU1")
        _patch_fetchers(monkeypatch, hits, rest, complete=False)

        run1 = run_daily_sweep(
            conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18",
        )
        assert run1 is not None

        _patch_fetchers(monkeypatch, hits, rest, complete=True)
        run2 = run_daily_sweep(
            conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18",
        )
        assert run2 is not None
        assert run2 != run1

    def test_first_sweep_records_bootstrap_event_not_per_entity(self, conn, monkeypatch):
        hits = [_hit("SKU1")]
        rest = _rest_entries("SKU1")
        _patch_fetchers(monkeypatch, hits, rest)

        run_id = run_daily_sweep(
            conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18",
        )

        cur = conn.execute(
            "SELECT * FROM observation_events WHERE scan_run_id = ?", (run_id,),
        )
        events = [dict(e) for e in cur.fetchall()]
        assert len(events) == 1
        assert events[0]["event_type"] == "bootstrap"
        assert events[0]["entity_type"] == "run"

    def test_appeared_event_after_bootstrap_for_new_entity(self, conn, monkeypatch):
        hits = [_hit("SKU1")]
        rest = _rest_entries("SKU1")
        _patch_fetchers(monkeypatch, hits, rest)
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18")

        hits2 = [_hit("SKU1"), _hit("SKU2")]
        rest2 = {**_rest_entries("SKU1"), **_rest_entries("SKU2")}
        _patch_fetchers(monkeypatch, hits2, rest2)
        run_id2 = run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-19")

        cur = conn.execute(
            "SELECT * FROM observation_events WHERE scan_run_id = ?", (run_id2,),
        )
        event_types = {dict(e)["event_type"] for e in cur.fetchall()}
        assert "appeared" in event_types

    def test_failure_marks_run_failed(self, conn, monkeypatch):
        def boom(*a, **kw):
            raise RuntimeError("simulated Algolia outage")

        monkeypatch.setattr(sweep, "fetch_biddable_universe", boom)

        with pytest.raises(RuntimeError):
            run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18")

        cur = conn.execute("SELECT status, error_message FROM scan_runs")
        row = dict(cur.fetchone())
        assert row["status"] == "failed"
        assert "simulated Algolia outage" in row["error_message"]

    def test_discovery_anomaly_logged_not_fatal(self, conn, monkeypatch, caplog):
        hits = [_hit("SKU1")]
        rest = _rest_entries("SKU1")
        result = FetchResult(hits=hits, total_index_hits=0, collected_count=1, truncated=False)
        monkeypatch.setattr(sweep, "fetch_biddable_universe", lambda *a, **kw: result)
        monkeypatch.setattr(sweep, "fetch_rest_pricing_full", lambda *a, **kw: (rest, []))

        with caplog.at_level("WARNING"):
            run_id = run_daily_sweep(
                conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18",
            )

        assert run_id is not None
        assert any("index likely grew" in r.message for r in caplog.records)

    def test_price_change_on_second_sweep(self, conn, monkeypatch):
        hits = [_hit("SKU1")]
        rest = _rest_entries("SKU1", price=250)
        _patch_fetchers(monkeypatch, hits, rest)
        run_daily_sweep(
            conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18",
        )

        rest2 = _rest_entries("SKU1", price=200)
        _patch_fetchers(monkeypatch, hits, rest2)
        run2 = run_daily_sweep(
            conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-19",
        )

        cur = conn.execute(
            "SELECT * FROM observation_events WHERE scan_run_id = ? AND event_type = 'price_changed'",
            (run2,),
        )
        events = [dict(e) for e in cur.fetchall()]
        assert len(events) > 0
        sku_price_event = [e for e in events if e["entity_type"] == "sku"]
        assert len(sku_price_event) > 0
        assert sku_price_event[0]["old_value_raw"] == "25000"
        assert sku_price_event[0]["new_value_raw"] == "20000"

    def test_disappearance_after_two_misses(self, conn, monkeypatch):
        hits = [_hit("SKU1")]
        rest = _rest_entries("SKU1")
        _patch_fetchers(monkeypatch, hits, rest)
        run_daily_sweep(
            conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18",
        )

        _patch_fetchers(monkeypatch, [], {})
        run_daily_sweep(
            conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-19",
        )
        products = load_current_products(conn)
        assert products["SKU1"]["gone_since"] is None
        assert products["SKU1"]["consecutive_misses"] == 1

        run3 = run_daily_sweep(
            conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-20",
        )
        products = load_current_products(conn)
        assert products["SKU1"]["gone_since"] is not None

        cur = conn.execute(
            "SELECT * FROM observation_events WHERE scan_run_id = ? AND event_type = 'disappeared'",
            (run3,),
        )
        disappeared = [dict(e) for e in cur.fetchall()]
        entity_types = {e["entity_type"] for e in disappeared}
        assert "product" in entity_types
        assert "offer" in entity_types

    def test_reappearance_clears_gone(self, conn, monkeypatch):
        hits = [_hit("SKU1")]
        rest = _rest_entries("SKU1")
        _patch_fetchers(monkeypatch, hits, rest)
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18")

        _patch_fetchers(monkeypatch, [], {})
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-19")
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-20")

        products = load_current_products(conn)
        assert products["SKU1"]["gone_since"] is not None

        _patch_fetchers(monkeypatch, hits, rest)
        run5 = run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-21")

        products = load_current_products(conn)
        assert products["SKU1"]["gone_since"] is None
        assert products["SKU1"]["consecutive_misses"] == 0

        cur = conn.execute(
            "SELECT * FROM observation_events WHERE scan_run_id = ? AND event_type = 'reappeared'",
            (run5,),
        )
        reappeared = [dict(e) for e in cur.fetchall()]
        assert len(reappeared) > 0

    def test_partial_status_skips_disappearances(self, conn, monkeypatch):
        hits = [_hit("SKU1")]
        rest = _rest_entries("SKU1")
        _patch_fetchers(monkeypatch, hits, rest)
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18")

        _patch_fetchers(monkeypatch, [], {}, complete=False)
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-19")

        products = load_current_products(conn)
        assert products["SKU1"]["consecutive_misses"] == 0
        assert products["SKU1"]["gone_since"] is None

    def test_multi_sku_with_failed_rest(self, conn, monkeypatch):
        hits = [_hit("A"), _hit("B")]
        rest = _rest_entries("A")
        _patch_fetchers(monkeypatch, hits, rest, failed_skus=["B"])
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18")

        products = load_current_products(conn)
        assert "A" in products
        assert "B" in products

        skus = load_current_skus(conn)
        assert "A|06-00750" in skus
        assert not any(k.startswith("B|") for k in skus)

        run = dict(
            conn.execute(
                "SELECT status FROM scan_runs ORDER BY started_at DESC LIMIT 1"
            ).fetchone()
        )
        assert run["status"] == "partial"
        assert products["A"]["last_rest_checked_at"] is not None
        assert products["B"]["last_rest_checked_at"] is None

    def test_successful_rest_check_with_no_formats_records_freshness(
        self, conn, monkeypatch
    ):
        sku = "NO-FORMATS"
        hits = [_hit(sku, bbx_listings=[])]
        _patch_fetchers_strict(monkeypatch, hits, {})

        run_id = run_daily_sweep(
            conn,
            algolia_app_id="app",
            algolia_api_key="key",
            run_date="2026-07-18",
        )

        run = dict(
            conn.execute(
                "SELECT status, rest_skus_priced FROM scan_runs WHERE id=?",
                (run_id,),
            ).fetchone()
        )
        assert run == {"status": "completed", "rest_skus_priced": 0}
        assert (
            load_current_products(conn)[sku]["last_rest_checked_at"] is not None
        )
        assert not any(
            key.startswith(f"{sku}|") for key in load_current_skus(conn)
        )

    def test_partial_baseline_retries_only_unchecked_parents(
        self, conn, monkeypatch
    ):
        run_date = "2026-07-18"
        next_date = "2026-07-19"
        next_bucket = rotation_bucket_for_date(next_date)
        sku_a = _find_sku_not_in_bucket(next_bucket)
        sku_b = _find_sku_not_in_bucket(next_bucket, exclude={sku_a})
        hits = [
            _hit(sku_a),
            _hit(sku_b, bbx_listings=[]),
        ]
        rest = {
            **_rest_entries(sku_a),
            **_rest_entries(sku_b),
        }

        first_requests = []
        _patch_fetchers_strict(
            monkeypatch,
            hits,
            _rest_entries(sku_a),
            failed_skus=[sku_b],
            requested_batches=first_requests,
        )
        first_run = run_daily_sweep(
            conn,
            algolia_app_id="app",
            algolia_api_key="key",
            run_date=run_date,
        )
        assert first_requests == [{sku_a, sku_b}]
        assert dict(
            conn.execute(
                "SELECT status FROM scan_runs WHERE id=?", (first_run,)
            ).fetchone()
        )["status"] == "partial"
        products = load_current_products(conn)
        assert products[sku_a]["last_rest_checked_at"] is not None
        assert products[sku_b]["last_rest_checked_at"] is None

        retry_requests = []
        _patch_fetchers_strict(
            monkeypatch,
            hits,
            rest,
            requested_batches=retry_requests,
        )
        retry_run = run_daily_sweep(
            conn,
            algolia_app_id="app",
            algolia_api_key="key",
            run_date=run_date,
        )
        assert retry_requests == [{sku_b}]
        assert dict(
            conn.execute(
                "SELECT status FROM scan_runs WHERE id=?", (retry_run,)
            ).fetchone()
        )["status"] == "completed"
        assert load_current_products(conn)[sku_b]["last_rest_checked_at"] is not None

        later_requests = []
        _patch_fetchers_strict(
            monkeypatch,
            hits,
            rest,
            requested_batches=later_requests,
        )
        run_daily_sweep(
            conn,
            algolia_app_id="app",
            algolia_api_key="key",
            run_date=next_date,
        )
        assert later_requests == [{sku_a}]

    def test_source_agreement_set(self, conn, monkeypatch):
        hits = [_hit("SKU1")]
        rest = _rest_entries("SKU1", price=250)
        _patch_fetchers(monkeypatch, hits, rest)
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18")

        skus = load_current_skus(conn)
        assert skus["SKU1|06-00750"]["source_agreement"] == "ok"

    def test_run_status_completed(self, conn, monkeypatch):
        hits = [_hit("SKU1")]
        rest = _rest_entries("SKU1")
        _patch_fetchers(monkeypatch, hits, rest)
        run_id = run_daily_sweep(
            conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18",
        )

        cur = conn.execute("SELECT status FROM scan_runs WHERE id = ?", (run_id,))
        row = cur.fetchone()
        assert dict(row)["status"] == "completed"

    def test_run_status_partial_when_algolia_truncated(self, conn, monkeypatch):
        hits = [_hit("SKU1")]
        rest = _rest_entries("SKU1")
        _patch_fetchers(monkeypatch, hits, rest, complete=False)
        run_id = run_daily_sweep(
            conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18",
        )

        cur = conn.execute("SELECT status FROM scan_runs WHERE id = ?", (run_id,))
        assert dict(cur.fetchone())["status"] == "partial"

    def test_multiple_products(self, conn, monkeypatch):
        hits = [_hit("A", name="Wine A"), _hit("B", name="Wine B"), _hit("C", name="Wine C")]
        rest = {**_rest_entries("A"), **_rest_entries("B"), **_rest_entries("C")}
        _patch_fetchers(monkeypatch, hits, rest)

        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18")

        products = load_current_products(conn)
        assert len(products) == 3
        skus = load_current_skus(conn)
        assert len(skus) == 3
        offers = load_current_offers(conn)
        assert len(offers) == 3

    def test_multi_format_skus(self, conn, monkeypatch):
        hits = [_hit("SKU1")]
        rest = {"SKU1": [
            {"format": "06-00750", "least_listing_price": 200, "market_price": 300},
            {"format": "12-00750", "least_listing_price": 380, "market_price": 500},
            {"format": "01-01500", "least_listing_price": 100, "market_price": 150},
        ]}
        _patch_fetchers(monkeypatch, hits, rest)

        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18")

        skus = load_current_skus(conn)
        assert len(skus) == 3
        assert skus["SKU1|06-00750"]["least_listing_price_p"] == 20000
        assert skus["SKU1|12-00750"]["least_listing_price_p"] == 38000
        assert skus["SKU1|01-01500"]["least_listing_price_p"] == 10000


# ---------------------------------------------------------------
# Phase 4: tiering (listed always priced, unlisted wave-priced) wired into
# run_daily_sweep. TestRunDailySweep above covers pre-existing behaviour,
# where every hit is listed (via _hit's default bbx_listings entry) --
# these are specifically about what changes once some hits aren't.
# ---------------------------------------------------------------

def _find_sku_in_bucket(bucket, limit=2000, exclude=frozenset()):
    for i in range(limit):
        candidate = f"UNLISTED{i}"
        if candidate not in exclude and _sku_rotation_bucket(candidate) == bucket:
            return candidate
    raise AssertionError(f"no candidate SKU found in bucket {bucket} within {limit} tries")


def _find_sku_not_in_bucket(bucket, limit=2000, exclude=frozenset()):
    # Deterministic (SHA-256-based), so callers needing >1 distinct SKU
    # outside the same bucket MUST pass `exclude` -- calling this twice with
    # identical arguments always returns the identical candidate.
    for i in range(limit):
        candidate = f"UNLISTED{i}"
        if candidate not in exclude and _sku_rotation_bucket(candidate) != bucket:
            return candidate
    raise AssertionError(f"no candidate SKU found outside bucket {bucket} within {limit} tries")


class TestRunDailySweepWavePricing:
    def test_listing_lost_clears_stale_ask_even_outside_rotation_bucket(self, conn, monkeypatch):
        # External review, 2026-07-24: a wine that loses its last live
        # listing becomes wave-priced, and if it isn't selected by rotation/
        # delta that day, a naive implementation would leave its old ask
        # sitting in the DB looking like a live listing for up to
        # ROTATION_BUCKETS days. is_listed must come from THIS run's Algolia
        # discovery (always current) and the stale ask must be cleared
        # immediately, regardless of whether REST was re-queried this run.
        run_date1 = "2026-07-18"
        sku = "TRANSITION1"
        _patch_fetchers_strict(monkeypatch, [_hit(sku)], _rest_entries(sku))  # listed, default shape
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date1)

        skus = load_current_skus(conn)
        assert skus[f"{sku}|06-00750"]["least_listing_price_p"] == 25000
        assert bool(skus[f"{sku}|06-00750"]["is_listed"]) is True
        first_rest_checked_at = load_current_products(conn)[sku][
            "last_rest_checked_at"
        ]

        # Day 2: the listing is gone, and (checked explicitly) this SKU's
        # rotation bucket does NOT match today's -- wave pricing alone would
        # never touch it.
        run_date2 = "2026-07-19"
        bucket2 = rotation_bucket_for_date(run_date2)
        assert _sku_rotation_bucket(sku) != bucket2, "test SKU unexpectedly in today's rotation bucket"

        # rest_entries WOULD price it if requested -- proves any change is
        # from listing-state reconciliation, not REST re-pricing.
        _patch_fetchers_strict(monkeypatch, [_hit(sku, bbx_listings=[])], _rest_entries(sku))
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date2)

        skus = load_current_skus(conn)
        row = skus[f"{sku}|06-00750"]
        assert row["least_listing_price_p"] is None, "stale ask must be cleared, not left from day 1"
        assert bool(row["is_listed"]) is False
        assert (
            load_current_products(conn)[sku]["last_rest_checked_at"]
            == first_rest_checked_at
        )

    def test_relisting_restores_is_listed(self, conn, monkeypatch):
        # The reverse transition, for symmetry: listed -> unlisted (ask
        # cleared, day 2, outside the rotation bucket) -> relisted (day 3).
        # Relisting makes the SKU listed-tier again, so it's unconditionally
        # REST-repriced regardless of rotation -- this confirms is_listed
        # and the ask both correctly come back, not just that the SKU
        # happens to still exist from day 1.
        sku = "TRANSITION2"
        run_date1 = "2026-07-18"
        _patch_fetchers_strict(monkeypatch, [_hit(sku)], _rest_entries(sku))
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date1)
        assert bool(load_current_skus(conn)[f"{sku}|06-00750"]["is_listed"]) is True

        run_date2 = "2026-07-19"
        bucket2 = rotation_bucket_for_date(run_date2)
        assert _sku_rotation_bucket(sku) != bucket2, "test SKU unexpectedly in bucket on day 2"
        _patch_fetchers_strict(monkeypatch, [_hit(sku, bbx_listings=[])], _rest_entries(sku))
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date2)
        assert bool(load_current_skus(conn)[f"{sku}|06-00750"]["is_listed"]) is False

        run_date3 = "2026-07-20"
        bucket3 = rotation_bucket_for_date(run_date3)
        assert _sku_rotation_bucket(sku) != bucket3, "test SKU unexpectedly in bucket on day 3"
        _patch_fetchers_strict(monkeypatch, [_hit(sku)], _rest_entries(sku))  # relisted
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date3)

        row = load_current_skus(conn)[f"{sku}|06-00750"]
        assert bool(row["is_listed"]) is True
        assert row["least_listing_price_p"] == 25000

    def test_first_biddable_run_checks_the_whole_book_not_just_wave_selection(self, conn, monkeypatch):
        # No completed biddable_full_book baseline means every discovered
        # parent with NULL freshness must be checked, not only the normal
        # rotation slice.
        run_date = "2026-07-18"
        bucket = rotation_bucket_for_date(run_date)
        would_be_excluded = [_find_sku_not_in_bucket(bucket, exclude={f"UNLISTED{i}" for i in range(5)})]
        hits = [_hit(sku, bbx_listings=[]) for sku in would_be_excluded]
        rest = {sku: _rest_entries(sku)[sku] for sku in would_be_excluded}
        _patch_fetchers_strict(monkeypatch, hits, rest)

        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date)

        skus = load_current_skus(conn)
        products = load_current_products(conn)
        for sku in would_be_excluded:
            assert f"{sku}|06-00750" in skus, f"{sku} should have been backfilled on the first run"
            assert products[sku]["last_rest_checked_at"] is not None

    def test_listed_wine_priced_regardless_of_rotation_bucket(self, conn, monkeypatch):
        # Anchor run first so this isn't confounded by first-run backfill,
        # which would price everything regardless of tiering anyway.
        _patch_fetchers_strict(monkeypatch, [_hit("ANCHOR4")], _rest_entries("ANCHOR4"))
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18")

        run_date = "2026-07-19"
        bucket = rotation_bucket_for_date(run_date)
        excluded_sku = _find_sku_not_in_bucket(bucket)  # would be skipped if unlisted

        _patch_fetchers_strict(monkeypatch, [_hit(excluded_sku)], _rest_entries(excluded_sku))
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date)

        skus = load_current_skus(conn)
        assert f"{excluded_sku}|06-00750" in skus

    def test_unlisted_wine_outside_rotation_bucket_is_not_priced(self, conn, monkeypatch):
        run_date = "2026-07-19"
        bucket = rotation_bucket_for_date(run_date)
        excluded_sku = _find_sku_not_in_bucket(bucket)
        hits = [_hit(excluded_sku, bbx_listings=[])]
        rest = _rest_entries(excluded_sku)

        # Establish freshness for this parent during the baseline. A newly
        # discovered parent has NULL freshness and is deliberately selected
        # immediately even when it is outside rotation.
        _patch_fetchers_strict(monkeypatch, hits, rest)
        run_daily_sweep(
            conn,
            algolia_app_id="app",
            algolia_api_key="key",
            run_date="2026-07-18",
        )

        requested = []
        _patch_fetchers_strict(
            monkeypatch,
            hits,
            rest,
            requested_batches=requested,
        )
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date)

        assert requested == [set()]

    def test_unlisted_wine_inside_rotation_bucket_is_priced(self, conn, monkeypatch):
        run_date = "2026-07-19"
        bucket = rotation_bucket_for_date(run_date)
        included_sku = _find_sku_in_bucket(bucket)
        hits = [_hit(included_sku, bbx_listings=[])]
        rest = _rest_entries(included_sku)

        _patch_fetchers_strict(monkeypatch, hits, rest)
        run_daily_sweep(
            conn,
            algolia_app_id="app",
            algolia_api_key="key",
            run_date="2026-07-18",
        )

        requested = []
        _patch_fetchers_strict(
            monkeypatch,
            hits,
            rest,
            requested_batches=requested,
        )
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date)

        assert requested == [{included_sku}]

    def test_new_unlisted_parent_is_checked_immediately_outside_rotation(
        self, conn, monkeypatch
    ):
        run_date = "2026-07-19"
        bucket = rotation_bucket_for_date(run_date)
        existing_sku = _find_sku_not_in_bucket(bucket)
        new_sku = _find_sku_not_in_bucket(bucket, exclude={existing_sku})

        baseline_hits = [_hit(existing_sku, bbx_listings=[])]
        baseline_rest = _rest_entries(existing_sku)
        _patch_fetchers_strict(monkeypatch, baseline_hits, baseline_rest)
        run_daily_sweep(
            conn,
            algolia_app_id="app",
            algolia_api_key="key",
            run_date="2026-07-18",
        )

        hits = [
            _hit(existing_sku, bbx_listings=[]),
            _hit(new_sku, bbx_listings=[]),
        ]
        rest = {
            **_rest_entries(existing_sku),
            **_rest_entries(new_sku),
        }
        requested = []
        _patch_fetchers_strict(
            monkeypatch,
            hits,
            rest,
            requested_batches=requested,
        )
        run_daily_sweep(
            conn,
            algolia_app_id="app",
            algolia_api_key="key",
            run_date=run_date,
        )

        assert requested == [{new_sku}]
        assert (
            load_current_products(conn)[new_sku]["last_rest_checked_at"]
            is not None
        )

    def test_unlisted_parent_is_checked_when_freshness_exceeds_30_days(
        self, conn, monkeypatch
    ):
        run_date = "2026-07-19"
        bucket = rotation_bucket_for_date(run_date)
        sku = _find_sku_not_in_bucket(bucket)
        hits = [_hit(sku, bbx_listings=[])]
        rest = _rest_entries(sku)

        _patch_fetchers_strict(monkeypatch, hits, rest)
        run_daily_sweep(
            conn,
            algolia_app_id="app",
            algolia_api_key="key",
            run_date="2026-07-18",
        )
        conn.execute(
            "UPDATE products SET last_rest_checked_at=? WHERE parent_sku=?",
            ("2026-06-01T02:00:00+00:00", sku),
        )
        conn.commit()

        requested = []
        _patch_fetchers_strict(
            monkeypatch,
            hits,
            rest,
            requested_batches=requested,
        )
        run_daily_sweep(
            conn,
            algolia_app_id="app",
            algolia_api_key="key",
            run_date=run_date,
        )

        assert requested == [{sku}]
        assert (
            load_current_products(conn)[sku]["last_rest_checked_at"]
            != "2026-06-01T02:00:00+00:00"
        )

    def test_unlisted_skip_never_counts_as_a_miss(self, conn, monkeypatch):
        # Get the SKU into the store on a day its rotation bucket selects it...
        run_date1 = "2026-07-18"
        bucket1 = rotation_bucket_for_date(run_date1)
        sku = _find_sku_in_bucket(bucket1)
        _patch_fetchers(monkeypatch, [_hit(sku, bbx_listings=[])], _rest_entries(sku))
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date1)
        assert load_current_skus(conn)[f"{sku}|06-00750"]["consecutive_misses"] == 0

        # ...then run several more days where its bucket does NOT match. A
        # wave-pricing skip must never accumulate a miss, however many days
        # in a row it happens -- unlike a genuine disappearance (2 misses ->
        # gone_since), there's no "eventually give up" here because we never
        # actually looked.
        for run_date in ["2026-07-19", "2026-07-20", "2026-07-21"]:
            bucket = rotation_bucket_for_date(run_date)
            assert _sku_rotation_bucket(sku) != bucket, "test SKU unexpectedly selected"
            _patch_fetchers(monkeypatch, [_hit(sku, bbx_listings=[])], {})
            run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date)

            skus = load_current_skus(conn)
            assert skus[f"{sku}|06-00750"]["consecutive_misses"] == 0, f"miss counted on {run_date}"
            assert skus[f"{sku}|06-00750"]["gone_since"] is None

    def test_rest_skus_expected_counts_only_attempted_not_discovered(self, conn, monkeypatch):
        run_date = "2026-07-19"
        bucket = rotation_bucket_for_date(run_date)
        listed_sku = _find_sku_not_in_bucket(bucket)
        included_unlisted = _find_sku_in_bucket(bucket)
        excluded_unlisted = _find_sku_not_in_bucket(bucket, exclude={listed_sku})

        hits = [
            _hit(listed_sku),
            _hit(included_unlisted, bbx_listings=[]),
            _hit(excluded_unlisted, bbx_listings=[]),
        ]
        rest = {**_rest_entries(listed_sku), **_rest_entries(included_unlisted),
                **_rest_entries(excluded_unlisted)}
        _patch_fetchers_strict(monkeypatch, hits, rest)
        run_daily_sweep(
            conn,
            algolia_app_id="app",
            algolia_api_key="key",
            run_date="2026-07-18",
        )

        _patch_fetchers(monkeypatch, hits, rest)

        run_id = run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date)

        row = dict(conn.execute("SELECT rest_skus_expected FROM scan_runs WHERE id=?", (run_id,)).fetchone())
        # 3 discovered, but only 2 attempted (listed + the in-bucket unlisted
        # one) -- excluded_unlisted must not inflate "expected".
        assert row["rest_skus_expected"] == 2

    def test_wave_pricing_stats_persisted(self, conn, monkeypatch):
        run_date = "2026-07-19"
        bucket = rotation_bucket_for_date(run_date)
        included = _find_sku_in_bucket(bucket)
        excluded = _find_sku_not_in_bucket(bucket)

        hits = [_hit(included, bbx_listings=[]), _hit(excluded, bbx_listings=[])]
        rest = {**_rest_entries(included), **_rest_entries(excluded)}
        _patch_fetchers(monkeypatch, hits, rest)
        run_daily_sweep(
            conn,
            algolia_app_id="app",
            algolia_api_key="key",
            run_date="2026-07-18",
        )

        _patch_fetchers(monkeypatch, hits, rest)

        run_id = run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date)

        row = dict(conn.execute(
            "SELECT wave_delta_enabled, wave_rotation_count, wave_priced_count "
            "FROM scan_runs WHERE id=?", (run_id,),
        ).fetchone())
        assert row["wave_delta_enabled"] == 0
        assert row["wave_rotation_count"] == 1  # only `included`
        assert row["wave_priced_count"] == 1

    def test_index_last_update_flagged_persisted_for_listed_tier(self, conn, monkeypatch):
        # External review, 2026-07-24: shadow-mode counts over the unlisted
        # tier alone can't validate index_last_update, because there's no
        # ground truth there most days. The listed tier IS always fully
        # REST-priced and diffed, so persisting per-SKU flags for it is what
        # makes a later precision/recall query against price_changed events
        # possible.
        anchor_sku = "FLAGCHECK"
        _patch_fetchers(monkeypatch, [_hit(anchor_sku, index_last_update="1-1-2020 1am")], _rest_entries(anchor_sku))
        run1 = run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-18")
        # No baseline on the first run -- nothing should be flagged yet.
        events1 = [dict(e) for e in conn.execute(
            "SELECT * FROM observation_events WHERE scan_run_id=? AND event_type='index_last_update_flagged'",
            (run1,),
        ).fetchall()]
        assert events1 == []

        # Day 2: same listed wine, but its index_last_update is now safely
        # in the future relative to day 1's finished_at -- must be flagged.
        _patch_fetchers(
            monkeypatch,
            [_hit(anchor_sku, index_last_update="1-1-2030 1am")],
            _rest_entries(anchor_sku),
        )
        run2 = run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date="2026-07-19")

        events2 = [dict(e) for e in conn.execute(
            "SELECT * FROM observation_events WHERE scan_run_id=? AND event_type='index_last_update_flagged'",
            (run2,),
        ).fetchall()]
        assert len(events2) == 1
        assert events2[0]["entity_type"] == "product"
        assert events2[0]["entity_key"] == anchor_sku

    def test_delta_enabled_prices_an_unlisted_sku_outside_the_rotation_bucket(self, conn, monkeypatch):
        # Day 1: establish a completed run so there's a finished_at baseline
        # for delta selection to compare against.
        run_date1 = "2026-07-18"
        run_date2 = "2026-07-19"
        bucket2 = rotation_bucket_for_date(run_date2)
        sku = _find_sku_not_in_bucket(bucket2)
        baseline_hits = [
            _hit(sku, bbx_listings=[], index_last_update="1-1-2020 1am")
        ]
        _patch_fetchers(monkeypatch, baseline_hits, _rest_entries(sku))
        run1 = run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date1)
        assert dict(conn.execute("SELECT status FROM scan_runs WHERE id=?", (run1,)).fetchone())["status"] == "completed"

        # Day 2: an unlisted wine outside today's rotation bucket, but its
        # index_last_update is far in the future (safely after "now",
        # whatever the real wall-clock is when this test runs) -- delta
        # selection should flag it as changed and price it despite rotation
        # excluding it, only because delta_enabled=True this time.
        _patch_fetchers_strict(
            monkeypatch,
            [_hit(sku, bbx_listings=[], index_last_update="1-1-2030 1am")],
            _rest_entries(sku),
        )
        run_daily_sweep(
            conn, algolia_app_id="app", algolia_api_key="key",
            run_date=run_date2, delta_enabled=True,
        )

        skus = load_current_skus(conn)
        assert f"{sku}|06-00750" in skus

    def test_delta_disabled_does_not_price_the_same_sku(self, conn, monkeypatch):
        # Same setup as above, but delta_enabled left at its default (False)
        # -- the delta-flagged-but-rotation-excluded SKU must NOT be priced.
        run_date1 = "2026-07-18"
        run_date2 = "2026-07-19"
        bucket2 = rotation_bucket_for_date(run_date2)
        sku = _find_sku_not_in_bucket(bucket2)
        baseline_hits = [
            _hit(sku, bbx_listings=[], index_last_update="1-1-2020 1am")
        ]
        _patch_fetchers(monkeypatch, baseline_hits, _rest_entries(sku))
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date1)

        requested = []
        _patch_fetchers_strict(
            monkeypatch,
            [_hit(sku, bbx_listings=[], index_last_update="1-1-2030 1am")],
            _rest_entries(sku),
            requested_batches=requested,
        )
        run_daily_sweep(conn, algolia_app_id="app", algolia_api_key="key", run_date=run_date2)

        assert requested == [set()]
