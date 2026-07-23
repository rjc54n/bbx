import { describe, expect, it } from "vitest";
import { bbrProductUrl, wineSearcherUrl } from "./listingLinks";

describe("bbrProductUrl", () => {
  it("turns a stored BBX path into a BBR PDP URL", () => {
    expect(bbrProductUrl("/products-123-example")).toBe("https://www.bbr.com/products-123-example");
  });

  it("keeps an absolute BBR PDP URL and rejects another origin", () => {
    expect(bbrProductUrl("https://www.bbr.com/products-123-example")).toBe("https://www.bbr.com/products-123-example");
    expect(bbrProductUrl("https://example.com/products-123-example")).toBeUndefined();
  });
});

describe("wineSearcherUrl", () => {
  it("builds a name-only search when vintage is missing", () => {
    expect(wineSearcherUrl("Chateau Example", null)).toBe("https://www.wine-searcher.com/find/Chateau%20Example");
  });

  it("adds vintage and encodes search characters", () => {
    expect(wineSearcherUrl("Château Example & Co", 2016)).toBe("https://www.wine-searcher.com/find/Ch%C3%A2teau%20Example%20%26%20Co%202016");
  });

  it("does not create a search for a missing wine name", () => {
    expect(wineSearcherUrl(null, 2016)).toBeUndefined();
    expect(wineSearcherUrl("   ", 2016)).toBeUndefined();
  });
});
