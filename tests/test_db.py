"""Tests for core.db — schema bootstrap and connection management."""
import sqlite3

import pytest

import core.db
from core.db import (
    bootstrap_schema,
    is_postgres,
    placeholder,
    placeholders,
    _adapt_array_param,
    _configure_postgres_search_path,
    _connect_postgres,
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


class FakePostgresCursor:
    def __init__(self, private_scan_store, private_migration_ledger):
        self.private_scan_store = private_scan_store
        self.private_migration_ledger = private_migration_ledger
        self.executed = []
        self.closed = False

    def execute(self, sql):
        self.executed.append(sql)

    def fetchone(self):
        return {
            "private_scan_store": self.private_scan_store,
            "private_migration_ledger": self.private_migration_ledger,
        }

    def close(self):
        self.closed = True


class FakePostgresConnection:
    def __init__(self, private_scan_store, private_migration_ledger):
        self.cursor_instance = FakePostgresCursor(
            private_scan_store, private_migration_ledger
        )

    def cursor(self):
        return self.cursor_instance


class TestPostgresSearchPath:
    def test_legacy_public_store_keeps_existing_search_path(self):
        conn = FakePostgresConnection(False, False)

        _configure_postgres_search_path(conn)

        assert len(conn.cursor_instance.executed) == 1
        assert conn.cursor_instance.closed

    def test_private_store_sets_private_first(self):
        conn = FakePostgresConnection(True, True)

        _configure_postgres_search_path(conn)

        assert conn.cursor_instance.executed[-1] == (
            "SET search_path TO private, public, extensions"
        )
        assert conn.cursor_instance.closed

    @pytest.mark.parametrize("scan_store,ledger", [(True, False), (False, True)])
    def test_inconsistent_private_store_fails_closed(self, scan_store, ledger):
        conn = FakePostgresConnection(scan_store, ledger)

        with pytest.raises(RuntimeError, match="schema is inconsistent"):
            _configure_postgres_search_path(conn)

        assert conn.cursor_instance.closed


try:
    import psycopg2 as _psycopg2
except ImportError:
    _psycopg2 = None


@pytest.mark.skipif(_psycopg2 is None, reason="psycopg2 not installed")
class TestConnectRetry:
    """Cold-start (paused Supabase project) should be retried, not fatal."""

    def _patch(self, monkeypatch, side_effects):
        calls = {"connect": 0, "sleeps": []}

        def fake_connect(*args, **kwargs):
            outcome = side_effects[calls["connect"]]
            calls["connect"] += 1
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/test")
        monkeypatch.setattr(_psycopg2, "connect", fake_connect)
        monkeypatch.setattr(core.db.time, "sleep", lambda d: calls["sleeps"].append(d))
        return calls

    def test_retries_then_succeeds(self, monkeypatch):
        psycopg2 = _psycopg2
        sentinel = object()
        calls = self._patch(
            monkeypatch,
            [
                psycopg2.OperationalError("EAUTHQUERY: connection to database not available"),
                psycopg2.OperationalError("EAUTHQUERY: connection to database not available"),
                sentinel,
            ],
        )

        assert _connect_postgres() is sentinel
        assert calls["connect"] == 3
        assert calls["sleeps"] == [5, 15]

    def test_exhausts_attempts_and_raises_last_error(self, monkeypatch):
        psycopg2 = _psycopg2
        calls = self._patch(
            monkeypatch,
            [psycopg2.OperationalError(f"attempt {i}") for i in range(core.db._CONNECT_ATTEMPTS)],
        )

        with pytest.raises(psycopg2.OperationalError, match="attempt 4"):
            _connect_postgres()
        assert calls["connect"] == core.db._CONNECT_ATTEMPTS

    def test_does_not_retry_programming_errors(self, monkeypatch):
        psycopg2 = _psycopg2
        calls = self._patch(monkeypatch, [psycopg2.ProgrammingError("bad password")])

        with pytest.raises(psycopg2.ProgrammingError):
            _connect_postgres()
        assert calls["connect"] == 1
        assert calls["sleeps"] == []


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

    def test_existing_sqlite_store_gains_rest_freshness_without_data_loss(
        self, conn
    ):
        conn.execute(
            "INSERT INTO scan_runs "
            "(id, scope, run_date, status, started_at) "
            "VALUES ('run1', 'full_book', '2026-07-18', 'running', "
            "'2026-07-18T02:00:00Z')"
        )
        conn.execute(
            "INSERT INTO products "
            "(parent_sku, name, first_seen_run_id, first_seen_at, "
            "last_seen_run_id, last_seen_at) "
            "VALUES ('SKU1', 'Preserved wine', 'run1', "
            "'2026-07-18T02:00:00Z', 'run1', '2026-07-18T02:00:00Z')"
        )
        conn.commit()
        conn.execute("ALTER TABLE products DROP COLUMN last_rest_checked_at")
        conn.commit()

        bootstrap_schema(conn)

        columns = {
            row[1] for row in conn.execute("PRAGMA table_info(products)")
        }
        assert "last_rest_checked_at" in columns
        row = conn.execute(
            "SELECT name, last_rest_checked_at "
            "FROM products WHERE parent_sku='SKU1'"
        ).fetchone()
        assert tuple(row) == ("Preserved wine", None)

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
