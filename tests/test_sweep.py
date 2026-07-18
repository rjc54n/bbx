"""Integration tests for core.sweep — daily sweep orchestration against SQLite."""
import sqlite3

import pytest

from core.db import bootstrap_schema
from core.fetch_listings import FetchResult
from core.models import _now_utc
from core.store import load_current_offers, load_current_products, load_current_skus
import core.sweep as sweep
from core.sweep import (
    _compute_source_agreement,
    _determine_final_status,
    _extract_offers,
    _extract_products,
    _extract_skus,
    _known_format_codes_by_sku,
    run_daily_sweep,
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

def _hit(parent_sku="SKU1", name="Test Wine", vintage=2020, purchase_options=None):
    return {
        "parent_sku": parent_sku,
        "name": name,
        "vintage": vintage,
        "region": "Bordeaux",
        "colour": "Red",
        "country": "France",
        "purchase_options": purchase_options or [
            {
                "bbx_listing_id": f"{parent_sku}-001",
                "case_size": 6,
                "bottle_volume": "75cl",
                "prices": {"price_per_case_exact": 250},
            },
        ],
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
        hits = [_hit("SKU1", purchase_options=[
            {"bbx_listing_id": "X", "case_size": 6, "bottle_volume": "75cl",
             "prices": {"price_per_case_exact": 0}},
        ])]
        offers = _extract_offers(hits, {})
        assert len(offers) == 0

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
# Integration tests: run_daily_sweep
# ---------------------------------------------------------------


def _patch_fetchers(monkeypatch, hits, rest_data, complete=True, failed_skus=None):
    """Monkeypatch both fetch_listings and fetch_rest_pricing_full."""
    result = _fetch_result(hits, complete=complete)
    monkeypatch.setattr(sweep, "fetch_listings", lambda *a, **kw: result)
    monkeypatch.setattr(
        sweep, "fetch_rest_pricing_full",
        lambda *a, **kw: (rest_data, failed_skus or []),
    )


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

        monkeypatch.setattr(sweep, "fetch_listings", boom)

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
        monkeypatch.setattr(sweep, "fetch_listings", lambda *a, **kw: result)
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
