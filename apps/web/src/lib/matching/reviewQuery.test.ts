import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEGACY_COVERAGE_TIER,
  parseMatchReviewQuery,
} from "./reviewQuery";

describe("parseMatchReviewQuery", () => {
  it("shows every legacy coverage tier when tier is absent", () => {
    const query = parseMatchReviewQuery({ state: "with-suggestions" });
    expect(query.tier).toBe("all");
    expect(query.tier).toBe(DEFAULT_LEGACY_COVERAGE_TIER);
    expect(query.review).toBe("all");
  });

  it("keeps explicit legacy coverage filters", () => {
    expect(parseMatchReviewQuery({ tier: "workable" }).tier).toBe("workable");
    expect(parseMatchReviewQuery({ tier: "low" }).tier).toBe("low");
  });

  it("falls back to all tiers for an invalid value", () => {
    expect(parseMatchReviewQuery({ tier: "hidden" }).tier).toBe("all");
    expect(parseMatchReviewQuery({ review: "hidden" }).review).toBe("all");
  });

  it("keeps an explicit review band in suggestion-bearing states", () => {
    expect(parseMatchReviewQuery({ review: "likely" }).review).toBe("likely");
    expect(parseMatchReviewQuery({ review: "legacy" }).review).toBe("legacy");
  });

  it("drops tier and candidate-only sort outside applicable states", () => {
    expect(parseMatchReviewQuery({
      state: "linked",
      sort: "coverage",
      tier: "low",
    })).toMatchObject({ sort: "queue", tier: "all", review: "all", tierApplies: false });
  });

  it("normalises source, search and page values", () => {
    expect(parseMatchReviewQuery({
      source: ["release_offer", "cellartracker"],
      q: "  Lynch-Bages  ",
      page: "0",
    })).toMatchObject({
      source: "release_offer",
      search: "Lynch-Bages",
      page: 1,
    });
  });
});
