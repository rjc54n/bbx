# apps/arbitrage_bot/run_arbitrage.py
# --------------------------------------------------------------
# Automated BBX arbitrage scanner (thin wrapper over core.pipeline).
#
# Pipeline:
#   1) core.pipeline.run_scan  (Algolia -> REST -> GraphQL -> thresholds)
#   2) Deduplicate against prior notifications
#   3) Slack notify with compact summary
# --------------------------------------------------------------

import sys
from pathlib import Path

# Ensure the project root is on sys.path so "core" is importable
# when calling: python3 apps/arbitrage_bot/run_arbitrage.py
ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import os
import logging

from core.pipeline import ScanConfig, run_scan
from core.slack import send_slack_message
from core.notification_state import (
    load_notification_state,
    save_notification_state,
    filter_new_or_improved,
)

# --------------------------------------------------------------
# PARAMETERS
# --------------------------------------------------------------

# Lookback window for Algolia "new_to_bbx" facet.
# Maps to "1 Day", "2 Days", "3 Days", "7 Days".
LOOKBACK_DAYS = 1

CONFIG = ScanConfig(
    days_label=f"{LOOKBACK_DAYS} Day" if LOOKBACK_DAYS == 1 else f"{LOOKBACK_DAYS} Days",
    colour_choice="Any",
    price_bands=None,
    bottle_format=None,
    min_pct_market=15.0,
    min_pct_last=15.0,
    min_pct_next=15.0,
    min_case_price=1.0,
)

# Slack formatting limits
MAX_WINES_PER_ALERT = 20

# When True: print Slack messages locally but do not send
DRY_RUN = False

# Path for persistent notification state (used locally; CI uses S3)
STATE_FILE = ROOT_DIR / "data" / "arbitrage_state.json"

# GraphQL payload template
PAYLOAD_FILE = ROOT_DIR / "data" / "payload.json"

# Re-notification interval when ask is unchanged (in days)
REMINDER_INTERVAL_DAYS = 7

# Control whether we send "no new or improved opportunities" messages.
SEND_EMPTY_ALERTS = False


def get_algolia_credentials():
    """
    Read Algolia credentials from environment variables (local CLI or
    GitHub Actions). Requires ALGOLIA_APP_ID and ALGOLIA_API_KEY.
    """
    app_id = os.environ.get("ALGOLIA_APP_ID")
    api_key = os.environ.get("ALGOLIA_API_KEY")

    if not app_id or not api_key:
        raise RuntimeError(
            "Algolia credentials not found in environment. "
            "Set ALGOLIA_APP_ID and ALGOLIA_API_KEY before running."
        )
    return app_id, api_key


# --------------------------------------------------------------
# Slack message builder
# --------------------------------------------------------------

def format_slack_message(candidates, suppressed=None):
    """
    Build a compact Slack message summarising candidates.

    Parameters
    ----------
    candidates : list[dict]
        Candidates that will be notified this run.
    suppressed : list[dict] or None
        Candidates that were suppressed due to deduplication rules.
    """
    suppressed = suppressed or []
    suppressed_count = len(suppressed)

    if not candidates:
        base = "BBX arbitrage scan: no new or improved opportunities found."
        if suppressed_count:
            return (
                f"{base}\n"
                f"(Suppressed {suppressed_count} previously-notified opportunities this run.)"
            )
        return base

    header = (
        f"BBX arbitrage scan - {len(candidates)} candidates "
        f"(mkt>={CONFIG.min_pct_market}%, last>={CONFIG.min_pct_last}%, "
        f"next>={CONFIG.min_pct_next}%)"
    )

    lines = [header]
    for i, c in enumerate(candidates[:MAX_WINES_PER_ALERT], start=1):
        case_fmt = c.get("case_format", "N/A")
        line = (
            f"{i}. {c['name']} ({c['vintage']}, {c['region']}, {case_fmt}) - "
            f"£{c['ask']} ask | £{c['mkt']} mkt ({c['pct_market']}%) | "
            f"last {c['pct_last']}% | next {c['pct_next']}% - {c['url']}"
        )
        lines.append(line)

    if len(candidates) > MAX_WINES_PER_ALERT:
        lines.append(f"... and {len(candidates) - MAX_WINES_PER_ALERT} more.")

    if suppressed_count:
        lines.append(
            f"(Suppressed {suppressed_count} previously-notified opportunities this run.)"
        )

    return "\n".join(lines)


# --------------------------------------------------------------
# Entry point
# --------------------------------------------------------------

def main():
    logging.basicConfig(level=logging.INFO)
    logging.info("Starting BBX arbitrage scan...")

    app_id, api_key = get_algolia_credentials()

    # 1) Load prior notification state
    state = load_notification_state(STATE_FILE)

    # 2) Run the shared scan pipeline
    outcome = run_scan(app_id, api_key, CONFIG, payload_path=PAYLOAD_FILE)

    # 3) Apply deduplication rules
    notified, suppressed, new_state = filter_new_or_improved(
        outcome.candidates,
        state,
        reminder_days=REMINDER_INTERVAL_DAYS,
    )

    # 4) Build Slack message
    msg = format_slack_message(notified, suppressed)

    # 5) Send or print, depending on DRY_RUN and SEND_EMPTY_ALERTS
    if DRY_RUN:
        print(msg)
    elif notified or SEND_EMPTY_ALERTS:
        send_slack_message(msg)

    # 6) Persist updated notification state
    save_notification_state(STATE_FILE, new_state)


if __name__ == "__main__":
    main()
