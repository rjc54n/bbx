"""Publication checkpoints on the source run, shared by sweeps and recovery.

The session lock covers source writes and publication. Recovery can reuse
successful stages only when that run is still the latest source generation.
"""
from __future__ import annotations

import json
import logging
import time
from contextlib import contextmanager

from core.db import is_postgres, placeholder
from core.models import _now_utc
from core.store import (
    CATALOGUE_CACHE_MVIEWS, FACET_CACHE_MVIEWS,
    _is_ambiguous_transport_failure, publish_rest_checks,
)

log = logging.getLogger(__name__)
SWEEP_LOCK = 724031001
PUBLICATION_STAGES = (*CATALOGUE_CACHE_MVIEWS, *FACET_CACHE_MVIEWS, "rest_checks")


class PublicationError(RuntimeError):
    pass


@contextmanager
def sweep_lock(conn):
    """A session-pooler connection is required, as for concurrent refreshes."""
    if not is_postgres():
        yield
        return
    with conn.cursor() as cur:
        cur.execute("SET application_name = 'bbx-sweep'")
        cur.execute("SELECT pg_try_advisory_lock(%s) AS locked", (SWEEP_LOCK,))
        locked = cur.fetchone()["locked"]
    conn.commit()
    if not locked:
        raise PublicationError("Another sweep or publication recovery holds the database lock")
    try:
        yield
    finally:
        # A broken connection releases its session lock when the backend exits.
        if not conn.closed:
            try:
                conn.rollback()
                with conn.cursor() as cur:
                    cur.execute("SELECT pg_advisory_unlock(%s)", (SWEEP_LOCK,))
                conn.commit()
            except Exception:
                log.exception("Could not release the sweep lock; close the connection and inspect its backend")


def load_publication_run(conn, run_id):
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT * FROM scan_runs WHERE id = {placeholder()}", (run_id,))
        row = cur.fetchone()
        if row is None:
            raise PublicationError("No such sweep run")
        result = dict(row)
        stages = result["publication_stages"]
        result["publication_stages"] = json.loads(stages) if isinstance(stages, str) else stages
        return result
    finally:
        cur.close()


def save_stages(conn, run_id, stages):
    p = placeholder()
    cur = conn.cursor()
    try:
        cur.execute(f"UPDATE scan_runs SET publication_stages = {p} WHERE id = {p}",
                    (json.dumps(stages), run_id))
        conn.commit()
    finally:
        cur.close()


def next_rotation_bucket(conn, scope, buckets=15):
    cur = conn.cursor()
    try:
        cur.execute(
            f"SELECT rotation_bucket FROM scan_runs WHERE scope = {placeholder()} "
            "AND source_committed_at IS NOT NULL AND rotation_bucket IS NOT NULL "
            "ORDER BY source_committed_at DESC LIMIT 1", (scope,),
        )
        row = cur.fetchone()
        return (int(dict(row)["rotation_bucket"]) + 1) % buckets if row else 0
    finally:
        cur.close()


def assert_current_generation(conn, run):
    if not run["source_committed_at"]:
        raise PublicationError("Run has no recorded source commit; fetch a new source generation")
    cur = conn.cursor()
    try:
        cur.execute(
            f"SELECT id FROM scan_runs WHERE scope = {placeholder()} "
            "AND source_committed_at IS NOT NULL ORDER BY source_committed_at DESC LIMIT 1",
            (run["scope"],),
        )
        if str(dict(cur.fetchone())["id"]) != str(run["id"]):
            raise PublicationError("Source generation has changed; recover the latest committed run")
    finally:
        cur.close()


def inspect_publication(conn, run_id):
    """Read-only operator inspection, including server activity after ambiguity."""
    run = load_publication_run(conn, run_id)
    generation_error = None
    try:
        assert_current_generation(conn, run)
    except PublicationError as exc:
        # Inspection must remain available for a source commit whose outcome
        # is uncertain, and for an old generation that recovery will refuse.
        generation_error = str(exc)
    activity = []
    if is_postgres():
        cur = conn.cursor()
        try:
            cur.execute(
                "SELECT pid, state, wait_event_type, wait_event, query_start, "
                "left(query, 180) AS query FROM pg_stat_activity "
                "WHERE pid <> pg_backend_pid() AND state <> 'idle' "
                "AND (application_name = 'bbx-sweep' OR query ILIKE '%REFRESH MATERIALIZED VIEW%')"
            )
            activity = [dict(row) for row in cur.fetchall()]
        finally:
            cur.close()
    return {"run_id": str(run["id"]), "source_committed_at": run["source_committed_at"],
            "published_at": run["published_at"], "stages": run["publication_stages"],
            "active_operations": activity, "generation_error": generation_error}


def refresh_cache_stage(conn, name):
    if name not in (*CATALOGUE_CACHE_MVIEWS, *FACET_CACHE_MVIEWS):
        raise ValueError("Unknown publication cache")
    if not is_postgres():
        return None  # SQLite exercises orchestration; PostgreSQL tests verify caches.
    conn.commit()
    previous_autocommit = conn.autocommit
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY public.{name}")
            cur.execute(f"SELECT count(*) AS rows FROM public.{name}")
            rows = cur.fetchone()["rows"]
            if not rows:
                raise PublicationError(f"{name} is empty after refresh")
            return rows
    finally:
        conn.autocommit = previous_autocommit


def assert_recoverable(conn, run):
    """Check before collecting/resetting metrics or changing a checkpoint."""
    assert_current_generation(conn, run)
    inspection = inspect_publication(conn, run["id"])
    if inspection["active_operations"]:
        raise PublicationError("Publication is still active on the server; do not retry")
    uncertain = [name for name in PUBLICATION_STAGES
                 if run["publication_stages"].get(name, {}).get("status") in ("running", "unknown")]
    if uncertain:
        raise PublicationError(
            "Uncertain stage outcome: " + ", ".join(uncertain)
            + ". Inspect server state and resolve the outcome before resuming."
        )


def publish_run(conn, run_id, *, recovery=False):
    """Caller holds sweep_lock. Never automatically retry a production stage."""
    run = load_publication_run(conn, run_id)
    assert_current_generation(conn, run)
    if run["published_at"]:
        return  # Repeated operator invocation is a no-op.
    stages = run["publication_stages"]
    if recovery:
        assert_recoverable(conn, run)
    p = placeholder()
    for name in PUBLICATION_STAGES:
        if stages.get(name, {}).get("status") == "completed":
            continue
        stage = {"status": "running", "started_at": _now_utc()}
        stages[name] = stage
        save_stages(conn, run_id, stages)
        started = time.monotonic()
        try:
            rows = publish_rest_checks(conn) if name == "rest_checks" else refresh_cache_stage(conn, name)
        except Exception as exc:
            ambiguous = _is_ambiguous_transport_failure(exc)
            stage.update(status="unknown" if ambiguous else "failed",
                         seconds=round(time.monotonic() - started, 3), error=type(exc).__name__)
            log.error("Publication stage %s: %s", name, json.dumps(stage))
            if not ambiguous:
                conn.rollback()
                save_stages(conn, run_id, stages)
                cur = conn.cursor()
                try:
                    cur.execute(
                        f"UPDATE scan_runs SET status='failed', finished_at={p}, error_message={p} WHERE id={p}",
                        (_now_utc(), f"Publication failed at {name} ({type(exc).__name__}); recover run {run_id}", run_id),
                    )
                    conn.commit()
                finally:
                    cur.close()
            # On ambiguity, the persisted 'running' stage is deliberately not
            # rewritten through a new connection. No replay without inspection.
            raise
        stage.update(status="completed", seconds=round(time.monotonic() - started, 3), rows=rows)
        save_stages(conn, run_id, stages)
        log.info("Publication stage %s: %s", name, json.dumps(stage))
    cur = conn.cursor()
    try:
        now = _now_utc()
        cur.execute(
            f"UPDATE scan_runs SET published_at={p}, status=source_status, finished_at={p}, "
            f"error_message=NULL WHERE id={p}", (now, now, run_id),
        )
        conn.commit()
    finally:
        cur.close()
