export const DISCOUNT_MIN = 0;
export const DISCOUNT_MAX = 100;

export function normaliseDiscount(value: number): number {
  return Math.max(DISCOUNT_MIN, Math.min(DISCOUNT_MAX, value));
}

// Stored price comparison percentages use the opposite sign: a 15% discount
// is represented by a comparison of -15. `undefined` at zero keeps the
// default slider position unfiltered.
export function maximumPricePercentageForDiscount(discount: number): number | undefined {
  const normalised = normaliseDiscount(discount);
  return normalised === 0 ? undefined : -normalised;
}

export function discountFromMaximumPricePercentage(max: number | undefined): number {
  return max === undefined || max >= 0 ? 0 : normaliseDiscount(-max);
}
