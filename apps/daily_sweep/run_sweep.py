"""
Entry point for the daily full-book sweep.

Reads configuration from environment variables, opens a DB connection,
runs the sweep, and handles fatal errors (marking the run as failed).
"""
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import logging
import os
from datetime import datetime, timezone

from core.db import get_connection, placeholder
from core.store import load_recent_runs
from core.sweep import BIDDABLE_FULL_BOOK_SCOPE, run_daily_sweep
from core.sweep_window import in_sweep_window, recent_run_reason

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger(__name__)


def main():
    algolia_app_id = os.environ.get("ALGOLIA_APP_ID")
    algolia_api_key = os.environ.get("ALGOLIA_API_KEY")

    if not algolia_app_id or not algolia_api_key:
        log.error("ALGOLIA_APP_ID and ALGOLIA_API_KEY must be set")
        sys.exit(1)

    # UNVERIFIED (see docs/PHASE3-4-IMPLEMENTATION.md Step 6): defaults to
    # False so index_last_update-driven delta selection is computed and
    # logged (shadow mode) but doesn't yet affect which unlisted parent_skus
    # get REST-priced. Flip only once index_last_update has been compared
    # against real observed price changes on the listed book for at least a
    # week.
    delta_enabled = os.environ.get("WAVE_PRICING_DELTA_ENABLED", "").strip().lower() == "true"

    # Scheduled triggers fire hourly; only one per two days may sweep. Manual
    # (workflow_dispatch) runs bypass this. See core/sweep_window.py.
    scheduled = os.environ.get("SWEEP_SCHEDULED") == "1"

    with get_connection() as conn:
        if scheduled:
            now = datetime.now(timezone.utc)
            if not in_sweep_window(now):
                log.info("Outside the sweep window; skipping this scheduled trigger.")
                return
            reason = recent_run_reason(
                load_recent_runs(conn, scope=BIDDABLE_FULL_BOOK_SCOPE), now,
            )
            if reason:
                log.info("Skipping this scheduled trigger: %s.", reason)
                return
        try:
            run_id = run_daily_sweep(
                conn,
                algolia_app_id=algolia_app_id,
                algolia_api_key=algolia_api_key,
                delta_enabled=delta_enabled,
            )
            if run_id is None:
                log.info("No work to do — completed run already exists for today.")
            else:
                log.info("Sweep finished: run_id=%s", run_id)
        except Exception:
            log.exception("Sweep failed with an unhandled error")
            sys.exit(1)


if __name__ == "__main__":
    main()
