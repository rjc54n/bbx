import { describe, expect, it } from "vitest";
import { formatBound, fromInputValue, toInputValue } from "./units";

describe("scenario unit boundary", () => {
  it("shows a money field in pounds and stores it in pence", () => {
    expect(toInputValue("lowest_ask_per_75cl_p", 3050)).toBe(30.5);
    expect(fromInputValue("lowest_ask_per_75cl_p", "30.50")).toBe(3050);
    expect(fromInputValue("lowest_ask_per_75cl_p", "")).toBeUndefined();
    expect(fromInputValue("lowest_ask_per_75cl_p", "  ")).toBeUndefined();
  });

  it("leaves a percent field and an unknown field untouched", () => {
    expect(toInputValue("ask_vs_release_pct", -12)).toBe(-12);
    expect(fromInputValue("ask_vs_release_pct", "-12")).toBe(-12);
    expect(fromInputValue("not_a_field", "7")).toBe(7);
  });

  it("round-trips a money value through display and back", () => {
    for (const pence of [0, 1, 999, 12345, 250000]) {
      expect(fromInputValue("release_price_per_75cl_p", String(toInputValue("release_price_per_75cl_p", pence)))).toBe(pence);
    }
  });

  it("formats a bound for the summary line by field type", () => {
    expect(formatBound("lowest_ask_per_75cl_p", 3050)).toBe("£30.50");
    expect(formatBound("ask_vs_release_pct", 10)).toBe("10%");
    expect(formatBound("vintage", 2015)).toBe("2015");
  });
});
