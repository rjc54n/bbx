import { describe, expect, it } from "vitest";
import { filterAndSortReleasePrices, parseReleasePriceQuery, type ReleasePriceRow } from "./browser";

function row(overrides: Partial<ReleasePriceRow>): ReleasePriceRow {
  return {
    parent_sku: "10001", format_code: "06-00750", anchor_status: "provisional",
    release_offer_price_id: 1, offer_date: "2018-01-01", release_price_p: 10000,
    source_wine: "Source wine", source_product_url: null, name: "Wine A", vintage: 2016,
    region: "Bordeaux", colour: "Red", producer: "Producer", product_url: null,
    case_size: 6, bottle_volume_ml: 750, is_listed: true, lowest_ask_p: 9000,
    highest_bid_p: null, market_price_p: 9500, last_rest_checked_at: null,
    ask_vs_release_p: -1000, ask_vs_release_pct: -10, bid_vs_release_p: null,
    bid_vs_release_pct: null, seller_net_highest_bid_p: null, recoup_bid_p: 11200,
    seller_commission_rate: 0.1, ...overrides,
  };
}

describe("release-price browser", () => {
  it("round-trips supported URL filters and rejects invalid values", () => {
    const query = parseReleasePriceQuery(new URLSearchParams("q=wine&anchor=confirmed&listing=listed&bid=yes&below=yes&vintage_min=2010&sort=release_price_p:desc"));
    expect(query).toMatchObject({ search: "wine", anchor: "confirmed", listing: "listed", bid: "yes", below: "yes", vintageMin: 2010, sort: { field: "release_price_p", dir: "desc" } });
    expect(parseReleasePriceQuery(new URLSearchParams("anchor=wrong&sort=wrong:side"))).toMatchObject({ anchor: "", sort: { field: "wine", dir: "asc" } });
  });

  it("filters discount, bid and anchor state", () => {
    const rows = [row({ parent_sku: "1" }), row({ parent_sku: "2", anchor_status: "confirmed", highest_bid_p: 8000 }), row({ parent_sku: "3", lowest_ask_p: 12000 })];
    const query = parseReleasePriceQuery(new URLSearchParams("below=yes&bid=yes&anchor=confirmed"));
    expect(filterAndSortReleasePrices(rows, query).map((item) => item.parent_sku)).toEqual(["2"]);
  });

  it("sorts null market values after populated values", () => {
    const rows = [row({ parent_sku: "1", lowest_ask_p: null }), row({ parent_sku: "2", lowest_ask_p: 12000 }), row({ parent_sku: "3", lowest_ask_p: 9000 })];
    const query = parseReleasePriceQuery(new URLSearchParams("sort=lowest_ask_p:asc"));
    expect(filterAndSortReleasePrices(rows, query).map((item) => item.parent_sku)).toEqual(["3", "2", "1"]);
  });
});
