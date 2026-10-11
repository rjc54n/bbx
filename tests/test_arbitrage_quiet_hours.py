# tests/test_arbitrage_quiet_hours.py
# Scheduled arbitrage triggers stay silent 23:00-08:00 UK time; manual runs do not.

from datetime import datetime, timezone

import pytest

import apps.arbitrage_bot.run_arbitrage as bot


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


@pytest.mark.parametrize("now, quiet", [
    # BST (UTC+1): quiet 22:00-07:00 UTC.
    (utc(2026, 10, 10, 21, 59), False),
    (utc(2026, 10, 10, 22, 0), True),
    (utc(2026, 10, 11, 1, 53), True),
    (utc(2026, 10, 11, 6, 59), True),
    (utc(2026, 10, 11, 7, 0), False),
    # GMT after 25 October: quiet 23:00-08:00 UTC.
    (utc(2026, 11, 2, 22, 59), False),
    (utc(2026, 11, 2, 23, 0), True),
    (utc(2026, 11, 3, 7, 59), True),
    (utc(2026, 11, 3, 8, 0), False),
])
def test_in_quiet_hours_follows_uk_time(now, quiet):
    assert bot.in_quiet_hours(now) is quiet


def test_scheduled_run_in_quiet_hours_skips_before_any_work(monkeypatch):
    monkeypatch.setenv("ARBITRAGE_SCHEDULED", "1")
    monkeypatch.setattr(bot, "in_quiet_hours", lambda now: True)
    monkeypatch.setattr(bot, "get_algolia_credentials", lambda: pytest.fail("scan started"))
    bot.main()


def test_manual_run_ignores_quiet_hours(monkeypatch):
    monkeypatch.delenv("ARBITRAGE_SCHEDULED", raising=False)
    monkeypatch.setattr(bot, "in_quiet_hours", lambda now: True)
    monkeypatch.setattr(bot, "get_algolia_credentials", lambda: (_ for _ in ()).throw(RuntimeError("started")))
    with pytest.raises(RuntimeError, match="started"):
        bot.main()
