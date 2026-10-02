"""When a scheduled sweep is allowed to run.

GitHub's scheduler has started this workflow 4h40m-6h25m late at 02:00 UTC
and about an hour late in the evening, so the schedule fires hourly through
the afternoon and evening and each trigger decides for itself whether to run
(docs/SWEEP-WRITE-REDUCTION-2026-10-02.md, "Schedule"):

- Only between 22:00 and 01:00 UK time, to keep the API-heavy discovery out
  of BBX's shopping hours and the database work clear of the ~03:00 UTC
  backup. Europe/London, so the window follows the clocks.
- Not if a sweep completed or partly completed in the last 40 hours (the
  two-day cadence, and a second trigger in the same night), nor if any sweep
  started in the last 12 hours (a failed run waits for the next night).

Stdlib only: the workflow calls this before installing dependencies, so an
out-of-window trigger costs seconds.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")
WINDOW_START_HOUR = 22  # 22:00 UK time
WINDOW_END_HOUR = 1     # until 01:00 UK time
COMPLETED_GAP = timedelta(hours=40)
ANY_RUN_GAP = timedelta(hours=12)


def in_sweep_window(now_utc: datetime) -> bool:
    local = now_utc.astimezone(LONDON)
    return local.hour >= WINDOW_START_HOUR or local.hour < WINDOW_END_HOUR


def recent_run_reason(runs, now_utc: datetime) -> str | None:
    """Why a scheduled sweep should skip, given recent (status, started_at) rows.

    started_at must be timezone-aware. Returns None when the sweep may run.
    """
    for status, started_at in runs:
        age = now_utc - started_at
        if status in ("completed", "partial") and age < COMPLETED_GAP:
            return f"a {status} sweep started {age} ago (two-day cadence)"
        if age < ANY_RUN_GAP:
            return f"a {status} sweep started {age} ago (one attempt per night)"
    return None


def main() -> int:
    now = datetime.now(timezone.utc)
    allowed = in_sweep_window(now)
    local = now.astimezone(LONDON).strftime("%H:%M %Z")
    print(f"UK time {local}: {'inside' if allowed else 'outside'} the 22:00-01:00 sweep window")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a") as fh:
            fh.write(f"run={'true' if allowed else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
