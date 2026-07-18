# tests/test_notification_state.py
# Unit tests for the deduplication rules in core.notification_state.

import copy
from datetime import datetime, timedelta, timezone

import pytest

from core.notification_state import (
    filter_new_or_improved,
    load_notification_state,
    save_notification_state,
    _to_iso_z,
)


def _candidate(sku="SKU1", ask=100.0, **extra):
    return {"sku": sku, "ask": ask, "name": "Test Wine", **extra}


def _state_record(ask=100.0, days_ago=0.0, count=1):
    ts = _to_iso_z(datetime.now(timezone.utc) - timedelta(days=days_ago))
    return {
        "sku": "SKU1",
        "ask_last_notified": ask,
        "first_notified_at": ts,
        "last_notified_at": ts,
        "notification_count": count,
    }


def test_new_sku_notifies_and_creates_record():
    notified, suppressed, new_state = filter_new_or_improved(
        [_candidate()], {}, reminder_days=7
    )
    assert len(notified) == 1
    assert suppressed == []
    assert new_state["SKU1"]["ask_last_notified"] == 100.0
    assert new_state["SKU1"]["notification_count"] == 1


def test_improved_ask_notifies_and_updates_state():
    state = {"SKU1": _state_record(ask=120.0)}
    notified, suppressed, new_state = filter_new_or_improved(
        [_candidate(ask=100.0)], state, reminder_days=7
    )
    assert len(notified) == 1
    assert suppressed == []
    assert new_state["SKU1"]["ask_last_notified"] == 100.0
    assert new_state["SKU1"]["notification_count"] == 2


def test_unchanged_ask_within_window_suppresses():
    state = {"SKU1": _state_record(ask=100.0, days_ago=1)}
    notified, suppressed, _ = filter_new_or_improved(
        [_candidate(ask=100.0)], state, reminder_days=7
    )
    assert notified == []
    assert len(suppressed) == 1


def test_unchanged_ask_past_reminder_interval_renotifies():
    state = {"SKU1": _state_record(ask=100.0, days_ago=8, count=3)}
    notified, suppressed, new_state = filter_new_or_improved(
        [_candidate(ask=100.0)], state, reminder_days=7
    )
    assert len(notified) == 1
    assert suppressed == []
    assert new_state["SKU1"]["notification_count"] == 4


def test_increased_ask_suppresses():
    state = {"SKU1": _state_record(ask=100.0)}
    notified, suppressed, _ = filter_new_or_improved(
        [_candidate(ask=150.0)], state, reminder_days=7
    )
    assert notified == []
    assert len(suppressed) == 1


def test_missing_sku_or_ask_is_conservatively_notified():
    notified, suppressed, _ = filter_new_or_improved(
        [{"ask": 100.0}, {"sku": "SKU2"}, {"sku": "SKU3", "ask": "not-a-number"}],
        {},
        reminder_days=7,
    )
    assert len(notified) == 3
    assert suppressed == []


def test_caller_state_is_not_mutated():
    state = {"SKU1": _state_record(ask=120.0, days_ago=1, count=1)}
    before = copy.deepcopy(state)
    filter_new_or_improved([_candidate(ask=100.0)], state, reminder_days=7)
    assert state == before


# --------------------------------------------------------------
# Local-file load/save error semantics
# --------------------------------------------------------------

def test_load_missing_file_starts_fresh(tmp_path):
    assert load_notification_state(tmp_path / "does_not_exist.json") == {}


def test_load_roundtrip(tmp_path):
    path = tmp_path / "state.json"
    state = {"SKU1": {"ask_last_notified": 100.0}}
    save_notification_state(path, state)
    assert load_notification_state(path) == state


def test_load_corrupt_file_raises(tmp_path):
    # A present-but-unreadable state file must NOT be silently discarded,
    # or every open opportunity would re-alert.
    path = tmp_path / "state.json"
    path.write_text("{ this is not valid json", encoding="utf-8")
    with pytest.raises(Exception):
        load_notification_state(path)


def test_load_non_object_raises(tmp_path):
    path = tmp_path / "state.json"
    path.write_text("[1, 2, 3]", encoding="utf-8")
    with pytest.raises(ValueError):
        load_notification_state(path)


def test_save_failure_raises(tmp_path):
    # Parent path is a regular file, so mkdir/write must fail and propagate.
    blocker = tmp_path / "blocker"
    blocker.write_text("x", encoding="utf-8")
    with pytest.raises(Exception):
        save_notification_state(blocker / "state.json", {"SKU1": {}})
