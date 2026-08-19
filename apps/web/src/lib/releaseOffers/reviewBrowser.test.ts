import { describe, expect, it } from "vitest";
import {
  ACCEPTED_OFFER_PAGE_SIZE,
  acceptedOfferPageCount,
  acceptedOfferPageForCount,
  acceptedOfferRange,
  buildAcceptedOfferSearchFilter,
  parseAcceptedOfferQuery,
} from "./reviewBrowser";

describe("accepted offer query", () => {
  it("defaults invalid pages and trims search text", () => {
    expect(parseAcceptedOfferQuery({ page: "0", q: "  Lafite  " })).toEqual({ page: 1, search: "Lafite" });
    expect(parseAcceptedOfferQuery({ page: ["3", "9"], q: ["Margaux", "ignored"] })).toEqual({ page: 3, search: "Margaux" });
  });

  it("calculates the first, final partial and out-of-range pages", () => {
    expect(acceptedOfferRange(1)).toEqual({ from: 0, to: ACCEPTED_OFFER_PAGE_SIZE - 1 });
    expect(acceptedOfferRange(36)).toEqual({ from: 3500, to: 3599 });
    expect(acceptedOfferPageCount(3545)).toBe(36);
    expect(acceptedOfferPageForCount(99, 3545)).toBe(36);
    expect(acceptedOfferPageForCount(4, 0)).toBe(1);
  });

  it("searches every supported accepted-offer field", () => {
    expect(buildAcceptedOfferSearchFilter("Lafite")).toBe(
      "source_wine.ilike.%Lafite%,source_product_id.ilike.%Lafite%,parent_sku.ilike.%Lafite%,source_price_text.ilike.%Lafite%",
    );
  });

  it("keeps special characters inside the search term", () => {
    expect(buildAcceptedOfferSearchFilter("Wine, Reserve (2015)")).toContain('source_wine.ilike."%Wine, Reserve (2015)%"');
  });
});
