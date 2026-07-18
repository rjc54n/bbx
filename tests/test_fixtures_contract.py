"""
Contract tests over the committed Phase 1A fixtures (tests/fixtures/).

These lock the parse invariants the entity model in docs/PHASE1A-entity-model.md
depends on, so a change to a parser or to BBR's response shape breaks a test
rather than silently invalidating the design. They assert only what the captured
fixtures actually prove — cross-source equality and same-scan structure — not
longitudinal durability (that is Phase 1B).
"""
import copy
import json
import pathlib

import pytest

from core.pipeline import (
    count_variant_nodes,
    extract_variant_prices,
    order_book_readable,
)

FIX = pathlib.Path(__file__).parent / "fixtures"


def _load(name):
    return json.loads((FIX / name).read_text())


# ---- helpers that mirror how a 1B writer would read the fixtures ----

def _algolia_offer_ids(hit):
    return {int(o["bbx_listing_id"]) for o in hit["purchase_options"]}


def _gql_listing_ids(gql):
    items = gql["data"]["products"]["items"]
    return {v["product"]["listing_id"] for v in items[0]["variants"]}


def _rest_format_code(case_size, bottle_volume):
    """Normalise (case_size, '75 cl') -> REST format code '06-00750'."""
    ml = int(round(float(bottle_volume.replace("cl", "").strip()) * 10))
    return f"{int(case_size):02d}-{ml:05d}"


# ---------------------------------------------------------------------------

def test_settled_algolia_and_gql_offer_id_sets_match():
    """The core identity finding: same offer-id set in both sources, same scan."""
    multi = _load("algolia_listing_hit.json")["multi_offer"]
    gql = _load("gql_order_book_multi.json")
    assert _algolia_offer_ids(multi) == _gql_listing_ids(gql) == {133111, 137028, 164943, 169009}


def test_lagging_fixture_is_deliberately_incomplete():
    """The lagging capture is a strict subset — a real eventual-consistency state."""
    settled = _gql_listing_ids(_load("gql_order_book_multi.json"))
    lagging = _gql_listing_ids(_load("gql_order_book_multi_lagging.json"))
    assert lagging < settled                      # strict subset
    assert settled - lagging == {169009}          # exactly the freshly-created offer
    # The newest offer is present in Algolia even while GraphQL lags.
    assert 169009 in _algolia_offer_ids(_load("algolia_listing_hit.json")["multi_offer"])


def test_rest_retains_all_seven_formats():
    """REST prices per format; a 1B parser must keep every entry, not entries[0]."""
    rest = _load("rest_pricing.json")
    entries = rest["20158007342"]
    formats = [e["format"] for e in entries]
    assert len(entries) == 7
    assert len(set(formats)) == 7
    assert "06-00750" in formats


def test_same_price_offers_stay_separate():
    """Offers sharing a price are distinct only by id — must not be collapsed."""
    deep = _load("algolia_deep_book.json")
    po = deep["purchase_options"]
    at_500 = [o for o in po if o["prices"]["price_per_case_exact"] == 500]
    assert len(at_500) == 5
    assert len({int(o["bbx_listing_id"]) for o in at_500}) == 5   # 5 distinct ids
    # Old and new ids coexist live (point-in-time durability signal, not proof).
    ids = [int(o["bbx_listing_id"]) for o in po]
    assert min(ids) == 668 and max(ids) == 168993


def test_offer_formats_normalise_to_rest_format_code():
    """Algolia offer (case_size, bottle_volume) maps onto a REST format code."""
    multi = _load("algolia_listing_hit.json")["multi_offer"]
    rest_formats = {e["format"] for e in _load("rest_pricing.json")["20171135668"]}
    for o in multi["purchase_options"]:
        code = _rest_format_code(o["case_size"], o["bottle_volume"])
        assert code == "06-00750"
        assert code in rest_formats


def test_order_book_readable_detects_dropped_price_field():
    """If a required price path disappears, the book is UNREADABLE, not silently short."""
    gql = _load("gql_order_book_multi.json")
    assert count_variant_nodes(gql) == 4
    assert len(extract_variant_prices(gql)) == 4
    assert order_book_readable(gql, extract_variant_prices(gql)) is True

    broken = copy.deepcopy(gql)
    del broken["data"]["products"]["items"][0]["variants"][0]["product"]["custom_prices"]
    prices = extract_variant_prices(broken)
    assert len(prices) == 3                        # one variant no longer yields a price
    assert count_variant_nodes(broken) == 4        # but the node is still there
    assert order_book_readable(broken, prices) is False   # -> untrusted, not "sole"


def test_offer_id_is_present_on_every_offer():
    """A missing offer id must be detectable (not defaulted away)."""
    for name in ("algolia_listing_hit.json", "algolia_deep_book.json"):
        data = _load(name)
        hits = [data["multi_offer"], data["sole_offer"]] if "multi_offer" in data else [data]
        for hit in hits:
            for o in hit["purchase_options"]:
                assert o.get("bbx_listing_id"), f"offer missing bbx_listing_id in {name}"
