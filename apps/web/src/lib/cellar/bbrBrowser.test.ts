import { describe, expect, it } from "vitest";
import {
  askPremiumP,
  filterAndSortCellarRows,
  lowestAskLabel,
  parseCellarQuery,
  type BbrCellarRow,
} from "./bbrBrowser";

function row(overrides: Partial<BbrCellarRow> = {}): BbrCellarRow {
  return {
    bottle_volume_ml: 750,
    case_size: 6,
    catalogue_name: "Wine A",
    colour: "Red",
    confirmed_at: "2026-07-25T12:00:00Z",
    country: "France",
    current_status: "In bond",
    description: "Wine A source",
    drinking_window_from: 2025,
    drinking_window_to: 2035,
    eligible_for_bbx: true,
    format_code: "06-00750",
    highest_bid_p: 30000,
    import_id: "import-1",
    is_listed: true,
    last_rest_checked_at: "2026-07-25T13:00:00Z",
    lowest_ask_p: 40000,
    market_price_p: 35000,
    maturity: "Ready",
    parent_sku: "10001",
    producer: "Producer A",
    product_code: "code-1",
    product_url: "/wine-a",
    purchase_price_per_case_p: 25000,
    quantity_bottles: 6,
    region: "Bordeaux",
    source_row_number: 2,
    vintage: 2019,
    ...overrides,
  };
}

describe("parseCellarQuery", () => {
  it("uses stable defaults", () => {
    expect(parseCellarQuery(new URLSearchParams())).toMatchObject({
      search: "",
      eligibility: "any",
      listing: "any",
      bid: "any",
      sort: { field: "wine", dir: "asc" },
    });
  });

  it("parses filters and swaps reversed vintage bounds", () => {
    const query = parseCellarQuery(new URLSearchParams(
      "q=wine&region=Bordeaux&colour=Red&maturity=Ready"
      + "&vintage_min=2020&vintage_max=2010&eligibility=eligible"
      + "&listing=listed&bid=has-bid&sort=highest_bid_p:desc",
    ));

    expect(query).toEqual({
      search: "wine",
      region: "Bordeaux",
      colour: "Red",
      maturity: "Ready",
      vintageMin: 2010,
      vintageMax: 2020,
      eligibility: "eligible",
      listing: "listed",
      bid: "has-bid",
      sort: { field: "highest_bid_p", dir: "desc" },
    });
  });
});

describe("filterAndSortCellarRows", () => {
  const rows = [
    row(),
    row({
      catalogue_name: "Wine B",
      colour: "White",
      eligible_for_bbx: false,
      highest_bid_p: null,
      is_listed: false,
      maturity: "Young",
      parent_sku: "10002",
      producer: "Producer B",
      region: "Burgundy",
      vintage: 2021,
    }),
  ];

  it("searches source and catalogue identity fields", () => {
    const query = parseCellarQuery(new URLSearchParams("q=producer+a"));
    expect(filterAndSortCellarRows(rows, query)).toHaveLength(1);
  });

  it("combines facet and market-state filters", () => {
    const query = parseCellarQuery(
      new URLSearchParams(
        "region=Burgundy&colour=White&maturity=Young"
        + "&eligibility=not-eligible&listing=unlisted&bid=no-bid",
      ),
    );
    expect(filterAndSortCellarRows(rows, query).map((item) => item.parent_sku))
      .toEqual(["10002"]);
  });

  it("applies inclusive vintage bounds", () => {
    const query = parseCellarQuery(
      new URLSearchParams("vintage_min=2020&vintage_max=2022"),
    );
    expect(filterAndSortCellarRows(rows, query).map((item) => item.vintage))
      .toEqual([2021]);
  });

  it("sorts null market values last in either direction", () => {
    const query = parseCellarQuery(
      new URLSearchParams("sort=highest_bid_p:desc"),
    );
    expect(filterAndSortCellarRows(rows, query).map((item) => item.parent_sku))
      .toEqual(["10001", "10002"]);
  });
});

describe("lowestAskLabel", () => {
  it("distinguishes unlisted, unavailable price and absent market rows", () => {
    expect(lowestAskLabel(row({ is_listed: false, lowest_ask_p: null })))
      .toBe("Unlisted");
    expect(lowestAskLabel(row({ is_listed: true, lowest_ask_p: null })))
      .toBe("Price unavailable");
    expect(lowestAskLabel(row({ is_listed: null, lowest_ask_p: null })))
      .toBe("Market unavailable");
    expect(lowestAskLabel(row())).toBeNull();
  });
});

describe("askPremiumP", () => {
  it("is lowest ask minus purchase case price, negative when a discount", () => {
    expect(askPremiumP(row({ lowest_ask_p: 40000, purchase_price_per_case_p: 25000 })))
      .toBe(15000);
    expect(askPremiumP(row({ lowest_ask_p: 20000, purchase_price_per_case_p: 25000 })))
      .toBe(-5000);
  });

  it("is null when either side is unavailable", () => {
    expect(askPremiumP(row({ lowest_ask_p: null }))).toBeNull();
    expect(askPremiumP(row({ purchase_price_per_case_p: null }))).toBeNull();
  });
});
