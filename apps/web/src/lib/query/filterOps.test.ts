import { describe, expect, it } from "vitest";
import { getFilter, removeFilter, setFilter } from "./filterOps";
import type { CatalogueFilter } from "./types";

describe("setFilter", () => {
  it("inserts a filter for a field that isn't present yet", () => {
    const result = setFilter([], { field: "region", kind: "enum", value: ["Bordeaux"] });
    expect(result).toEqual([{ field: "region", kind: "enum", value: ["Bordeaux"] }]);
  });

  it("replaces the existing filter for the same field rather than appending a second one", () => {
    const existing: CatalogueFilter[] = [{ field: "vintage", kind: "enum", value: ["2000", "2010"] }];
    const result = setFilter(existing, { field: "vintage", kind: "enum", value: ["2015"] });
    expect(result).toEqual([{ field: "vintage", kind: "enum", value: ["2015"] }]);
  });

  it("leaves other fields' filters untouched", () => {
    const existing: CatalogueFilter[] = [{ field: "colour", kind: "enum", value: ["Red"] }];
    const result = setFilter(existing, { field: "region", kind: "enum", value: ["Bordeaux"] });
    expect(result).toHaveLength(2);
  });

  it("stores selected formats as one canonical format_code filter", () => {
    const result = setFilter(
      [],
      { field: "format_code", kind: "enum", value: ["12x1500", "6x750", "12x1500"] },
    );

    expect(result).toContainEqual({ field: "format_code", kind: "enum", value: ["12x1500", "6x750"] });
    expect(result).toHaveLength(1);
  });
});

describe("removeFilter", () => {
  it("removes only the named field", () => {
    const existing: CatalogueFilter[] = [
      { field: "colour", kind: "enum", value: ["Red"] },
      { field: "region", kind: "enum", value: ["Bordeaux"] },
    ];
    expect(removeFilter(existing, "colour")).toEqual([{ field: "region", kind: "enum", value: ["Bordeaux"] }]);
  });

  it("is a no-op when the field isn't present", () => {
    const existing: CatalogueFilter[] = [{ field: "colour", kind: "enum", value: ["Red"] }];
    expect(removeFilter(existing, "region")).toEqual(existing);
  });
});

describe("getFilter", () => {
  it("finds the filter for a field", () => {
    const existing: CatalogueFilter[] = [{ field: "vintage", kind: "enum", value: ["2015"] }];
    expect(getFilter(existing, "vintage")).toEqual({ field: "vintage", kind: "enum", value: ["2015"] });
  });

  it("returns undefined when absent", () => {
    expect(getFilter([], "vintage")).toBeUndefined();
  });
});
