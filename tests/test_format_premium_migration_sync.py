"""
Guards against core/format_premium.py and the catalogue_view migration's
SQL CASE drifting apart -- they encode the same premium curve twice (Python
for the sweep/analysis code, SQL for the read model) and nothing else ties
them together.
"""
import pathlib
import re

from core.format_premium import FORMAT_PREMIUM

MIGRATION = (
    pathlib.Path(__file__).parent.parent
    / "supabase" / "migrations" / "20260723162035_format_adjusted_guide.sql"
)

# Matches "WHEN base.bottle_volume_ml = 375  THEN ROUND(base.market_price_p * 1.031)"
PREMIUM_LINE = re.compile(
    r"WHEN base\.bottle_volume_ml = (\d+)\s+THEN ROUND\(base\.market_price_p \* ([\d.]+)\)"
)
# Matches the reference-format line, which applies no multiplier.
REFERENCE_LINE = re.compile(
    r"WHEN base\.bottle_volume_ml = (\d+)\s+THEN base\.market_price_p\s"
)


def _sql_text():
    assert MIGRATION.exists(), f"migration not found: {MIGRATION}"
    return MIGRATION.read_text()


def test_sql_premium_multipliers_match_format_premium():
    sql = _sql_text()
    found = {int(vol): round(float(factor) - 1, 3) for vol, factor in PREMIUM_LINE.findall(sql)}
    expected = {vol: p for vol, p in FORMAT_PREMIUM.items() if p != 0.0}
    assert found == expected


def test_sql_reference_format_matches_format_premium():
    sql = _sql_text()
    (volume,) = REFERENCE_LINE.findall(sql)
    assert int(volume) == 750
    assert FORMAT_PREMIUM[750] == 0.0


def test_sql_has_no_premium_line_for_unmapped_volumes():
    sql = _sql_text()
    mapped_in_sql = {int(v) for v, _ in PREMIUM_LINE.findall(sql)} | {750}
    assert mapped_in_sql == set(FORMAT_PREMIUM)


def test_sql_falls_back_to_identity_for_unknown_format():
    sql = _sql_text()
    assert "ELSE base.market_price_p" in sql
