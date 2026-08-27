"""
Guards the non-obvious constraint that 20260827120000 introduced: catalogue_view
reads a materialized cache, so it does not see writes to private.skus /
private.products / private.offers until the cache is rebuilt.

The pgTAP suite writes those tables directly and then reads catalogue_view, or
something downstream of it, so every such test must call
private.rebuild_catalogue_caches() after its last write. Two tests in
bbr_cellar_import.test.sql mutate private.skus half way through and initially
missed it -- the failure was a confusing "have 31000, want 33000" rather than
anything pointing at the cache.

Production is unaffected: core/store.py refreshes the caches in the same sweep
that writes the tables.
"""
import pathlib
import re

import pytest

TESTS = sorted(
    (pathlib.Path(__file__).parent.parent / "supabase" / "tests" / "database")
    .glob("*.test.sql")
)

MUTATION = re.compile(
    r"^\s*(?:INSERT INTO|UPDATE|DELETE FROM)\s+private\.(?:products|skus|offers)\b"
)
# Views that resolve through catalogue_mv or wine_market_summary_mv.
CACHED_READ = re.compile(
    r"public\.(?:catalogue_view|wine_card_format_view|wine_scenario_view"
    r"|bbr_cellar_market_view|current_cellartracker_records|favourite_wine_view"
    r"|release_price_market_view)\b"
)
REBUILD = "rebuild_catalogue_caches"


def _lines(path):
    return path.read_text().split("\n")


@pytest.mark.parametrize("path", TESTS, ids=lambda p: p.name)
def test_every_scan_store_write_is_followed_by_a_cache_rebuild(path):
    lines = _lines(path)
    mutations = [i for i, line in enumerate(lines) if MUTATION.match(line)]
    if not mutations:
        return
    if not any(CACHED_READ.search(line) for line in lines):
        return

    rebuilds = [i for i, line in enumerate(lines) if REBUILD in line]
    assert rebuilds, (
        f"{path.name} writes the scan store and reads a cached view, but never "
        f"calls private.{REBUILD}(). The reads will see an empty cache."
    )
    orphaned = [i + 1 for i in mutations if i > max(rebuilds)]
    assert not orphaned, (
        f"{path.name} writes private.products/skus/offers at line(s) "
        f"{orphaned} after its last private.{REBUILD}() call. Any cached view "
        f"read after that point still sees the pre-write state."
    )
