import { describe, expect, it } from "vitest";
import { SCENARIO_PAGE_SIZE, scenarioPreview, scenarioPreviewRange } from "./browser";

describe("scenario preview paging", () => {
  it("requests one extra row and exposes next-page state without a total", () => {
    expect(scenarioPreviewRange(2)).toEqual({ from: SCENARIO_PAGE_SIZE, to: SCENARIO_PAGE_SIZE * 2 });
    const preview = scenarioPreview(Array.from({ length: SCENARIO_PAGE_SIZE + 1 }, (_, index) => index));
    expect(preview.rows).toHaveLength(SCENARIO_PAGE_SIZE);
    expect(preview.hasNext).toBe(true);
  });

  it("does not invent a next page for an empty scenario", () => {
    expect(scenarioPreview([])).toEqual({ rows: [], hasNext: false });
  });
});
