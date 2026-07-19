import { describe, expect, it } from "vitest";
import {
  discountFromMaximumPricePercentage,
  DISCOUNT_MAX,
  maximumPricePercentageForDiscount,
  normaliseDiscount,
} from "./priceRange";

describe("discount controls", () => {
  it("uses a 0 to 100 minimum-discount scale", () => {
    expect(DISCOUNT_MAX).toBe(100);
    expect(normaliseDiscount(-20)).toBe(0);
    expect(normaliseDiscount(120)).toBe(100);
  });

  it("converts a discount into the stored negative price comparison", () => {
    expect(maximumPricePercentageForDiscount(0)).toBeUndefined();
    expect(maximumPricePercentageForDiscount(15)).toBe(-15);
    expect(discountFromMaximumPricePercentage(-15)).toBe(15);
    expect(discountFromMaximumPricePercentage(undefined)).toBe(0);
  });
});
