"""Real PostgreSQL publication and row counters; explicit local target only.

BBX_PUBLICATION_TEST_DB_URL must point at an isolated local database with the
repository migrations applied. No default connection and no production opt-in.
"""
import os
from urllib.parse import urlsplit
from uuid import uuid4

import pytest

from core import publication
from core.db import _configure_postgres_search_path
from core.models import Product, Sku
from core.store import commit_sweep, start_run

psycopg2 = pytest.importorskip("psycopg2")
from psycopg2.extras import RealDictCursor


@pytest.fixture
def pg(monkeypatch):
    url = os.environ.get("BBX_PUBLICATION_TEST_DB_URL")
    if not url:
        pytest.skip("set BBX_PUBLICATION_TEST_DB_URL to an isolated local test database")
    target = urlsplit(url)
    isolated_name = target.path.startswith("/bbx_") or (os.environ.get("CI") == "true" and target.path == "/postgres")
    if target.hostname not in {"127.0.0.1", "localhost", "::1"} or not isolated_name:
        pytest.fail("publication integration tests require an isolated local bbx_* database")
    monkeypatch.setenv("DATABASE_URL", url)
    conn = psycopg2.connect(url, cursor_factory=RealDictCursor, connect_timeout=5)
    _configure_postgres_search_path(conn)
    with conn.cursor() as cur:
        cur.execute("SET statement_timeout = '15s'")
    conn.commit()
    ids = []
    parents = []
    yield conn, ids, parents, url
    conn.rollback()
    with conn.cursor() as cur:
        for parent in parents:
            cur.execute("DELETE FROM private.product_rest_checks WHERE parent_sku=%s", (parent,))
            cur.execute("DELETE FROM private.skus WHERE parent_sku=%s", (parent,))
            cur.execute("DELETE FROM private.products WHERE parent_sku=%s", (parent,))
        for run_id in ids:
            cur.execute("DELETE FROM private.observation_events WHERE scan_run_id=%s", (run_id,))
            cur.execute("DELETE FROM private.scan_runs WHERE id=%s", (run_id,))
    conn.commit()
    conn.close()


def commit_fixture(pg, parent=None, price=10000):
    conn, ids, parents, _ = pg
    if parent is None:
        parent = "publication-test-" + uuid4().hex
        parents.append(parent)
    run_id = start_run(conn, scope="publication_integration", run_date="2026-10-03")
    ids.append(run_id)
    result = commit_sweep(
        conn, run_id, products=[Product(parent_sku=parent, name="Publication test", region="Bordeaux", colour="Red", country="France")],
        skus=[Sku(parent_sku=parent, format_code="06-00750", case_size=6, bottle_volume_ml=750,
                  least_listing_price_p=price, market_price_p=15000)],
        offers=[], events=[], seen_product_keys={parent}, seen_sku_keys={parent + "|06-00750"},
        seen_offer_keys=set(), current_products={}, current_skus={}, current_offers={},
        algolia_complete=True, rest_unchecked_skus=set(), final_status="partial",
        now="2026-10-03T12:00:00Z", rest_checked_parent_skus={parent},
    )
    return run_id, parent, result


def test_postgres_counts_actual_changes_not_submitted_rows(pg):
    first, parent, result = commit_fixture(pg)
    assert result["changed_rows"]["products"]["inserted"] == 1
    assert result["changed_rows"]["skus"]["inserted"] == 1
    _, _, result = commit_fixture(pg, parent)
    assert result["changed_rows"]["products"]["updated"] == 0
    assert result["changed_rows"]["skus"]["updated"] == 0
    _, _, result = commit_fixture(pg, parent, price=12000)
    assert result["changed_rows"]["skus"]["updated"] == 1


def test_postgres_publication_resumes_only_failed_stage(pg, monkeypatch):
    conn = pg[0]
    run_id, parent, _ = commit_fixture(pg)
    original = publication.refresh_cache_stage
    calls = []

    def fail_summary(conn, name):
        calls.append(name)
        if name == "wine_market_summary_mv":
            with conn.cursor() as cur:
                cur.execute("SELECT 1/0")
        return original(conn, name)

    monkeypatch.setattr(publication, "refresh_cache_stage", fail_summary)
    with publication.sweep_lock(conn):
        with pytest.raises(psycopg2.errors.DivisionByZero):
            publication.publish_run(conn, run_id)
    row = publication.load_publication_run(conn, run_id)
    assert row["status"] == "failed"
    assert row["publication_stages"]["catalogue_mv"]["rows"] > 0
    with conn.cursor() as cur:
        cur.execute("SELECT published_at FROM product_rest_checks WHERE parent_sku=%s", (parent,))
        assert cur.fetchone()["published_at"] is None
    calls.clear()
    monkeypatch.setattr(publication, "refresh_cache_stage", lambda conn, name: calls.append(name) or original(conn, name))
    with publication.sweep_lock(conn):
        publication.publish_run(conn, run_id, recovery=True)
    assert "catalogue_mv" not in calls
    assert publication.load_publication_run(conn, run_id)["published_at"] is not None


def test_postgres_session_lock_excludes_another_operator(pg):
    conn, _, _, url = pg
    other = psycopg2.connect(url, cursor_factory=RealDictCursor)
    try:
        with publication.sweep_lock(conn):
            with pytest.raises(publication.PublicationError, match="database lock"):
                with publication.sweep_lock(other):
                    pytest.fail("overlapping publisher acquired lock")
        with publication.sweep_lock(other):
            pass
    finally:
        other.close()


def test_postgres_empty_cache_is_not_published(pg):
    conn, ids, _, _ = pg
    run_id = start_run(conn, scope="publication_integration", run_date="2026-10-03")
    ids.append(run_id)
    commit_sweep(conn, run_id, products=[], skus=[], offers=[], events=[],
                 seen_product_keys=set(), seen_sku_keys=set(), seen_offer_keys=set(),
                 current_products={}, current_skus={}, current_offers={},
                 algolia_complete=True, rest_unchecked_skus=set(),
                 final_status="completed", now="2026-10-03T12:00:00Z")
    with publication.sweep_lock(conn):
        with pytest.raises(publication.PublicationError, match="empty"):
            publication.publish_run(conn, run_id)
    row = publication.load_publication_run(conn, run_id)
    assert row["status"] == "failed"
    assert row["published_at"] is None


def test_postgres_retention_budget_and_metrics(pg):
    from core.store import prune_observation_events
    from core.sweep_metrics import snapshot
    conn = pg[0]
    run_id, _, _ = commit_fixture(pg)
    with conn.cursor() as cur:
        cur.execute("""INSERT INTO observation_events
            (scan_run_id, observed_at, entity_type, entity_key, event_type)
            SELECT %s, '2026-01-01'::timestamptz, 'product', n::text, 'appeared'
            FROM generate_series(1, 9) n""", (run_id,))
    conn.commit()
    result = prune_observation_events(conn, "2026-02-01", batch_rows=2, max_rows=5)
    assert result["deleted"] == 5 and result["batches"] == 3
    assert result["remaining"] == 4 and result["remaining_exact"]
    metrics = snapshot(conn)
    assert metrics["database_bytes"] > 0
    assert "wal_bytes" in metrics and "temp_bytes" in metrics
    assert metrics["relation_bytes"]["catalogue_mv"] > 0
