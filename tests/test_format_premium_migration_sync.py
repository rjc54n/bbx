"""
Guards against core/format_premium.py and the SQL premium CASE drifting apart --
they encode the same curve twice (Python for the sweep/analysis code, SQL for the
read model) and nothing else ties them together.

Every migration that restates the CASE is checked. 20260827120000 copied it into
catalogue_mv, which is the definition that now actually serves traffic; pinning
only the original would have left the live one unguarded.
"""
import pathlib
import re

import pytest

from core.format_premium import FORMAT_PREMIUM

MIGRATIONS_DIR = pathlib.Path(__file__).parent.parent / "supabase" / "migrations"

MIGRATIONS = [
    MIGRATIONS_DIR / "20260723162035_format_adjusted_guide.sql",
    MIGRATIONS_DIR / "20260827120000_catalogue_materialised_read_model.sql",
]

# Matches "WHEN base.bottle_volume_ml = 375  THEN ROUND(base.market_price_p * 1.031)"
PREMIUM_LINE = re.compile(
    r"WHEN base\.bottle_volume_ml = (\d+)\s+THEN ROUND\(base\.market_price_p \* ([\d.]+)\)"
)
# Matches the reference-format line, which applies no multiplier.
REFERENCE_LINE = re.compile(
    r"WHEN base\.bottle_volume_ml = (\d+)\s+THEN base\.market_price_p\s"
)


def _sql_text(migration):
    assert migration.exists(), f"migration not found: {migration}"
    return migration.read_text()


@pytest.mark.parametrize("migration", MIGRATIONS, ids=lambda m: m.name)
def test_sql_premium_multipliers_match_format_premium(migration):
    sql = _sql_text(migration)
    found = {int(vol): round(float(factor) - 1, 3) for vol, factor in PREMIUM_LINE.findall(sql)}
    expected = {vol: p for vol, p in FORMAT_PREMIUM.items() if p != 0.0}
    assert found == expected


@pytest.mark.parametrize("migration", MIGRATIONS, ids=lambda m: m.name)
def test_sql_reference_format_matches_format_premium(migration):
    sql = _sql_text(migration)
    (volume,) = REFERENCE_LINE.findall(sql)
    assert int(volume) == 750
    assert FORMAT_PREMIUM[750] == 0.0


@pytest.mark.parametrize("migration", MIGRATIONS, ids=lambda m: m.name)
def test_sql_has_no_premium_line_for_unmapped_volumes(migration):
    sql = _sql_text(migration)
    mapped_in_sql = {int(v) for v, _ in PREMIUM_LINE.findall(sql)} | {750}
    assert mapped_in_sql == set(FORMAT_PREMIUM)


@pytest.mark.parametrize("migration", MIGRATIONS, ids=lambda m: m.name)
def test_sql_falls_back_to_identity_for_unknown_format(migration):
    sql = _sql_text(migration)
    assert "ELSE base.market_price_p" in sql
