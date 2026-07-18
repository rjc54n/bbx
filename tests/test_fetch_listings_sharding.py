# tests/test_fetch_listings_sharding.py
# Tests for the facet-sharded fetch that works around Algolia's
# 1,000-hit pagination cap, using a fake in-memory "index".

import pytest

import core.fetch_listings as fl
from core.fetch_listings import (
    FetchResult,
    _build_not_filter,
    _escape_facet_value,
    _fetch_sharded,
    fetch_listings,
)


class FakeIndex:
    """
    Simulates the Algolia index at the level _fetch_sharded interacts with:
    counts/facets per filter set, and paged (capped) hit retrieval.

    Records are dicts with objectID plus facet fields.
    """

    def __init__(self, records, cap=fl.PAGINATION_CAP):
        self.records = records
        self.cap = cap
        self.count_calls = []
        self.fetch_calls = []

    def _matches(self, record, clause):
        if clause.startswith("NOT "):
            return not self._matches(record, clause[4:])
        field, _, quoted = clause.partition(":")
        value = quoted.strip("'").replace("\\'", "'")
        rv = record.get(field)
        if isinstance(rv, list):  # multi-valued facet: membership test
            return value in [str(x) for x in rv]
        return str(rv) == value

    def _select(self, filter_clauses):
        return [
            r for r in self.records
            if all(self._matches(r, c) for c in filter_clauses if c != "base:'x'")
        ]

    def count_and_facets(self, app_id, key, filter_clauses, facet_fields, index_name=None):
        self.count_calls.append(list(filter_clauses))
        matched = self._select(filter_clauses)
        facets = {}
        for field in facet_fields:
            counts = {}
            for r in matched:
                v = r.get(field)
                if v is None:
                    continue
                values = v if isinstance(v, list) else [v]
                for vv in values:  # multi-valued facet double-counts, as Algolia does
                    counts[str(vv)] = counts.get(str(vv), 0) + 1
            if counts:
                facets[field] = counts
        return len(matched), facets

    def fetch_with_filters(self, app_id, key, filter_clauses, index_name=None, hits_per_page=100, max_pages=500):
        self.fetch_calls.append(list(filter_clauses))
        return self._select(filter_clauses)[: self.cap]


@pytest.fixture
def use_fake_index(monkeypatch):
    def _install(fake):
        monkeypatch.setattr(fl, "_count_and_facets", fake.count_and_facets)
        monkeypatch.setattr(fl, "_fetch_with_filters", fake.fetch_with_filters)
    return _install


def _records(n, **fields):
    prefix = "-".join(str(v) for v in fields.values()) or "r"
    return [{"objectID": f"{prefix}-{i}", **fields} for i in range(n)]


def _run(filters, dims):
    collected = {}
    _fetch_sharded("app", "key", filters, dims, collected)
    return collected


def test_under_cap_fetches_directly_without_sharding(use_fake_index):
    fake = FakeIndex(_records(50, region="Loire"))
    use_fake_index(fake)

    collected = _run(["base:'x'"], ["region"])

    assert len(collected) == 50
    assert len(fake.fetch_calls) == 1          # one paged fetch
    assert fake.fetch_calls[0] == ["base:'x'"]  # no shard clause added


def test_over_cap_shards_by_facet_and_collects_everything(use_fake_index):
    records = (
        _records(900, region="Burgundy")
        + _records(800, region="Bordeaux")
        + _records(100, region="Loire")
    )
    fake = FakeIndex(records, cap=1000)
    use_fake_index(fake)

    collected = _run(["base:'x'"], ["region"])

    assert len(collected) == 1800
    # One fetch per region shard, none for the (empty) NOT-shard
    assert len(fake.fetch_calls) == 3


def test_records_missing_facet_are_caught_by_not_shard(use_fake_index):
    records = (
        _records(700, region="Burgundy")
        + _records(700, region="Bordeaux")
        + [{"objectID": f"nofacet-{i}"} for i in range(30)]  # no region field
    )
    fake = FakeIndex(records, cap=1000)
    use_fake_index(fake)

    collected = _run(["base:'x'"], ["region"])

    assert len(collected) == 1430
    not_calls = [c for c in fake.fetch_calls if any(f.startswith("NOT ") for f in c)]
    assert len(not_calls) == 1


def test_oversized_shard_recurses_into_next_dimension(use_fake_index):
    records = (
        _records(800, region="Burgundy", colour="Red")
        + _records(600, region="Burgundy", colour="White")
        + _records(200, region="Loire", colour="White")
    )
    fake = FakeIndex(records, cap=1000)
    use_fake_index(fake)

    collected = _run(["base:'x'"], ["region", "colour"])

    assert len(collected) == 1600
    # Burgundy (1400) must have been split by colour
    burgundy_colour_calls = [
        c for c in fake.fetch_calls
        if "region:'Burgundy'" in c and any(f.startswith("colour:") for f in c)
    ]
    assert len(burgundy_colour_calls) == 2


def test_dims_exhausted_over_cap_still_fetches_with_truncation(use_fake_index, caplog):
    fake = FakeIndex(_records(1500, region="Burgundy"), cap=1000)
    use_fake_index(fake)

    with caplog.at_level("WARNING"):
        collected = _run(["base:'x'"], [])

    assert len(collected) == 1000  # capped, but not silently empty
    assert any("truncating" in r.message for r in caplog.records)


def test_known_count_skips_redundant_count_queries(use_fake_index):
    records = _records(600, region="Burgundy") + _records(600, region="Bordeaux")
    fake = FakeIndex(records, cap=1000)
    use_fake_index(fake)

    collected = _run(["base:'x'"], ["region"])

    assert len(collected) == 1200
    # Each region shard's size was known from the root's facet counts, so the
    # shards themselves need no count query. Two counts total: the root, and
    # the always-issued complement shard (which here returns zero) — that one
    # cheap count is the price of being correct for multi-valued facets.
    assert len(fake.count_calls) == 2


def test_multivalued_facet_complement_still_queried(use_fake_index):
    # Each record belongs to TWO bands, so facet counts sum to ~2x nb_hits.
    # The old `sum(counts) < nb_hits` guard would read 2x >= nb_hits and skip
    # the complement, silently dropping the band-less records. The complement
    # must run regardless.
    # Total must exceed PAGINATION_CAP so the root actually shards; each single
    # band must stay under it so shards fetch without truncation. 20 bands with
    # each record in 2 adjacent bands gives ~150 records/band.
    NB = 20
    banded = [
        {"objectID": f"both-{i}", "band": [str(i % NB), str((i + 1) % NB)]}
        for i in range(1500)
    ]
    bandless = [{"objectID": f"none-{i}"} for i in range(40)]
    fake = FakeIndex(banded + bandless, cap=fl.PAGINATION_CAP)
    use_fake_index(fake)

    collected = _run(["base:'x'"], ["band"])

    # 1500 banded (deduped across overlapping shards) + 40 band-less, none lost.
    assert len(collected) == 1540
    not_calls = [c for c in fake.fetch_calls if any(f.startswith("NOT ") for f in c)]
    assert len(not_calls) == 1


def test_dedupe_across_overlapping_shards(use_fake_index):
    # Same objectID appearing under two shards must be stored once.
    records = _records(600, region="Burgundy") + _records(600, region="Bordeaux")
    dupe = dict(records[0])
    dupe["region"] = "Bordeaux"  # won't happen in Algolia, but proves keying
    fake = FakeIndex(records + [dupe], cap=1000)
    use_fake_index(fake)

    collected = _run(["base:'x'"], ["region"])
    assert len(collected) == 1200


# ----------------------------------------------------------------
# fetch_listings: shard dimensions respect user-pinned facets
# ----------------------------------------------------------------

def _capture_shard_dims(monkeypatch):
    captured = {}

    def fake_sharded(app_id, key, filters, dims, collected, *a, **kw):
        captured["filters"] = filters
        captured["dims"] = dims

    monkeypatch.setattr(fl, "_fetch_sharded", fake_sharded)
    monkeypatch.setattr(fl, "_count_and_facets", lambda *a, **kw: (0, {}))
    return captured


def test_fetch_listings_excludes_pinned_colour_from_shard_dims(monkeypatch):
    captured = _capture_shard_dims(monkeypatch)
    fetch_listings("app", "key", days_label=None, colour_choice="Red")
    assert "colour" not in captured["dims"]
    assert "colour:'Red'" in captured["filters"]


def test_fetch_listings_excludes_pinned_price_from_shard_dims(monkeypatch):
    captured = _capture_shard_dims(monkeypatch)
    fetch_listings("app", "key", days_label=None, price_bands=["up to £200"])
    assert fl.PRICE_FACET_FIELD not in captured["dims"]


def test_fetch_listings_any_colour_keeps_all_dims(monkeypatch):
    captured = _capture_shard_dims(monkeypatch)
    fetch_listings("app", "key", days_label="1 Day", colour_choice="Any")
    assert captured["dims"] == fl.SHARD_DIMENSIONS
    assert "new_to_bbx:'1 Day'" in captured["filters"]


# ----------------------------------------------------------------
# Filter-builder helpers
# ----------------------------------------------------------------

def test_escape_facet_value():
    assert _escape_facet_value("Cote d'Or") == "Cote d\\'Or"


def test_build_not_filter():
    assert _build_not_filter("region", ["A", "B"]) == [
        "NOT region:'A'", "NOT region:'B'"
    ]


# ----------------------------------------------------------------
# FetchResult and discovery completeness
# ----------------------------------------------------------------


class TestFetchResult:
    def test_complete_when_all_collected(self):
        r = FetchResult(hits=[{"a": 1}], total_index_hits=1, collected_count=1, truncated=False)
        assert r.discovery_complete is True

    def test_incomplete_when_truncated(self):
        r = FetchResult(hits=[{"a": 1}], total_index_hits=2000, collected_count=1000, truncated=True)
        assert r.discovery_complete is False

    def test_incomplete_when_collected_lt_total(self):
        r = FetchResult(hits=[], total_index_hits=100, collected_count=50, truncated=False)
        assert r.discovery_complete is False

    def test_complete_with_zero_hits(self):
        r = FetchResult(hits=[], total_index_hits=0, collected_count=0, truncated=False)
        assert r.discovery_complete is True


def test_fetch_listings_returns_fetch_result(use_fake_index):
    records = [{"objectID": str(i), "stock_origin": "BBX", "region": f"R{i}"}
               for i in range(50)]
    fake = FakeIndex(records)
    use_fake_index(fake)
    result = fetch_listings("app", "key", days_label=None)
    assert isinstance(result, FetchResult)
    assert len(result.hits) == 50
    assert result.total_index_hits == 50
    assert result.collected_count == 50
    assert result.discovery_complete is True


def test_truncated_set_when_shard_dims_exhausted(use_fake_index, caplog):
    """When no shard dimensions remain but hits exceed the cap, truncated is set."""
    records = [{"objectID": str(i), "stock_origin": "BBX", "new_to_bbx": "1 Day"}
               for i in range(1500)]
    fake = FakeIndex(records, cap=fl.PAGINATION_CAP)
    use_fake_index(fake)
    result = fetch_listings("app", "key", days_label="1 Day")
    assert result.truncated is True
    assert result.discovery_complete is False
