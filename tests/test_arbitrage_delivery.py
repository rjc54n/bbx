# tests/test_arbitrage_delivery.py
# Delivery correctness for the arbitrage bot's main():
#   - state is persisted ONLY after a confirmed Slack send
#   - a rejected send fails the job and persists nothing
#   - dry runs neither send nor persist

import pytest

import apps.arbitrage_bot.run_arbitrage as bot
from core.pipeline import ScanOutcome


def _candidate(sku="S1", ask=100.0):
    return {
        "sku": sku, "ask": ask, "name": "Test Wine", "vintage": 2010,
        "region": "Burgundy", "case_format": "6x75cl", "mkt": 130.0,
        "last": None, "next_lowest": None,
        "pct_market": 23.0, "pct_last": None, "pct_next": None,
        "url": "https://www.bbr.com/x",
    }


@pytest.fixture
def wire_bot(monkeypatch):
    """Patch the bot's collaborators; return dicts capturing sends and saves."""
    sends = []
    saves = []

    def _install(candidates=None, send_result=True, dry_run=False, state=None, outcome=None):
        scan_outcome = outcome if outcome is not None else ScanOutcome(candidates=candidates or [])
        monkeypatch.setattr(bot, "get_algolia_credentials", lambda: ("app", "key"))
        monkeypatch.setattr(bot, "load_notification_state", lambda p: dict(state or {}))
        monkeypatch.setattr(bot, "run_scan", lambda *a, **k: scan_outcome)
        monkeypatch.setattr(bot, "DRY_RUN", dry_run)

        def fake_send(msg):
            sends.append(msg)
            return send_result

        def fake_save(path, new_state):
            saves.append(new_state)

        monkeypatch.setattr(bot, "send_slack_message", fake_send)
        monkeypatch.setattr(bot, "save_notification_state", fake_save)
        return sends, saves

    return _install


def test_successful_send_persists_state(wire_bot):
    sends, saves = wire_bot([_candidate("S1")], send_result=True)
    bot.main()
    assert len(sends) == 1
    assert len(saves) == 1
    assert "S1" in saves[0]  # the notified SKU was recorded


def test_rejected_send_raises_and_persists_nothing(wire_bot):
    sends, saves = wire_bot([_candidate("S1")], send_result=False)
    with pytest.raises(RuntimeError):
        bot.main()
    assert len(sends) == 1   # we attempted delivery
    assert saves == []       # but persisted nothing -> re-alerts next run


def test_dry_run_never_sends_or_persists(wire_bot):
    sends, saves = wire_bot([_candidate("S1")], dry_run=True)
    bot.main()
    assert sends == []
    assert saves == []


def test_no_candidates_sends_and_saves_nothing(wire_bot):
    # Nothing notified -> nothing to deliver and no state change to persist.
    sends, saves = wire_bot([], send_result=True)
    bot.main()
    assert sends == []
    assert saves == []


def test_incomplete_coverage_raises_before_sending(wire_bot):
    # Half the book unpriced (failed REST batches) -> fail the job, send/persist
    # nothing, rather than alert on a partial scan.
    outcome = ScanOutcome(
        candidates=[_candidate("S1")],
        expected_skus=100, queried_skus=50, failed_skus=50,
    )
    sends, saves = wire_bot(outcome=outcome)
    with pytest.raises(RuntimeError):
        bot.main()
    assert sends == []
    assert saves == []
