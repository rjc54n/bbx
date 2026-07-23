import { describe, expect, it } from "vitest";
import { CATALOGUE_COLUMNS, FORMAT_ADJUSTED_COLUMN_IDS, withFormatAdjustedColumns } from "./columns";

describe("withFormatAdjustedColumns", () => {
  it("hides adjusted_guide_p and price_vs_adjusted_guide_pct by default", () => {
    const ids = withFormatAdjustedColumns(CATALOGUE_COLUMNS, false).map((c) => c.id);
    for (const hidden of FORMAT_ADJUSTED_COLUMN_IDS) {
      expect(ids).not.toContain(hidden);
    }
  });

  it("keeps every other column when hiding the format-adjusted ones", () => {
    const shown = withFormatAdjustedColumns(CATALOGUE_COLUMNS, false);
    const expected = CATALOGUE_COLUMNS.filter((c) => !FORMAT_ADJUSTED_COLUMN_IDS.has(c.id));
    expect(shown.map((c) => c.id)).toEqual(expected.map((c) => c.id));
  });

  it("returns every column, unfiltered, when shown", () => {
    const ids = withFormatAdjustedColumns(CATALOGUE_COLUMNS, true).map((c) => c.id);
    expect(ids).toEqual(CATALOGUE_COLUMNS.map((c) => c.id));
    for (const shown of FORMAT_ADJUSTED_COLUMN_IDS) {
      expect(ids).toContain(shown);
    }
  });
});
