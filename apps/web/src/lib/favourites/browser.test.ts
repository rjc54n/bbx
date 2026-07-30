import { describe, expect, it } from "vitest";
import {
  filterAndSortFavourites,
  heldBottles,
  isOrphan,
  parseFavouriteQuery,
  serializeFavouriteQuery,
  sourceChips,
  type FavouriteWineRow,
} from "./browser";

function row(overrides: Partial<FavouriteWineRow> = {}): FavouriteWineRow {
  return {
    parent_sku: "20100000001",
    favourited_at: "2026-07-29T10:00:00Z",
    wine_name: "Chateau Test",
    vintage: 2010,
    producer: "Test Producer",
    country: "France",
    region: "Bordeaux",
    subregion: null,
    colour: "Red",
    product_url: null,
    in_tracked_catalogue: true,
    format_count: 2,
    listed_format_count: 1,
    lowest_ask_per_bottle_p: 5_000,
    highest_bid_per_bottle_p: 4_000,
    guide_per_bottle_p: 4_500,
    adjusted_guide_per_bottle_p: 4_500,
    latest_release_offer_date: "2026-01-15",
    latest_release_price_per_bottle_p: 3_000,
    anchor_status: "provisional",
    ask_vs_release_pct: 66.7,
    bid_vs_release_pct: 33.3,
    cellartracker_bottles_home: 6,
    cellartracker_bottles_bbr: 0,
    cellartracker_paid_per_bottle_p: 2_900,
    cellartracker_record_count: 1,
    bbr_cellar_bottles: 0,
    bbr_cellar_holding_count: 0,
    release_offer_record_count: 1,
    ...overrides,
  };
}

describe("heldBottles", () => {
  it("adds home bottles to bottles at BBR", () => {
    expect(heldBottles(row({ cellartracker_bottles_home: 6, cellartracker_bottles_bbr: 6 }))).toBe(12);
  });

  it("does not double count bottles both sources report at BBR", () => {
    expect(heldBottles(row({
      cellartracker_bottles_home: 0,
      cellartracker_bottles_bbr: 12,
      bbr_cellar_bottles: 12,
    }))).toBe(12);
  });

  it("takes whichever source reports more when the two disagree", () => {
    expect(heldBottles(row({
      cellartracker_bottles_home: 0,
      cellartracker_bottles_bbr: 6,
      bbr_cellar_bottles: 12,
    }))).toBe(12);
  });

  it("treats a silent source as not disagreeing", () => {
    expect(heldBottles(row({
      cellartracker_bottles_home: 0,
      cellartracker_bottles_bbr: 0,
      bbr_cellar_bottles: 12,
    }))).toBe(12);
  });

  it("counts nothing when neither source holds any", () => {
    expect(heldBottles(row({
      cellartracker_bottles_home: 0,
      cellartracker_bottles_bbr: 0,
      bbr_cellar_bottles: 0,
    }))).toBe(0);
  });

  it("treats nulls as zero", () => {
    expect(heldBottles(row({
      cellartracker_bottles_home: null,
      cellartracker_bottles_bbr: null,
      bbr_cellar_bottles: null,
    }))).toBe(0);
  });
});

describe("parseFavouriteQuery", () => {
  it("defaults to most recently favourited first", () => {
    const query = parseFavouriteQuery(new URLSearchParams());
    expect(query.sort).toEqual({ field: "favourited_at", dir: "desc" });
  });

  it("ignores an unknown sort field", () => {
    const query = parseFavouriteQuery(new URLSearchParams("sort=drop_table:asc"));
    expect(query.sort.field).toBe("favourited_at");
  });

  it("ignores an unknown filter value", () => {
    expect(parseFavouriteQuery(new URLSearchParams("held=maybe")).held).toBe("");
    expect(parseFavouriteQuery(new URLSearchParams("listing=sideways")).listing).toBe("");
  });

  it("round-trips through serialize", () => {
    const params = new URLSearchParams("q=ducru&held=yes&ask=no&listing=listed&tracked=no&sort=wine:asc");
    expect(serializeFavouriteQuery(parseFavouriteQuery(params)).toString())
      .toBe(params.toString());
  });

  it("omits the default sort from the serialised query", () => {
    expect(serializeFavouriteQuery(parseFavouriteQuery(new URLSearchParams())).toString()).toBe("");
  });
});

describe("filterAndSortFavourites", () => {
  const query = parseFavouriteQuery(new URLSearchParams());

  it("searches wine, producer, region and Parent ID", () => {
    const rows = [row({ parent_sku: "1", wine_name: "Ducru" }), row({ parent_sku: "2", wine_name: "Other" })];
    expect(filterAndSortFavourites(rows, { ...query, search: "ducru" }).map((r) => r.parent_sku))
      .toEqual(["1"]);
    expect(filterAndSortFavourites(rows, { ...query, search: "bordeaux" })).toHaveLength(2);
  });

  it("filters to wines actually held", () => {
    const rows = [
      row({ parent_sku: "1", cellartracker_bottles_home: 6 }),
      row({ parent_sku: "2", cellartracker_bottles_home: 0, cellartracker_bottles_bbr: 0, bbr_cellar_bottles: 0 }),
    ];
    expect(filterAndSortFavourites(rows, { ...query, held: "yes" }).map((r) => r.parent_sku)).toEqual(["1"]);
    expect(filterAndSortFavourites(rows, { ...query, held: "no" }).map((r) => r.parent_sku)).toEqual(["2"]);
  });

  it("filters on whether an ask exists", () => {
    const rows = [
      row({ parent_sku: "1", lowest_ask_per_bottle_p: 5_000 }),
      row({ parent_sku: "2", lowest_ask_per_bottle_p: null }),
    ];
    expect(filterAndSortFavourites(rows, { ...query, ask: "yes" }).map((r) => r.parent_sku)).toEqual(["1"]);
    expect(filterAndSortFavourites(rows, { ...query, ask: "no" }).map((r) => r.parent_sku)).toEqual(["2"]);
  });

  it("filters wines missing from the tracked catalogue", () => {
    const rows = [
      row({ parent_sku: "1", in_tracked_catalogue: true }),
      row({ parent_sku: "2", in_tracked_catalogue: false }),
    ];
    expect(filterAndSortFavourites(rows, { ...query, tracked: "no" }).map((r) => r.parent_sku)).toEqual(["2"]);
  });

  it("sorts nulls last regardless of direction", () => {
    const rows = [
      row({ parent_sku: "1", lowest_ask_per_bottle_p: null }),
      row({ parent_sku: "2", lowest_ask_per_bottle_p: 5_000 }),
    ];
    const sort = { field: "lowest_ask_per_bottle_p", dir: "asc" } as const;
    expect(filterAndSortFavourites(rows, { ...query, sort }).map((r) => r.parent_sku)).toEqual(["2", "1"]);
    expect(filterAndSortFavourites(rows, { ...query, sort: { ...sort, dir: "desc" } })
      .map((r) => r.parent_sku)).toEqual(["2", "1"]);
  });

  // The tie-break runs before the direction flip, matching
  // filterAndSortReleasePrices: the order is deterministic either way, but it
  // follows the sort direction rather than always ascending by Parent ID.
  it("breaks ties on Parent ID, in the sort direction", () => {
    const tied = [
      row({ parent_sku: "20100000002", favourited_at: "2026-07-29T10:00:00Z" }),
      row({ parent_sku: "20100000001", favourited_at: "2026-07-29T10:00:00Z" }),
    ];
    expect(filterAndSortFavourites(tied, query).map((r) => r.parent_sku))
      .toEqual(["20100000002", "20100000001"]);
    expect(filterAndSortFavourites(tied, { ...query, sort: { field: "favourited_at", dir: "asc" } })
      .map((r) => r.parent_sku)).toEqual(["20100000001", "20100000002"]);
  });

  it("does not mutate the input array order", () => {
    const rows = [row({ parent_sku: "2" }), row({ parent_sku: "1" })];
    filterAndSortFavourites(rows, { ...query, sort: { field: "wine", dir: "asc" } });
    expect(rows.map((r) => r.parent_sku)).toEqual(["2", "1"]);
  });
});

describe("sourceChips", () => {
  it("lists every source holding a linked record", () => {
    expect(sourceChips(row({
      in_tracked_catalogue: true,
      release_offer_record_count: 2,
      cellartracker_record_count: 1,
      bbr_cellar_holding_count: 3,
    }))).toEqual(["Catalogue", "Release", "CellarTracker", "BBR cellar"]);
  });

  it("omits sources with no records", () => {
    expect(sourceChips(row({
      in_tracked_catalogue: false,
      release_offer_record_count: 0,
      cellartracker_record_count: 1,
      bbr_cellar_holding_count: 0,
    }))).toEqual(["CellarTracker"]);
  });
});

describe("isOrphan", () => {
  it("flags a favourite with no linked record anywhere", () => {
    expect(isOrphan(row({
      in_tracked_catalogue: false,
      release_offer_record_count: 0,
      cellartracker_record_count: 0,
      bbr_cellar_holding_count: 0,
    }))).toBe(true);
  });

  it("does not flag a wine still linked somewhere", () => {
    expect(isOrphan(row({ in_tracked_catalogue: false, cellartracker_record_count: 1 }))).toBe(false);
  });
});
