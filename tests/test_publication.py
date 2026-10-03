"""Publication failures, recovery and bounded housekeeping on a local store."""
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from core.db import bootstrap_schema
from core import publication, sweep, sweep_metrics
from core.models import Product
from core.store import commit_sweep, prune_observation_events, start_run
from core.sweep_window import recent_run_reason
from apps.daily_sweep.check_publication import publication_age_error


@pytest.fixture
def conn(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    bootstrap_schema(conn)
    yield conn
    conn.close()


def source_run(conn, *, day="2026-10-03", quality="completed"):
    run_id = start_run(conn, scope="biddable_full_book", run_date=day)
    conn.execute("UPDATE scan_runs SET rotation_bucket=? WHERE id=?",
                 (publication.next_rotation_bucket(conn, "biddable_full_book"), run_id))
    conn.commit()
    commit_sweep(conn, run_id, products=[Product(parent_sku="P1", name="Wine")],
                 skus=[], offers=[], events=[], seen_product_keys={"P1"},
                 seen_sku_keys=set(), seen_offer_keys=set(), current_products={},
                 current_skus={}, current_offers={}, algolia_complete=True,
                 rest_unchecked_skus=set(), final_status=quality, now=day + "T12:00:00Z")
    return run_id


@pytest.mark.parametrize("failed_stage", publication.PUBLICATION_STAGES)
def test_failure_is_terminal_and_recovery_keeps_successful_stages(conn, monkeypatch, failed_stage):
    run_id = source_run(conn, quality="partial")
    calls = []

    def stage(conn, name):
        calls.append(name)
        if name == failed_stage:
            raise RuntimeError("known failure")
        return 5

    monkeypatch.setattr(publication, "refresh_cache_stage", stage)
    monkeypatch.setattr(publication, "publish_rest_checks", lambda conn: stage(conn, "rest_checks"))
    with pytest.raises(RuntimeError, match="known failure"):
        publication.publish_run(conn, run_id)
    row = publication.load_publication_run(conn, run_id)
    assert row["status"] == "failed"
    assert row["source_status"] == "partial"
    assert row["published_at"] is None
    assert row["finished_at"] is not None
    assert row["publication_stages"][failed_stage]["status"] == "failed"
    completed = list(calls[:-1])
    calls.clear()
    monkeypatch.setattr(publication, "refresh_cache_stage", lambda conn, name: calls.append(name) or 5)
    monkeypatch.setattr(publication, "publish_rest_checks", lambda conn: calls.append("rest_checks") or 5)
    publication.publish_run(conn, run_id, recovery=True)
    assert calls == list(publication.PUBLICATION_STAGES[len(completed):])
    row = publication.load_publication_run(conn, run_id)
    assert row["published_at"] is not None
    assert row["status"] == "partial"  # Useful partial discovery was published.
    assert row["error_message"] is None
    calls.clear()
    publication.publish_run(conn, run_id, recovery=True)
    assert calls == []


def test_recovery_refuses_changed_source_generation(conn, monkeypatch):
    old = source_run(conn)
    new = source_run(conn, day="2026-10-04")
    stage = MagicMock()
    monkeypatch.setattr(publication, "refresh_cache_stage", stage)
    with pytest.raises(publication.PublicationError, match="generation has changed"):
        publication.publish_run(conn, old, recovery=True)
    stage.assert_not_called()
    assert publication.load_publication_run(conn, new)["published_at"] is None


def test_ambiguous_failure_is_not_retried_or_declared_failed(conn, monkeypatch):
    run_id = source_run(conn)
    stage = MagicMock(side_effect=ConnectionError("lost reply"))
    monkeypatch.setattr(publication, "refresh_cache_stage", stage)
    with pytest.raises(ConnectionError):
        publication.publish_run(conn, run_id)
    assert stage.call_count == 1
    row = publication.load_publication_run(conn, run_id)
    assert row["publication_stages"]["catalogue_mv"]["status"] == "running"
    assert row["published_at"] is None
    with pytest.raises(publication.PublicationError, match="Uncertain stage outcome"):
        publication.publish_run(conn, run_id, recovery=True)
    assert stage.call_count == 1


def test_empty_postgres_cache_is_failure(monkeypatch):
    monkeypatch.setattr(publication, "is_postgres", lambda: True)
    conn = MagicMock()
    conn.autocommit = False
    conn.cursor.return_value.__enter__.return_value.fetchone.return_value = {"rows": 0}
    with pytest.raises(publication.PublicationError, match="empty"):
        publication.refresh_cache_stage(conn, "wine_scenario_mv")
    assert conn.autocommit is False


def test_no_source_cannot_be_published(conn):
    run_id = start_run(conn, scope="biddable_full_book", run_date="2026-10-03")
    with pytest.raises(publication.PublicationError, match="no recorded source"):
        publication.publish_run(conn, run_id, recovery=True)


def test_rotation_visits_all_buckets_with_alternate_days_and_missed_nights(conn):
    first = datetime(2026, 1, 1)
    buckets = []
    for i in range(30):
        day = (first + timedelta(days=2 * i + (3 if i >= 5 else 0))).date().isoformat()
        bucket = publication.next_rotation_bucket(conn, "biddable_full_book")
        # A failed attempt does not consume its bucket.
        failed = start_run(conn, scope="biddable_full_book", run_date=day)
        conn.execute("UPDATE scan_runs SET status='failed', rotation_bucket=? WHERE id=?", (bucket, failed))
        conn.commit()
        assert publication.next_rotation_bucket(conn, "biddable_full_book") == bucket
        source_run(conn, day=day)
        buckets.append(bucket)
    assert buckets == list(range(15)) * 2


def test_publication_failure_does_not_take_two_day_cadence(conn):
    now = datetime(2026, 10, 3, 21, tzinfo=timezone.utc)
    started = now - timedelta(hours=24)
    assert recent_run_reason([("failed", started, None)], now) is None
    assert recent_run_reason([("partial", started, None)], now) is None
    assert recent_run_reason([("partial", started, started + timedelta(minutes=20))], now)
    assert recent_run_reason([("failed", now - timedelta(hours=1), None)], now)


def add_events(conn, run_id, ages):
    for i, age in enumerate(ages):
        conn.execute("INSERT INTO observation_events (scan_run_id, observed_at, entity_type, entity_key, event_type) VALUES (?, ?, 'product', ?, 'appeared')",
                     (run_id, age, str(i)))
    conn.commit()


def test_retention_stops_at_row_budget_and_reports_backlog(conn):
    run_id = source_run(conn)
    add_events(conn, run_id, ["2026-08-01"] * 7 + ["2026-10-01"] * 2)
    result = prune_observation_events(conn, "2026-09-01", batch_rows=2, max_rows=4)
    assert result["deleted"] == 4
    assert result["batches"] == 2
    assert result["remaining"] == 3 and result["remaining_exact"]
    assert result["budget_exhausted"]
    result = prune_observation_events(conn, "2026-09-01", batch_rows=2, max_rows=4)
    assert result["deleted"] == 3
    assert result["remaining"] == 0
    assert conn.execute("SELECT count(*) FROM observation_events").fetchone()[0] == 2


def test_retention_time_budget_reports_unknown_backlog_without_more_work(conn):
    run_id = source_run(conn)
    add_events(conn, run_id, ["2026-08-01"] * 5)
    ticks = iter([0, 0, 2, 2, 2])
    result = prune_observation_events(conn, "2026-09-01", max_seconds=1, clock=lambda: next(ticks))
    assert result["deleted"] == 0
    assert result["remaining"] is None
    assert result["budget_exhausted"]
    assert conn.execute("SELECT count(*) FROM observation_events").fetchone()[0] == 5


def test_skipped_window_does_not_make_stale_publication_healthy():
    now = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)
    assert publication_age_error(now - timedelta(hours=61), now)
    assert publication_age_error(None, now)
    assert publication_age_error(now - timedelta(hours=60), now) is None


def test_counter_reset_does_not_report_misleading_negative_delta():
    before = {"wal_bytes": 200, "wal_stats_reset": "old"}
    after = {"wal_bytes": 10, "wal_stats_reset": "new"}
    assert sweep_metrics.counter_deltas(before, after)["wal_bytes"] is None


def test_metrics_are_saved_before_reset_on_failure(conn, monkeypatch, caplog):
    calls = []
    monkeypatch.setattr(sweep_metrics, "reset_query_statistics", lambda conn: calls.append("reset"))
    monkeypatch.setattr(sweep_metrics.log, "info", lambda *args: calls.append("log"))
    sweep_metrics.finish_metrics(conn, {}, {"outcome": "failed"})
    assert calls.index("log") < calls.index("reset")


def test_ambiguous_failure_does_not_reset_statistics(conn, monkeypatch):
    reset = MagicMock()
    monkeypatch.setattr(sweep_metrics, "reset_query_statistics", reset)
    sweep_metrics.finish_metrics(conn, {}, {"outcome": "unknown"}, connection_uncertain=True)
    reset.assert_not_called()


def test_inspection_remains_available_when_source_commit_is_unknown(conn):
    run_id = start_run(conn, scope="biddable_full_book", run_date="2026-10-03")
    inspection = publication.inspect_publication(conn, run_id)
    assert inspection["source_committed_at"] is None
    assert "no recorded source commit" in inspection["generation_error"]
    assert inspection["active_operations"] == []
