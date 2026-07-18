"""Tests for core.models — entity dataclasses and conversion helpers."""
import json
import pathlib

from core.models import (
    Product,
    Sku,
    Offer,
    ObservationEvent,
    format_code_from,
    bottle_volume_to_ml,
    pounds_to_pence,
)

FIX = pathlib.Path(__file__).parent / "fixtures"


def _load(name):
    return json.loads((FIX / name).read_text())


# --- conversion helpers ---


class TestPoundsToPence:
    def test_whole_pounds(self):
        assert pounds_to_pence(250) == 25000

    def test_fractional_pounds(self):
        assert pounds_to_pence(41.666666666667) == 4167

    def test_zero_returns_none(self):
        assert pounds_to_pence(0) is None

    def test_none_returns_none(self):
        assert pounds_to_pence(None) is None

    def test_string_number(self):
        assert pounds_to_pence("375") == 37500


class TestFormatCode:
    def test_standard(self):
        assert format_code_from(6, 750) == "06-00750"

    def test_magnum(self):
        assert format_code_from(3, 1500) == "03-01500"

    def test_jeroboam(self):
        assert format_code_from(1, 3000) == "01-03000"


class TestBottleVolumeToMl:
    def test_cl(self):
        assert bottle_volume_to_ml("75 cl") == 750

    def test_cl_no_space(self):
        assert bottle_volume_to_ml("75cl") == 750

    def test_150cl(self):
        assert bottle_volume_to_ml("150 cl") == 1500


# --- Product ---


class TestProduct:
    def test_from_algolia_hit(self):
        hit = _load("algolia_listing_hit.json")["multi_offer"]
        p = Product.from_algolia_hit(hit)
        assert p.parent_sku == "20171135668"
        assert p.vintage == 2017
        assert p.region == "California"
        assert p.colour == "Red"
        assert p.producer == "Au Bon Climat"
        assert p.grape_varieties == ["Pinot Noir"]
        assert p.product_url is not None

    def test_from_sole_offer_hit(self):
        hit = _load("algolia_listing_hit.json")["sole_offer"]
        p = Product.from_algolia_hit(hit)
        assert p.parent_sku == "20158024224"

    def test_missing_vintage_is_none(self):
        p = Product.from_algolia_hit({"parent_sku": "X", "vintage": None})
        assert p.vintage is None

    def test_non_numeric_vintage_is_none(self):
        p = Product.from_algolia_hit({"parent_sku": "X", "vintage": "NV"})
        assert p.vintage is None


# --- Sku ---


class TestSku:
    def test_from_rest_entry(self):
        rest = _load("rest_pricing.json")
        entries = rest["20138117265"]
        s = Sku.from_rest_entry("20138117265", entries[1])
        assert s.parent_sku == "20138117265"
        assert s.format_code == "06-00750"
        assert s.case_size == 6
        assert s.bottle_volume_ml == 750
        assert s.least_listing_price_p == 29000
        assert s.market_price_p == 16800
        assert s.qty_available == 15

    def test_zero_price_is_none(self):
        rest = _load("rest_pricing.json")
        entries = rest["20158007342"]
        jero = next(e for e in entries if e["format"] == "01-03000")
        s = Sku.from_rest_entry("20158007342", jero)
        assert s.least_listing_price_p is None

    def test_all_seven_formats(self):
        rest = _load("rest_pricing.json")
        entries = rest["20158007342"]
        skus = [Sku.from_rest_entry("20158007342", e) for e in entries]
        assert len(skus) == 7
        assert len({s.format_code for s in skus}) == 7


# --- Offer ---


class TestOffer:
    def test_from_purchase_option(self):
        hit = _load("algolia_listing_hit.json")["multi_offer"]
        opt = hit["purchase_options"][0]
        o = Offer.from_purchase_option("20171135668", opt)
        assert o.bbx_listing_id == "133111"
        assert o.parent_sku == "20171135668"
        assert o.format_code == "06-00750"
        assert o.match_confidence == "inferred"
        assert o.case_size == 6
        assert o.bottle_volume_ml == 750
        assert o.price_per_case_p == 25000

    def test_unmatched_format(self):
        hit = _load("algolia_listing_hit.json")["multi_offer"]
        opt = hit["purchase_options"][0]
        o = Offer.from_purchase_option(
            "20171135668", opt, known_format_codes={"99-99999"}
        )
        assert o.format_code is None
        assert o.match_confidence == "unmatched"

    def test_matched_format(self):
        hit = _load("algolia_listing_hit.json")["multi_offer"]
        opt = hit["purchase_options"][0]
        o = Offer.from_purchase_option(
            "20171135668", opt, known_format_codes={"06-00750"}
        )
        assert o.format_code == "06-00750"
        assert o.match_confidence == "inferred"

    def test_deep_book_offers(self):
        deep = _load("algolia_deep_book.json")
        offers = [
            Offer.from_purchase_option("20158007342", o)
            for o in deep["purchase_options"]
        ]
        assert len(offers) == 30
        ids = {o.bbx_listing_id for o in offers}
        assert len(ids) == 30

    def test_all_offers_have_price(self):
        deep = _load("algolia_deep_book.json")
        for opt in deep["purchase_options"]:
            o = Offer.from_purchase_option("20158007342", opt)
            assert o.price_per_case_p is not None
            assert o.price_per_case_p > 0


# --- ObservationEvent ---


class TestObservationEvent:
    def test_defaults(self):
        e = ObservationEvent(
            scan_run_id="run-1",
            entity_type="product",
            entity_key="SKU123",
            event_type="appeared",
        )
        assert e.observed_at is not None
        assert e.field_name == ""
        assert e.metadata is None

    def test_price_change_event(self):
        e = ObservationEvent(
            scan_run_id="run-1",
            entity_type="sku",
            entity_key="SKU123|06-00750",
            event_type="price_changed",
            field_name="least_listing_price_p",
            old_value_raw="29000",
            new_value_raw="25000",
        )
        assert e.event_type == "price_changed"
        assert e.old_value_raw == "29000"
