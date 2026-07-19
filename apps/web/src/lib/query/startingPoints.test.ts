import { describe, expect, it } from "vitest";
import { STARTING_POINTS, startingPointFor } from "./startingPoints";

describe("starting points", () => {
  it("each entry's initialState.mode matches its own key", () => {
    for (const sp of STARTING_POINTS) {
      expect(sp.initialState.mode).toBe(sp.mode);
    }
  });

  it("value-research imposes no hard-coded discount threshold: zero default filters", () => {
    const vr = startingPointFor("value-research");
    expect(vr.initialState.filters).toEqual([]);
  });

  it("value-research surfaces all three price-reference controls as suggested, not applied", () => {
    const vr = startingPointFor("value-research");
    expect(vr.suggestedFilters.sort()).toEqual(
      ["price_vs_last_pct", "price_vs_market_pct", "price_vs_next_pct"].sort(),
    );
  });

  it("explore has no price constraints and no suggested filters", () => {
    const explore = startingPointFor("explore");
    expect(explore.initialState.filters).toEqual([]);
    expect(explore.suggestedFilters).toEqual([]);
  });

  it("recent-listings sorts by first_seen_at desc", () => {
    const rl = startingPointFor("recent-listings");
    expect(rl.initialState.sort).toEqual({ field: "first_seen_at", dir: "desc" });
  });

  it("price-changes reads recent_price_change_view's own sort field and has no catalogue filters", () => {
    const pc = startingPointFor("price-changes");
    expect(pc.initialState.mode).toBe("price-changes");
    expect(pc.initialState.sort).toEqual({ field: "observed_at", dir: "desc" });
    expect(pc.initialState.filters).toEqual([]);
  });

  it("falls back to the first starting point for an unrecognised mode", () => {
    // @ts-expect-error -- deliberately passing an invalid mode to exercise the runtime fallback
    expect(startingPointFor("bogus").mode).toBe(STARTING_POINTS[0].mode);
  });
});
