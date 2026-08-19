import { describe, expect, it } from "vitest";
import {
  CELLARTRACKER_PAGE_SIZE,
  buildCellarTrackerRecordsSearchFilter,
  cellarTrackerRecordsPageCount,
  cellarTrackerRecordsPageForCount,
  cellarTrackerRecordsRange,
  parseCellarTrackerRecordsQuery,
} from "./recordsBrowser";

describe("cellartracker records query", () => {
  it("defaults invalid pages and trims search text", () => {
    expect(parseCellarTrackerRecordsQuery({ page: "0", q: "  Rousseau  " })).toEqual({ page: 1, search: "Rousseau" });
    expect(parseCellarTrackerRecordsQuery({ page: ["3", "9"], q: ["Roumier", "ignored"] })).toEqual({ page: 3, search: "Roumier" });
  });

  it("calculates the first, final partial and out-of-range pages", () => {
    expect(cellarTrackerRecordsRange(1)).toEqual({ from: 0, to: CELLARTRACKER_PAGE_SIZE - 1 });
    expect(cellarTrackerRecordsRange(7)).toEqual({ from: 600, to: 699 });
    expect(cellarTrackerRecordsPageCount(604)).toBe(7);
    expect(cellarTrackerRecordsPageForCount(99, 604)).toBe(7);
    expect(cellarTrackerRecordsPageForCount(4, 0)).toBe(1);
  });

  it("searches every supported cellar field", () => {
    expect(buildCellarTrackerRecordsSearchFilter("Rousseau")).toBe(
      "source_wine.ilike.%Rousseau%,producer.ilike.%Rousseau%,parent_sku.ilike.%Rousseau%,region.ilike.%Rousseau%",
    );
  });

  it("keeps special characters inside the search term", () => {
    expect(buildCellarTrackerRecordsSearchFilter("Clos (St. Jacques)")).toContain('source_wine.ilike."%Clos (St. Jacques)%"');
  });
});
