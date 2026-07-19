import { describe, expect, it } from "vitest";
import { CATALOGUE_FILTERS } from "./registry";
import { ENUM_FACET_FIELDS, groupFacetValues, shapeFacetRanges } from "./facets";

describe("ENUM_FACET_FIELDS", () => {
  it("matches exactly the enum-kind fields in CATALOGUE_FILTERS", () => {
    const expected = Object.values(CATALOGUE_FILTERS)
      .filter((m) => m.kind === "enum")
      .map((m) => m.field)
      .sort();
    expect([...ENUM_FACET_FIELDS].sort()).toEqual(expected);
  });
});

describe("groupFacetValues", () => {
  it("groups long-format rows by facet", () => {
    const grouped = groupFacetValues([
      { facet: "region", value: "Bordeaux", n: 120 },
      { facet: "region", value: "Burgundy", n: 80 },
      { facet: "colour", value: "Red", n: 500 },
    ]);
    expect(grouped.region).toEqual([
      { value: "Bordeaux", n: 120 },
      { value: "Burgundy", n: 80 },
    ]);
    expect(grouped.colour).toEqual([{ value: "Red", n: 500 }]);
  });

  it("omits a field entirely when no rows exist for it, rather than an empty array", () => {
    const grouped = groupFacetValues([{ facet: "region", value: "Bordeaux", n: 1 }]);
    expect(grouped.colour).toBeUndefined();
  });

  it("drops rows with a null facet, value or count", () => {
    const grouped = groupFacetValues([
      { facet: null, value: "x", n: 1 },
      { facet: "region", value: null, n: 1 },
      { facet: "region", value: "x", n: null },
    ]);
    expect(grouped).toEqual({});
  });

  it("drops rows whose facet isn't a known enum filter field (defends against SQL/registry drift)", () => {
    const grouped = groupFacetValues([{ facet: "not_a_real_facet", value: "x", n: 1 }]);
    expect(grouped).toEqual({});
  });
});

describe("shapeFacetRanges", () => {
  it("reshapes the flat _min/_max row into a nested range per field", () => {
    const ranges = shapeFacetRanges({
      vintage_min: 1990,
      vintage_max: 2024,
      ask_min: 500,
      ask_max: 500000,
      case_size_min: 1,
      case_size_max: 12,
      bottle_volume_ml_min: 375,
      bottle_volume_ml_max: 1500,
      first_seen_at_min: "2026-01-01T00:00:00Z",
      first_seen_at_max: "2026-07-19T00:00:00Z",
      last_seen_at_min: "2026-01-02T00:00:00Z",
      last_seen_at_max: "2026-07-19T00:00:00Z",
    });
    expect(ranges.vintage).toEqual({ min: 1990, max: 2024 });
    expect(ranges.ask).toEqual({ min: 500, max: 500000 });
  });
});
