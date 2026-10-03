"""Inspect or resume publication without fetching or rewriting source data."""
import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from core.db import get_connection, is_postgres
from core.publication import assert_recoverable, inspect_publication, load_publication_run, publish_run, sweep_lock
from core.store import _is_ambiguous_transport_failure
from core.sweep_metrics import finish_metrics, snapshot
from core.sweep_window import has_backup_headroom


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    parser.add_argument("--resume", action="store_true", help="Resume known failed or unstarted publication stages")
    args = parser.parse_args()
    if not is_postgres():
        parser.error("Set DATABASE_URL to the session-pooler connection for the intended database")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if 2 <= datetime.now(timezone.utc).hour < 5:
        parser.error("Publication inspection and recovery are unavailable during 02:00-05:00 UTC")
    if args.resume and not has_backup_headroom(datetime.now(timezone.utc)):
        parser.error("Publication recovery needs 90 minutes of headroom before 02:00 UTC")
    with get_connection() as conn:
        # Inspection is always performed before recovery, including server-side
        # activity. Unknown/running stage outcomes deliberately fail closed.
        print(json.dumps(inspect_publication(conn, args.run_id), default=str, indent=2))
        if not args.resume:
            return
        with sweep_lock(conn):
            run = load_publication_run(conn, args.run_id)
            assert_recoverable(conn, run)
            if run["published_at"]:
                return
            before = snapshot(conn)
            summary = {"run_id": args.run_id, "operation": "publication_recovery"}
            uncertain = False
            try:
                publish_run(conn, args.run_id, recovery=True)
                summary["outcome"] = "published"
            except Exception as exc:
                uncertain = _is_ambiguous_transport_failure(exc)
                summary["outcome"] = "unknown" if uncertain else "failed"
                raise
            finally:
                if not uncertain:
                    run = load_publication_run(conn, args.run_id)
                    summary.update(stages=run["publication_stages"], published_at=run["published_at"],
                                   source_committed_at=run["source_committed_at"])
                finish_metrics(conn, before, summary, connection_uncertain=uncertain)


if __name__ == "__main__":
    main()
