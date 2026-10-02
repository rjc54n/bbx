from datetime import datetime, timedelta, timezone

import pytest

from core.sweep_window import in_sweep_window, recent_run_reason


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


@pytest.mark.parametrize("now, expected", [
    # British Summer Time (UTC+1): window is 21:00-00:00 UTC.
    (utc(2026, 10, 2, 20, 59), False),
    (utc(2026, 10, 2, 21, 0), True),
    (utc(2026, 10, 2, 23, 59), True),
    (utc(2026, 10, 3, 0, 0), False),
    (utc(2026, 10, 3, 3, 0), False),   # nightly backup
    (utc(2026, 10, 3, 14, 0), False),  # shopping hours
    # GMT after 25 October: window is 22:00-01:00 UTC.
    (utc(2026, 11, 2, 21, 30), False),
    (utc(2026, 11, 2, 22, 0), True),
    (utc(2026, 11, 3, 0, 59), True),
    (utc(2026, 11, 3, 1, 0), False),
])
def test_window_follows_uk_time(now, expected):
    assert in_sweep_window(now) is expected


NOW = utc(2026, 10, 4, 21, 30)


def test_runs_when_last_sweep_was_two_days_ago():
    assert recent_run_reason([("completed", NOW - timedelta(hours=47))], NOW) is None


@pytest.mark.parametrize("status", ["completed", "partial"])
def test_skips_within_two_day_cadence(status):
    assert recent_run_reason([(status, NOW - timedelta(hours=30))], NOW)


def test_skips_second_trigger_on_the_same_night():
    assert recent_run_reason([("completed", NOW - timedelta(minutes=40))], NOW)


def test_failed_run_waits_for_next_night_then_retries():
    tonight = [("failed", NOW - timedelta(hours=1))]
    last_night = [("failed", NOW - timedelta(hours=24))]
    assert recent_run_reason(tonight, NOW)
    assert recent_run_reason(last_night, NOW) is None


def test_no_history_runs():
    assert recent_run_reason([], NOW) is None
