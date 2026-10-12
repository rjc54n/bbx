# Ensures the repo root is on sys.path so tests can import "core".


import pytest


@pytest.fixture(autouse=True)
def _scheduled_flags_unset(monkeypatch):
    """CI sets ARBITRAGE_SCHEDULED for the whole job, including this test step.

    Tests that call main() must not depend on the time of day, so they start
    with the flag cleared and opt in explicitly.
    """
    monkeypatch.delenv("ARBITRAGE_SCHEDULED", raising=False)

