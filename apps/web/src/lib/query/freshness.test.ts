import { describe, expect, it } from "vitest";
import { isListedDays, LISTED_DAY_OPTIONS, recentListedRange } from "./freshness";

describe("recentListedRange", () => {
  it("uses an inclusive UTC range for a shortcut", () => {
    expect(recentListedRange(30, new Date("2026-07-19T12:00:00.000Z"))).toEqual({
      min: "2026-06-19T12:00:00.000Z",
      max: "2026-07-19T12:00:00.000Z",
    });
  });
});

describe("listed day options", () => {
  it("accepts only the shortcut values exposed in the UI", () => {
    expect(LISTED_DAY_OPTIONS).toEqual([1, 3, 7, 14, 30, 90]);
    expect(isListedDays(14)).toBe(true);
    expect(isListedDays(2)).toBe(false);
  });
});
