import { describe, expect, it } from "vitest";
import {
  bbrProductDetailUrl,
  bbrSearchUrl,
  bbrWineDestination,
  wineSearcherUrl,
} from "./listingLinks";

describe("bbrProductDetailUrl", () => {
  it("turns a matching stored BBX path into a BBR PDP URL", () => {
    expect(bbrProductDetailUrl("/products-12345-example", "12345"))
      .toBe("https://www.bbr.com/products-12345-example");
  });

  it("keeps an absolute matching BBR PDP URL", () => {
    expect(bbrProductDetailUrl("https://www.bbr.com/products-12345-example", "12345"))
      .toBe("https://www.bbr.com/products-12345-example");
  });

  it("rejects another origin, insecure URLs and non-product BBR pages", () => {
    expect(bbrProductDetailUrl("https://example.com/products-12345-example", "12345")).toBeUndefined();
    expect(bbrProductDetailUrl("http://www.bbr.com/products-12345-example", "12345")).toBeUndefined();
    expect(bbrProductDetailUrl("https://www.bbr.com/offers/current-en-primeur", "12345")).toBeUndefined();
  });

  it("rejects a PDP for a different Parent ID and malformed input", () => {
    expect(bbrProductDetailUrl("/products-99999-example", "12345")).toBeUndefined();
    expect(bbrProductDetailUrl("not a URL", "12345")).toBeUndefined();
    expect(bbrProductDetailUrl(null, "12345")).toBeUndefined();
    expect(bbrProductDetailUrl("/products-12345-example", "bad")).toBeUndefined();
  });
});

describe("bbrSearchUrl", () => {
  it("builds the public BBR search URL and adds a missing vintage", () => {
    expect(bbrSearchUrl("Château Example & Co", 2016))
      .toBe("https://www.bbr.com/?q=Ch%C3%A2teau%20Example%20%26%20Co%202016");
  });

  it("does not duplicate a vintage already in the wine name", () => {
    expect(bbrSearchUrl("2016 Château Example", 2016))
      .toBe("https://www.bbr.com/?q=2016%20Ch%C3%A2teau%20Example");
  });

  it("does not create a search without a wine name", () => {
    expect(bbrSearchUrl(null, 2016)).toBeUndefined();
    expect(bbrSearchUrl("   ", 2016)).toBeUndefined();
  });
});

describe("bbrWineDestination", () => {
  it("uses the first validated PDP in source priority order", () => {
    expect(bbrWineDestination({
      parentSku: "12345",
      name: "Example",
      vintage: 2016,
      productUrls: ["/offers/example", "/products-12345-example", "/products-12345-later"],
    })).toEqual({ url: "https://www.bbr.com/products-12345-example", kind: "product" });
  });

  it("falls back to a name and vintage search", () => {
    expect(bbrWineDestination({
      parentSku: "12345",
      name: "Example",
      vintage: 2016,
      productUrls: [null, "/products-99999-wrong"],
    })).toEqual({ url: "https://www.bbr.com/?q=Example%202016", kind: "search" });
  });

  it("falls back to Parent ID when the display name is missing", () => {
    expect(bbrWineDestination({
      parentSku: "12345",
      name: null,
      vintage: null,
      productUrls: [],
    })).toEqual({ url: "https://www.bbr.com/?q=12345", kind: "search" });
  });
});

describe("wineSearcherUrl", () => {
  it("builds a name-only search when vintage is missing", () => {
    expect(wineSearcherUrl("Chateau Example", null)).toBe("https://www.wine-searcher.com/find/Chateau%20Example");
  });

  it("adds vintage and encodes search characters", () => {
    expect(wineSearcherUrl("Château Example & Co", 2016)).toBe("https://www.wine-searcher.com/find/Ch%C3%A2teau%20Example%20%26%20Co%202016");
  });

  it("does not duplicate a vintage already in the name", () => {
    expect(wineSearcherUrl("2016 Château Example", 2016)).toBe("https://www.wine-searcher.com/find/2016%20Ch%C3%A2teau%20Example");
  });

  it("does not create a search for a missing wine name", () => {
    expect(wineSearcherUrl(null, 2016)).toBeUndefined();
    expect(wineSearcherUrl("   ", 2016)).toBeUndefined();
  });
});
