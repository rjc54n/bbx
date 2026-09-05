import { describe, expect, it } from "vitest";
import {
  askPremiumP,
  currentBottlesLabel,
  currentTotals,
  filterAndSortCellarRows,
  hasNomination,
  lowestAskLabel,
  parseCellarQuery,
  reportedPriceLabel,
  type BbrCellarRow,
} from "./bbrBrowser";

function row(overrides: Partial<BbrCellarRow> = {}): BbrCellarRow {
  return {
    absent_by: null,
    bottle_volume_ml: 750,
    case_size: 6,
    catalogue_name: "Wine A",
    colour: "Red",
    country: "France",
    current_quantity_bottles: 6,
    current_status: "In bond",
    description: "Wine A source",
    drinking_window_from: 2025,
    drinking_window_to: 2035,
    eligible_for_bbx: true,
    first_seen: "2026-01-10",
    format_code: "06-00750",
    highest_bid_p: 30000,
    is_listed: true,
    last_rest_checked_at: "2026-07-25T13:00:00Z",
    last_seen: "2026-07-23",
    lowest_ask_p: 40000,
    latest_catalogue_matched: true,
    latest_import_id: "import-1",
    latest_observation_date: "2026-07-23",
    latest_purchase_price_per_case_p: 25000,
    latest_quantity_bottles: 6,
    latest_source_row_number: 2,
    market_price_p: 35000,
    maturity: "Ready",
    membership: "current",
    observation_count: 1,
    parent_sku: "10001",
    producer: "Producer A",
    product_code: "code-1",
    product_url: "/wine-a",
    region: "Bordeaux",
    reported_price_max_p: 25000,
    reported_price_min_p: 25000,
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
      holdings: "all",
      sort: { field: "wine", dir: "asc" },
    });
  });

  it("parses filters, the current-holdings flag and swaps reversed vintage bounds", () => {
    const query = parseCellarQuery(new URLSearchParams(
      "q=wine&region=Bordeaux&colour=Red&maturity=Ready"
      + "&vintage_min=2020&vintage_max=2010&eligibility=eligible"
      + "&listing=listed&bid=has-bid&holdings=current&sort=highest_bid_p:desc",
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
      holdings: "current",
      sort: { field: "highest_bid_p", dir: "desc" },
    });
  });

  it("only accepts holdings=current, never writing or reading holdings=all", () => {
    expect(parseCellarQuery(new URLSearchParams("holdings=all")).holdings).toBe("all");
    expect(parseCellarQuery(new URLSearchParams("holdings=nonsense")).holdings).toBe("all");
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

describe("the current-holdings filter", () => {
  const currentA = row({ parent_sku: "1", membership: "current", current_quantity_bottles: 6 });
  const formerB = row({
    parent_sku: "2",
    membership: "former",
    current_quantity_bottles: 0,
    catalogue_name: null,
    is_listed: null,
    highest_bid_p: null,
    lowest_ask_p: null,
    last_rest_checked_at: null,
    first_seen: "2019-03-01",
    last_seen: "2021-06-01",
  });
  const currentC = row({ parent_sku: "3", membership: "current", current_quantity_bottles: 12 });
  const all = [currentA, formerB, currentC];

  it("holdings=current returns exactly the nominated-snapshot positions", () => {
    const filtered = filterAndSortCellarRows(
      all,
      parseCellarQuery(new URLSearchParams("holdings=current")),
    );
    expect(filtered.map((r) => r.parent_sku).sort()).toEqual(["1", "3"]);
  });

  it("holdings absent returns current and former alike", () => {
    const filtered = filterAndSortCellarRows(
      all,
      parseCellarQuery(new URLSearchParams()),
    );
    expect(filtered).toHaveLength(3);
  });

  it("current totals count only current-membership rows and are unchanged by the current-only filter", () => {
    const unfiltered = currentTotals(
      filterAndSortCellarRows(all, parseCellarQuery(new URLSearchParams())),
    );
    const currentOnly = currentTotals(
      filterAndSortCellarRows(all, parseCellarQuery(new URLSearchParams("holdings=current"))),
    );
    expect(unfiltered).toEqual({ positions: 2, bottles: 18 });
    expect(currentOnly).toEqual({ positions: 2, bottles: 18 });
  });

  it("a facet filter narrows the current totals", () => {
    const rhone = row({
      parent_sku: "4",
      membership: "current",
      region: "Rhone",
      current_quantity_bottles: 3,
    });
    const unfiltered = currentTotals(
      filterAndSortCellarRows([currentA, currentC, rhone], parseCellarQuery(new URLSearchParams())),
    );
    const byRegion = currentTotals(
      filterAndSortCellarRows(
        [currentA, currentC, rhone],
        parseCellarQuery(new URLSearchParams("region=Rhone")),
      ),
    );
    expect(unfiltered).toEqual({ positions: 3, bottles: 21 });
    expect(byRegion).toEqual({ positions: 1, bottles: 3 });
  });

  it("sorts stably by the new fields across former rows with null market data", () => {
    for (const field of ["membership", "first_seen", "last_seen", "reported_price"]) {
      const asc = filterAndSortCellarRows(
        all,
        parseCellarQuery(new URLSearchParams(`sort=${field}:asc`)),
      ).map((r) => r.parent_sku);
      const desc = filterAndSortCellarRows(
        all,
        parseCellarQuery(new URLSearchParams(`sort=${field}:desc`)),
      ).map((r) => r.parent_sku);
      expect(asc).toHaveLength(3);
      expect(desc).toHaveLength(3);
      expect([...asc].sort()).toEqual(["1", "2", "3"]);
    }
  });
});

describe("hasNomination", () => {
  it("is false for an empty set and a set that is entirely unknown", () => {
    expect(hasNomination([])).toBe(false);
    expect(hasNomination([
      row({ membership: "unknown", current_quantity_bottles: null }),
      row({ membership: "unknown", current_quantity_bottles: null, parent_sku: "x" }),
    ])).toBe(false);
  });

  it("is true once any position is current or former", () => {
    expect(hasNomination([row({ membership: "former", current_quantity_bottles: 0 })])).toBe(true);
    expect(hasNomination([row({ membership: "current" })])).toBe(true);
  });
});

describe("currentBottlesLabel", () => {
  it("shows the number for current, zero for former and 'Not nominated' for unknown", () => {
    expect(currentBottlesLabel(row({ membership: "current", current_quantity_bottles: 6 }))).toBe("6");
    expect(currentBottlesLabel(row({ membership: "former", current_quantity_bottles: 0 }))).toBe("0");
    expect(currentBottlesLabel(row({ membership: "unknown", current_quantity_bottles: null })))
      .toBe("Not nominated");
  });
});

describe("reportedPriceLabel", () => {
  it("shows one value when min equals max", () => {
    expect(reportedPriceLabel(row({ reported_price_min_p: 45000, reported_price_max_p: 45000 })))
      .toBe("£450.00");
  });

  it("shows a range when the observed values differ", () => {
    expect(reportedPriceLabel(row({ reported_price_min_p: 40000, reported_price_max_p: 52000 })))
      .toBe("£400.00–£520.00");
  });

  it("shows a dash when nothing was ever reported", () => {
    expect(reportedPriceLabel(row({ reported_price_min_p: null, reported_price_max_p: null })))
      .toBe("–");
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
  it("is lowest ask minus the latest reported case price, negative when a discount", () => {
    expect(askPremiumP(row({ lowest_ask_p: 40000, latest_purchase_price_per_case_p: 25000 })))
      .toBe(15000);
    expect(askPremiumP(row({ lowest_ask_p: 20000, latest_purchase_price_per_case_p: 25000 })))
      .toBe(-5000);
  });

  it("is null when either side is unavailable", () => {
    expect(askPremiumP(row({ lowest_ask_p: null }))).toBeNull();
    expect(askPremiumP(row({ latest_purchase_price_per_case_p: null }))).toBeNull();
  });
});
