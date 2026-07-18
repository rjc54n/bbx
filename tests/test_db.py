"""Tests for core.db — schema bootstrap and connection management."""
import sqlite3

import pytest

from core.db import (
    bootstrap_schema,
    is_postgres,
    placeholder,
    placeholders,
    _adapt_array_param,
    _parse_array_column,
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


class TestBackendSelection:
    def test_defaults_to_sqlite(self):
        assert not is_postgres()

    def test_postgres_when_env_set(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/test")
        assert is_postgres()


class TestPlaceholders:
    def test_sqlite_placeholder(self):
        assert placeholder() == "?"

    def test_sqlite_placeholders(self):
        assert placeholders(3) == "?, ?, ?"


class TestBootstrap:
    def test_creates_all_tables(self, conn):
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        tables = {row[0] for row in cur.fetchall()}
        assert "scan_runs" in tables
        assert "products" in tables
        assert "skus" in tables
        assert "offers" in tables
        assert "observation_events" in tables
        assert "_migrations" in tables

    def test_idempotent(self, conn):
        bootstrap_schema(conn)
        cur = conn.execute("SELECT count(*) FROM sqlite_master WHERE type='table'")
        assert cur.fetchone()[0] >= 6

    def test_scan_runs_columns(self, conn):
        cur = conn.execute("PRAGMA table_info(scan_runs)")
        cols = {row[1] for row in cur.fetchall()}
        assert "algolia_complete" in cols
        assert "rest_failed_skus" in cols
        assert "status" in cols

    def test_observation_events_unique_constraint(self, conn):
        conn.execute(
            "INSERT INTO scan_runs (id, scope, run_date, status, started_at) "
            "VALUES ('run1', 'full_book', '2026-07-18', 'running', '2026-07-18T02:00:00Z')"
        )
        conn.execute(
            "INSERT INTO observation_events "
            "(scan_run_id, observed_at, entity_type, entity_key, event_type) "
            "VALUES ('run1', '2026-07-18T02:00:00Z', 'product', 'SKU1', 'appeared')"
        )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO observation_events "
                "(scan_run_id, observed_at, entity_type, entity_key, event_type) "
                "VALUES ('run1', '2026-07-18T02:00:00Z', 'product', 'SKU1', 'appeared')"
            )

    def test_different_field_names_allowed(self, conn):
        conn.execute(
            "INSERT INTO scan_runs (id, scope, run_date, status, started_at) "
            "VALUES ('run1', 'full_book', '2026-07-18', 'running', '2026-07-18T02:00:00Z')"
        )
        conn.execute(
            "INSERT INTO observation_events "
            "(scan_run_id, observed_at, entity_type, entity_key, event_type, field_name) "
            "VALUES ('run1', '2026-07-18T02:00:00Z', 'sku', 'SKU1|06-00750', 'price_changed', 'least_listing_price_p')"
        )
        conn.execute(
            "INSERT INTO observation_events "
            "(scan_run_id, observed_at, entity_type, entity_key, event_type, field_name) "
            "VALUES ('run1', '2026-07-18T02:00:00Z', 'sku', 'SKU1|06-00750', 'price_changed', 'market_price_p')"
        )
        cur = conn.execute("SELECT count(*) FROM observation_events")
        assert cur.fetchone()[0] == 2


class TestArrayHelpers:
    def test_adapt_sqlite(self):
        result = _adapt_array_param(["sku1", "sku2"])
        assert result == '["sku1", "sku2"]'

    def test_parse_json_string(self):
        assert _parse_array_column('["a", "b"]') == ["a", "b"]

    def test_parse_list(self):
        assert _parse_array_column(["a", "b"]) == ["a", "b"]

    def test_parse_none(self):
        assert _parse_array_column(None) == []
