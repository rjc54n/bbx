"""
Tests for the format-premium correction (core/format_premium.py).

See docs/ROADMAP-2026-07.md and docs/PHASE3-4-IMPLEMENTATION.md Step 1 for
the measurement behind FORMAT_PREMIUM and the rules being locked here.
"""
from core.format_premium import FORMAT_PREMIUM, adjusted_guide_pence


def test_reference_format_is_identity():
    assert adjusted_guide_pence(10000, case_size=12, bottle_volume_ml=750) == 10000


def test_none_guide_returns_none():
    assert adjusted_guide_pence(None, case_size=6, bottle_volume_ml=1500) is None


def test_unknown_volume_is_identity():
    assert adjusted_guide_pence(10000, case_size=6, bottle_volume_ml=6750) == 10000


def test_each_mapped_volume_applies_its_premium():
    for volume_ml, premium in FORMAT_PREMIUM.items():
        result = adjusted_guide_pence(10000, case_size=6, bottle_volume_ml=volume_ml)
        assert result == round(10000 * (1 + premium)), volume_ml


def test_magnum_and_half_bottle_share_the_measured_premium():
    # Both measured at +3.1% in the underlying BBR offer analysis.
    magnum = adjusted_guide_pence(10000, case_size=6, bottle_volume_ml=1500)
    half = adjusted_guide_pence(10000, case_size=12, bottle_volume_ml=375)
    assert magnum == half == 10310


def test_double_magnum_is_the_largest_measured_premium():
    largest = max(FORMAT_PREMIUM.items(), key=lambda kv: kv[1])
    assert largest == (3000, 0.178)
