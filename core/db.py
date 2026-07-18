"""
Database connection factory and schema bootstrap for the Phase 1B scan store.

Backend selection:
  - DATABASE_URL set → Postgres via psycopg2 (Supabase session pooler)
  - DATABASE_URL unset → SQLite file at data/scan_store.sqlite
"""
from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, List, Tuple

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    psycopg2 = None

SQLITE_PATH = Path(__file__).parent.parent / "data" / "scan_store.sqlite"
MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


def is_postgres() -> bool:
    return bool(os.environ.get("DATABASE_URL"))


@contextmanager
def get_connection():
    if is_postgres():
        if psycopg2 is None:
            raise ImportError("psycopg2 required for Postgres; pip install psycopg2-binary")
        conn = psycopg2.connect(
            os.environ["DATABASE_URL"],
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        try:
            yield conn
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()
    else:
        SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(SQLITE_PATH))
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()


def placeholder() -> str:
    return "%s" if is_postgres() else "?"


def placeholders(n: int) -> str:
    p = placeholder()
    return ", ".join([p] * n)


def _adapt_array_param(values: List[str]) -> Any:
    if is_postgres():
        return values
    return json.dumps(values)


def _parse_array_column(raw) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    return json.loads(raw)


# ---------------------------------------------------------------------------
# Schema bootstrap
# ---------------------------------------------------------------------------

_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS _migrations (
    name        TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_runs (
    id                      TEXT PRIMARY KEY,
    scope                   TEXT NOT NULL,
    run_date                TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'running',
    started_at              TEXT NOT NULL,
    finished_at             TEXT,
    error_message           TEXT,
    algolia_complete        INTEGER,
    algolia_hits_expected   INTEGER,
    algolia_hits_collected  INTEGER,
    rest_skus_expected      INTEGER,
    rest_skus_priced        INTEGER,
    rest_skus_failed        INTEGER,
    rest_failed_skus        TEXT
);

CREATE TABLE IF NOT EXISTS products (
    parent_sku              TEXT PRIMARY KEY,
    name                    TEXT,
    vintage                 INTEGER,
    region                  TEXT,
    subregion               TEXT,
    colour                  TEXT,
    country                 TEXT,
    producer                TEXT,
    grape_varieties         TEXT,
    product_url             TEXT,
    first_seen_run_id       TEXT REFERENCES scan_runs(id),
    first_seen_at           TEXT NOT NULL,
    last_seen_run_id        TEXT REFERENCES scan_runs(id),
    last_seen_at            TEXT NOT NULL,
    consecutive_misses      INTEGER NOT NULL DEFAULT 0,
    gone_since              TEXT
);

CREATE TABLE IF NOT EXISTS skus (
    parent_sku              TEXT NOT NULL REFERENCES products(parent_sku),
    format_code             TEXT NOT NULL,
    case_size               INTEGER,
    bottle_volume_ml        INTEGER,
    least_listing_price_p   INTEGER,
    market_price_p          INTEGER,
    last_transaction_p      INTEGER,
    highest_bid_p           INTEGER,
    qty_available           INTEGER,
    source_agreement        TEXT DEFAULT 'unchecked',
    first_seen_run_id       TEXT REFERENCES scan_runs(id),
    first_seen_at           TEXT NOT NULL,
    last_seen_run_id        TEXT REFERENCES scan_runs(id),
    last_seen_at            TEXT NOT NULL,
    consecutive_misses      INTEGER NOT NULL DEFAULT 0,
    gone_since              TEXT,
    PRIMARY KEY (parent_sku, format_code)
);

CREATE TABLE IF NOT EXISTS offers (
    bbx_listing_id          TEXT PRIMARY KEY,
    parent_sku              TEXT NOT NULL REFERENCES products(parent_sku),
    format_code             TEXT,
    match_confidence        TEXT DEFAULT 'inferred',
    case_size               INTEGER,
    bottle_volume_ml        INTEGER,
    price_per_case_p        INTEGER NOT NULL,
    first_seen_run_id       TEXT REFERENCES scan_runs(id),
    first_seen_at           TEXT NOT NULL,
    last_seen_run_id        TEXT REFERENCES scan_runs(id),
    last_seen_at            TEXT NOT NULL,
    consecutive_misses      INTEGER NOT NULL DEFAULT 0,
    gone_since              TEXT
);

CREATE TABLE IF NOT EXISTS observation_events (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_run_id             TEXT NOT NULL REFERENCES scan_runs(id),
    observed_at             TEXT NOT NULL,
    entity_type             TEXT NOT NULL,
    entity_key              TEXT NOT NULL,
    event_type              TEXT NOT NULL,
    field_name              TEXT NOT NULL DEFAULT '',
    old_value_raw           TEXT,
    new_value_raw           TEXT,
    metadata                TEXT,
    UNIQUE (scan_run_id, entity_type, entity_key, event_type, field_name)
);

CREATE INDEX IF NOT EXISTS idx_obs_entity
    ON observation_events(entity_type, entity_key, observed_at);
CREATE INDEX IF NOT EXISTS idx_obs_run
    ON observation_events(scan_run_id);
"""


def bootstrap_schema(conn) -> None:
    if is_postgres():
        _bootstrap_postgres(conn)
    else:
        _bootstrap_sqlite(conn)


def _bootstrap_sqlite(conn) -> None:
    conn.executescript(_SQLITE_SCHEMA)
    conn.commit()


def _bootstrap_postgres(conn) -> None:
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS _migrations (
            name        TEXT PRIMARY KEY,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    conn.commit()

    cur.execute("SELECT name FROM _migrations ORDER BY name")
    applied = {row["name"] for row in cur.fetchall()}

    for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if sql_file.name in applied:
            continue
        ddl = sql_file.read_text()
        cur.execute(ddl)
        cur.execute(
            "INSERT INTO _migrations (name) VALUES (%s)", (sql_file.name,)
        )
        conn.commit()

    cur.close()
