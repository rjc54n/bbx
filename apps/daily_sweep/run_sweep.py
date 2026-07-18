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

from core.db import get_connection, placeholder
from core.sweep import run_daily_sweep

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

    with get_connection() as conn:
        try:
            run_id = run_daily_sweep(
                conn,
                algolia_app_id=algolia_app_id,
                algolia_api_key=algolia_api_key,
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
