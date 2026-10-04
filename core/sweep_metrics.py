"""Compact job evidence before clearing expensive query statistics."""
import json
import logging
import os
from pathlib import Path

from core.db import is_postgres
from core.models import _now_utc
from core.store import reset_query_statistics

log = logging.getLogger(__name__)


def snapshot(conn):
    if not is_postgres():
        return {}
    cur = conn.cursor()
    try:
        cur.execute("SET LOCAL statement_timeout = '5s'")
        cur.execute("""
            SELECT now() AS observed_at, pg_postmaster_start_time() AS server_started_at,
                   pg_database_size(current_database()) AS database_bytes,
                   d.temp_bytes, d.stats_reset AS database_stats_reset,
                   w.wal_bytes, w.stats_reset AS wal_stats_reset,
                   (SELECT jsonb_object_agg(relname, pg_total_relation_size(relid))
                    FROM pg_stat_user_tables WHERE
                    (schemaname = 'private' AND relname IN
                      ('products', 'skus', 'offers', 'observation_events', 'product_rest_checks')) OR
                    (schemaname = 'public' AND relname IN
                      ('catalogue_mv', 'wine_market_summary_mv', 'wine_scenario_mv',
                       'facet_values_mv', 'facet_ranges_mv', 'format_options_mv'))) AS relation_bytes
            FROM pg_stat_database d CROSS JOIN pg_stat_wal w
            WHERE d.datname = current_database()
        """)
        result = dict(cur.fetchone())
        conn.commit()
        return result
    except Exception:
        conn.rollback()
        log.exception("Could not capture sweep metrics")
        return {}
    finally:
        cur.close()


def counter_deltas(before, after):
    deltas = {}
    for metric, reset in (("wal_bytes", "wal_stats_reset"), ("temp_bytes", "database_stats_reset")):
        if metric not in before or metric not in after:
            continue
        if before.get(reset) != after.get(reset) or before.get("server_started_at") != after.get("server_started_at"):
            deltas[metric] = None
        else:
            value = int(after[metric]) - int(before[metric])
            deltas[metric] = value if value >= 0 else None
    deltas["relation_bytes"] = {
        name: size - before["relation_bytes"][name]
        for name, size in (after.get("relation_bytes") or {}).items()
        if name in (before.get("relation_bytes") or {})
    }
    return deltas


def finish_metrics(conn, before, summary, *, connection_uncertain=False):
    if connection_uncertain:
        summary["metrics_error"] = "Connection outcome uncertain; inspect server state before more database work"
    else:
        after = snapshot(conn)
        summary.update(before=before, after=after, deltas=counter_deltas(before, after),
                       counter_scope="WAL is cluster-wide; temporary bytes are database-wide, including concurrent work")
        if is_postgres():
            cur = conn.cursor()
            try:
                cur.execute("SET LOCAL statement_timeout = '5s'")
                # Do not select query text: large batched statements caused the
                # exporter problem that the reset works around.
                cur.execute("""
                    SELECT queryid, calls, total_exec_time, rows,
                           temp_blks_read, temp_blks_written, wal_bytes
                    FROM extensions.pg_stat_statements
                    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
                    ORDER BY total_exec_time DESC LIMIT 8
                """)
                summary["query_statistics"] = [dict(row) for row in cur.fetchall()]
                conn.commit()
            except Exception:
                conn.rollback()
                log.exception("Could not capture query statistics summary")
            finally:
                cur.close()
    # Emit evidence before resetting, even when the source or publication failed.
    log.info("Sweep evidence before statistics reset: %s", json.dumps(summary, default=str))
    if not connection_uncertain:
        try:
            reset_query_statistics(conn)
            summary["query_statistics_reset_at"] = _now_utc() if is_postgres() else None
        except Exception:
            summary["query_statistics_reset_error"] = True
            log.exception("Query statistics reset failed")
    log.info("Sweep evidence: %s", json.dumps(summary, default=str))
    path = os.environ.get("SWEEP_SUMMARY_PATH")
    if path:
        try:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            Path(path).write_text(json.dumps(summary, default=str, indent=2) + "\n")
        except OSError:
            log.exception("Could not save sweep evidence artifact")
