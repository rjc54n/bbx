"""Integration tests for core.store — scan store operations against SQLite."""
import sqlite3
from unittest.mock import MagicMock

import pytest

from core.db import bootstrap_schema
from core.models import ObservationEvent, Offer, Product, Sku
from core.store import (
    commit_sweep,
    diff_offers,
    diff_products,
    diff_skus,
    load_current_offers,
    load_current_products,
    load_current_skus,
    mark_run_failed,
    process_disappearances,
    start_run,
    update_run_discovery,
    update_run_rest,
    update_run_wave_pricing,
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


NOW = "2026-07-18T02:00:00Z"
NOW2 = "2026-07-19T02:00:00Z"


def _product(parent_sku="SKU1", name="Test Wine", vintage=2020):
    return Product(parent_sku=parent_sku, name=name, vintage=vintage,
                   region="Bordeaux", colour="Red", country="France")


def _sku(parent_sku="SKU1", fmt="06-00750", price_p=25000):
    return Sku(parent_sku=parent_sku, format_code=fmt, case_size=6,
               bottle_volume_ml=750, least_listing_price_p=price_p,
               market_price_p=30000)


def _offer(lid="100", parent_sku="SKU1", price_p=25000, fmt="06-00750"):
    return Offer(bbx_listing_id=lid, parent_sku=parent_sku,
                 format_code=fmt, price_per_case_p=price_p, case_size=6,
                 bottle_volume_ml=750)


# ---------------------------------------------------------------------------
# start_run
# ---------------------------------------------------------------------------

class TestStartRun:
    def test_creates_run(self, conn):
        run_id = start_run(conn, scope="full_book", run_date="2026-07-18")
        assert run_id is not None
        cur = conn.execute("SELECT status FROM scan_runs WHERE id=?", (run_id,))
        assert cur.fetchone()[0] == "running"

    def test_blocks_if_completed_exists(self, conn):
        rid = start_run(conn, scope="full_book", run_date="2026-07-18")
        conn.execute("UPDATE scan_runs SET status='completed' WHERE id=?", (rid,))
        conn.commit()
        assert start_run(conn, scope="full_book", run_date="2026-07-18") is None

    def test_allows_retry_after_failed(self, conn):
        rid = start_run(conn, scope="full_book", run_date="2026-07-18")
        conn.execute("UPDATE scan_runs SET status='failed' WHERE id=?", (rid,))
        conn.commit()
        rid2 = start_run(conn, scope="full_book", run_date="2026-07-18")
        assert rid2 is not None and rid2 != rid

    def test_allows_retry_after_partial(self, conn):
        rid = start_run(conn, scope="full_book", run_date="2026-07-18")
        conn.execute("UPDATE scan_runs SET status='partial' WHERE id=?", (rid,))
        conn.commit()
        rid2 = start_run(conn, scope="full_book", run_date="2026-07-18")
        assert rid2 is not None


# ---------------------------------------------------------------------------
# update_run_wave_pricing (Phase 4 Step 6 auditability)
# ---------------------------------------------------------------------------

class TestUpdateRunWavePricing:
    def test_persists_all_fields(self, conn):
        run_id = start_run(conn, scope="biddable", run_date="2026-07-24")
        update_run_wave_pricing(
            conn, run_id,
            wave_delta_enabled=False,
            wave_rotation_count=1748,
            wave_delta_changed_count=1800,
            wave_shadow_only_count=1650,
            wave_priced_count=1748,
        )
        row = dict(conn.execute(
            "SELECT * FROM scan_runs WHERE id=?", (run_id,),
        ).fetchone())
        assert row["wave_delta_enabled"] == 0  # SQLite has no native BOOLEAN
        assert row["wave_rotation_count"] == 1748
        assert row["wave_delta_changed_count"] == 1800
        assert row["wave_shadow_only_count"] == 1650
        assert row["wave_priced_count"] == 1748

    def test_delta_enabled_persists_true(self, conn):
        run_id = start_run(conn, scope="biddable", run_date="2026-07-24")
        update_run_wave_pricing(
            conn, run_id,
            wave_delta_enabled=True,
            wave_rotation_count=1748,
            wave_delta_changed_count=1800,
            wave_shadow_only_count=1650,
            wave_priced_count=3398,
        )
        row = dict(conn.execute(
            "SELECT wave_delta_enabled FROM scan_runs WHERE id=?", (run_id,),
        ).fetchone())
        assert row["wave_delta_enabled"] == 1


# ---------------------------------------------------------------------------
# Diff logic
# ---------------------------------------------------------------------------

class TestDiffProducts:
    def test_new_product_appears(self):
        fresh = {"SKU1": _product()}
        _, events = diff_products(fresh, {}, "run1", NOW)
        assert len(events) == 1
        assert events[0].event_type == "appeared"

    def test_unchanged_product_no_event(self):
        cur = {"SKU1": {"name": "Test Wine", "vintage": 2020, "region": "Bordeaux",
                        "subregion": None, "colour": "Red", "country": "France",
                        "producer": None, "product_url": None}}
        fresh = {"SKU1": _product()}
        _, events = diff_products(fresh, cur, "run1", NOW)
        assert len(events) == 0

    def test_changed_name_emits_event(self):
        cur = {"SKU1": {"name": "Old Name", "vintage": 2020, "region": "Bordeaux",
                        "subregion": None, "colour": "Red", "country": "France",
                        "producer": None, "product_url": None}}
        fresh = {"SKU1": _product(name="New Name")}
        _, events = diff_products(fresh, cur, "run1", NOW)
        assert len(events) == 1
        assert events[0].field_name == "name"
        assert events[0].old_value_raw == "Old Name"


class TestDiffSkus:
    def test_new_sku(self):
        fresh = {"SKU1|06-00750": _sku()}
        _, events = diff_skus(fresh, {}, "run1", NOW)
        assert events[0].event_type == "appeared"

    def test_price_change(self):
        cur = {"SKU1|06-00750": {"least_listing_price_p": 25000, "market_price_p": 30000,
                                  "last_transaction_p": None, "highest_bid_p": None,
                                  "qty_available": None}}
        fresh = {"SKU1|06-00750": _sku(price_p=20000)}
        _, events = diff_skus(fresh, cur, "run1", NOW)
        assert len(events) == 1
        assert events[0].event_type == "price_changed"
        assert events[0].field_name == "least_listing_price_p"


class TestDiffOffers:
    def test_new_offer(self):
        fresh = {"100": _offer()}
        _, events = diff_offers(fresh, {}, "run1", NOW)
        assert events[0].event_type == "appeared"

    def test_price_change(self):
        cur = {"100": {"price_per_case_p": 25000, "gone_since": None}}
        fresh = {"100": _offer(price_p=20000)}
        _, events = diff_offers(fresh, cur, "run1", NOW)
        assert len(events) == 1
        assert events[0].event_type == "price_changed"

    def test_reappearance(self):
        cur = {"100": {"price_per_case_p": 25000, "gone_since": "2026-07-17T00:00:00Z"}}
        fresh = {"100": _offer()}
        _, events = diff_offers(fresh, cur, "run1", NOW)
        reappeared = [e for e in events if e.event_type == "reappeared"]
        assert len(reappeared) == 1


# ---------------------------------------------------------------------------
# Disappearances
# ---------------------------------------------------------------------------

class TestDisappearances:
    def test_no_disappearance_without_algolia_complete(self):
        cur = {"SKU1": {"parent_sku": "SKU1", "consecutive_misses": 1, "gone_since": None}}
        events = process_disappearances(
            "product", set(), cur, "run1", NOW, algolia_complete=False,
        )
        assert len(events) == 0

    def test_first_miss_no_event(self):
        cur = {"SKU1": {"parent_sku": "SKU1", "consecutive_misses": 0, "gone_since": None}}
        events = process_disappearances(
            "product", set(), cur, "run1", NOW, algolia_complete=True,
        )
        assert len(events) == 0

    def test_second_miss_emits_disappeared(self):
        cur = {"SKU1": {"parent_sku": "SKU1", "consecutive_misses": 1, "gone_since": None}}
        events = process_disappearances(
            "product", set(), cur, "run1", NOW, algolia_complete=True,
        )
        assert len(events) == 1
        assert events[0].event_type == "disappeared"

    def test_already_gone_skipped(self):
        cur = {"SKU1": {"parent_sku": "SKU1", "consecutive_misses": 5,
                        "gone_since": "2026-07-16T00:00:00Z"}}
        events = process_disappearances(
            "product", set(), cur, "run1", NOW, algolia_complete=True,
        )
        assert len(events) == 0

    def test_seen_entity_not_disappeared(self):
        cur = {"SKU1": {"parent_sku": "SKU1", "consecutive_misses": 1, "gone_since": None}}
        events = process_disappearances(
            "product", {"SKU1"}, cur, "run1", NOW, algolia_complete=True,
        )
        assert len(events) == 0

    def test_sku_skipped_if_rest_failed(self):
        cur = {"SKU1|06-00750": {"parent_sku": "SKU1", "consecutive_misses": 1,
                                  "gone_since": None}}
        events = process_disappearances(
            "sku", set(), cur, "run1", NOW,
            algolia_complete=True, rest_failed_skus={"SKU1"},
        )
        assert len(events) == 0

    def test_sku_disappears_if_rest_succeeded(self):
        cur = {"SKU1|06-00750": {"parent_sku": "SKU1", "consecutive_misses": 1,
                                  "gone_since": None}}
        events = process_disappearances(
            "sku", set(), cur, "run1", NOW,
            algolia_complete=True, rest_failed_skus={"OTHER"},
        )
        assert len(events) == 1
        assert events[0].event_type == "disappeared"


# ---------------------------------------------------------------------------
# commit_sweep (atomic write + round-trip)
# ---------------------------------------------------------------------------

class TestCommitSweep:
    def test_full_round_trip(self, conn):
        run_id = start_run(conn, scope="full_book", run_date="2026-07-18")

        prod = _product()
        sku = _sku()
        offer = _offer()

        events = [
            ObservationEvent(scan_run_id=run_id, entity_type="product",
                             entity_key="SKU1", event_type="appeared", observed_at=NOW),
            ObservationEvent(scan_run_id=run_id, entity_type="sku",
                             entity_key="SKU1|06-00750", event_type="appeared", observed_at=NOW),
            ObservationEvent(scan_run_id=run_id, entity_type="offer",
                             entity_key="100", event_type="appeared", observed_at=NOW),
        ]

        commit_sweep(
            conn, run_id,
            products=[prod], skus=[sku], offers=[offer], events=events,
            seen_product_keys={"SKU1"}, seen_sku_keys={"SKU1|06-00750"},
            seen_offer_keys={"100"},
            current_products={}, current_skus={}, current_offers={},
            algolia_complete=True, rest_failed_skus=set(),
            final_status="completed", now=NOW,
        )

        prods = load_current_products(conn)
        assert "SKU1" in prods
        assert prods["SKU1"]["last_seen_run_id"] == run_id

        sk = load_current_skus(conn)
        assert "SKU1|06-00750" in sk
        assert sk["SKU1|06-00750"]["least_listing_price_p"] == 25000

        off = load_current_offers(conn)
        assert "100" in off

        cur = conn.execute("SELECT count(*) FROM observation_events")
        assert cur.fetchone()[0] == 3

        cur = conn.execute("SELECT status FROM scan_runs WHERE id=?", (run_id,))
        assert cur.fetchone()[0] == "completed"

    def test_idempotent_retry(self, conn):
        run_id = start_run(conn, scope="full_book", run_date="2026-07-18")
        prod = _product()
        events = [ObservationEvent(scan_run_id=run_id, entity_type="product",
                                    entity_key="SKU1", event_type="appeared", observed_at=NOW)]
        kwargs = dict(
            products=[prod], skus=[], offers=[], events=events,
            seen_product_keys={"SKU1"}, seen_sku_keys=set(),
            seen_offer_keys=set(),
            current_products={}, current_skus={}, current_offers={},
            algolia_complete=True, rest_failed_skus=set(),
            final_status="completed", now=NOW,
        )
        commit_sweep(conn, run_id, **kwargs)
        # Second commit with same events should not raise (ON CONFLICT DO NOTHING)
        commit_sweep(conn, run_id, **kwargs)
        cur = conn.execute("SELECT count(*) FROM observation_events")
        assert cur.fetchone()[0] == 1

    def test_disappearance_cycle(self, conn):
        # Scan 1: product appears
        rid1 = start_run(conn, scope="full_book", run_date="2026-07-18")
        prod = _product()
        events1 = [ObservationEvent(scan_run_id=rid1, entity_type="product",
                                     entity_key="SKU1", event_type="appeared",
                                     observed_at=NOW)]
        commit_sweep(
            conn, rid1,
            products=[prod], skus=[], offers=[], events=events1,
            seen_product_keys={"SKU1"}, seen_sku_keys=set(),
            seen_offer_keys=set(),
            current_products={}, current_skus={}, current_offers={},
            algolia_complete=True, rest_failed_skus=set(),
            final_status="completed", now=NOW,
        )

        # Scan 2: product missing (first miss)
        rid2 = start_run(conn, scope="full_book", run_date="2026-07-19")
        cur_prods = load_current_products(conn)
        commit_sweep(
            conn, rid2,
            products=[], skus=[], offers=[], events=[],
            seen_product_keys=set(), seen_sku_keys=set(),
            seen_offer_keys=set(),
            current_products=cur_prods, current_skus={}, current_offers={},
            algolia_complete=True, rest_failed_skus=set(),
            final_status="completed", now=NOW2,
        )
        prods = load_current_products(conn)
        assert prods["SKU1"]["consecutive_misses"] == 1
        assert prods["SKU1"]["gone_since"] is None

        # Scan 3: product missing again (second miss → gone)
        rid3 = start_run(conn, scope="full_book", run_date="2026-07-20")
        cur_prods = load_current_products(conn)
        commit_sweep(
            conn, rid3,
            products=[], skus=[], offers=[], events=[],
            seen_product_keys=set(), seen_sku_keys=set(),
            seen_offer_keys=set(),
            current_products=cur_prods, current_skus={}, current_offers={},
            algolia_complete=True, rest_failed_skus=set(),
            final_status="completed", now="2026-07-20T02:00:00Z",
        )
        prods = load_current_products(conn)
        assert prods["SKU1"]["consecutive_misses"] == 2
        assert prods["SKU1"]["gone_since"] is not None

        evts = conn.execute(
            "SELECT event_type FROM observation_events WHERE entity_key='SKU1' "
            "ORDER BY observed_at"
        ).fetchall()
        types = [e[0] for e in evts]
        assert types == ["appeared", "disappeared"]

    def test_reappearance_clears_gone(self, conn):
        # Set up a gone product
        rid1 = start_run(conn, scope="full_book", run_date="2026-07-18")
        prod = _product()
        commit_sweep(
            conn, rid1,
            products=[prod], skus=[], offers=[], events=[
                ObservationEvent(scan_run_id=rid1, entity_type="product",
                                 entity_key="SKU1", event_type="appeared", observed_at=NOW)
            ],
            seen_product_keys={"SKU1"}, seen_sku_keys=set(), seen_offer_keys=set(),
            current_products={}, current_skus={}, current_offers={},
            algolia_complete=True, rest_failed_skus=set(),
            final_status="completed", now=NOW,
        )
        # Manually mark as gone
        conn.execute("UPDATE products SET consecutive_misses=2, gone_since=? WHERE parent_sku='SKU1'", (NOW,))
        conn.commit()

        # Now it reappears
        rid2 = start_run(conn, scope="full_book", run_date="2026-07-19")
        cur_prods = load_current_products(conn)
        _, reapp_events = diff_products({"SKU1": prod}, cur_prods, rid2, NOW2)

        commit_sweep(
            conn, rid2,
            products=[prod], skus=[], offers=[], events=reapp_events,
            seen_product_keys={"SKU1"}, seen_sku_keys=set(), seen_offer_keys=set(),
            current_products=cur_prods, current_skus={}, current_offers={},
            algolia_complete=True, rest_failed_skus=set(),
            final_status="completed", now=NOW2,
        )
        prods = load_current_products(conn)
        assert prods["SKU1"]["gone_since"] is None
        assert prods["SKU1"]["consecutive_misses"] == 0

    def test_partial_status_does_not_run_disappearances(self, conn):
        rid1 = start_run(conn, scope="full_book", run_date="2026-07-18")
        prod = _product()
        commit_sweep(
            conn, rid1,
            products=[prod], skus=[], offers=[], events=[
                ObservationEvent(scan_run_id=rid1, entity_type="product",
                                 entity_key="SKU1", event_type="appeared", observed_at=NOW)
            ],
            seen_product_keys={"SKU1"}, seen_sku_keys=set(), seen_offer_keys=set(),
            current_products={}, current_skus={}, current_offers={},
            algolia_complete=True, rest_failed_skus=set(),
            final_status="completed", now=NOW,
        )

        # Partial run — should NOT increment misses
        rid2 = start_run(conn, scope="full_book", run_date="2026-07-19")
        cur_prods = load_current_products(conn)
        commit_sweep(
            conn, rid2,
            products=[], skus=[], offers=[], events=[],
            seen_product_keys=set(), seen_sku_keys=set(), seen_offer_keys=set(),
            current_products=cur_prods, current_skus={}, current_offers={},
            algolia_complete=False, rest_failed_skus=set(),
            final_status="partial", now=NOW2,
        )
        prods = load_current_products(conn)
        assert prods["SKU1"]["consecutive_misses"] == 0


# ---------------------------------------------------------------------------
# Regression guard: psycopg2 connections have no .execute() shorthand.
#
# sqlite3.Connection supports conn.execute(sql, params) as a convenience
# that implicitly creates and returns a cursor — psycopg2 connections do
# not. A previous bug called conn.execute() directly in several store.py
# functions, which passed every test here (SQLite-only) and only broke in
# production against Postgres. These doubles restrict the connection to
# the real psycopg2 connection surface (cursor/commit/rollback/close) so
# a reintroduced conn.execute() call fails loudly, not just in prod.
# ---------------------------------------------------------------------------

def _pg_like_conn():
    conn = MagicMock(spec=["cursor", "commit", "rollback", "close"])
    cur = MagicMock(spec=["execute", "fetchall", "fetchone", "close"])
    cur.fetchall.return_value = []
    conn.cursor.return_value = cur
    return conn, cur


class TestMarkRunFailed:
    def test_sets_failed_status_and_error(self, conn):
        run_id = start_run(conn, scope="full_book", run_date="2026-07-18")
        mark_run_failed(conn, run_id, "boom")
        cur = conn.execute("SELECT status, error_message, finished_at FROM scan_runs WHERE id = ?", (run_id,))
        row = dict(cur.fetchone())
        assert row["status"] == "failed"
        assert row["error_message"] == "boom"
        assert row["finished_at"] is not None


class TestPostgresConnectionCompat:
    def test_update_run_discovery_uses_cursor(self):
        conn, cur = _pg_like_conn()
        update_run_discovery(
            conn, "run1", algolia_complete=True,
            algolia_hits_expected=10, algolia_hits_collected=10,
        )
        cur.execute.assert_called_once()
        conn.commit.assert_called_once()

    def test_update_run_rest_uses_cursor(self):
        conn, cur = _pg_like_conn()
        update_run_rest(
            conn, "run1", rest_skus_expected=5, rest_skus_priced=5,
            rest_skus_failed=0, rest_failed_skus=[],
        )
        cur.execute.assert_called_once()
        conn.commit.assert_called_once()

    def test_update_run_wave_pricing_uses_cursor(self):
        conn, cur = _pg_like_conn()
        update_run_wave_pricing(
            conn, "run1",
            wave_delta_enabled=False, wave_rotation_count=10,
            wave_delta_changed_count=5, wave_shadow_only_count=3,
            wave_priced_count=10,
        )
        cur.execute.assert_called_once()
        conn.commit.assert_called_once()

    def test_load_current_products_uses_cursor(self):
        conn, cur = _pg_like_conn()
        assert load_current_products(conn) == {}
        cur.execute.assert_called_once()

    def test_load_current_skus_uses_cursor(self):
        conn, cur = _pg_like_conn()
        assert load_current_skus(conn) == {}
        cur.execute.assert_called_once()

    def test_load_current_offers_uses_cursor(self):
        conn, cur = _pg_like_conn()
        assert load_current_offers(conn) == {}
        cur.execute.assert_called_once()
