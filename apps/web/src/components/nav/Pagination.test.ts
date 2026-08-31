import { describe, expect, it } from "vitest";
import { clampPage, pageHref } from "./Pagination";

describe("pageHref", () => {
  it("sets the page param and preserves the rest", () => {
    expect(pageHref("/matches", { source: "release_offer", state: "needs-review", q: "tinto" }, 3))
      .toBe("/matches?source=release_offer&state=needs-review&q=tinto&page=3");
  });

  it("adds page when there is no other query", () => {
    expect(pageHref("/scenarios/abc", undefined, 2)).toBe("/scenarios/abc?page=2");
  });

  it("honours a custom page param name", () => {
    expect(pageHref("/x", {}, 5, "p")).toBe("/x?p=5");
  });
});

describe("clampPage", () => {
  it("clamps into [1, totalPages]", () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(99, 10)).toBe(10);
    expect(clampPage(4, 10)).toBe(4);
  });

  it("never returns below 1 even when there are no pages", () => {
    expect(clampPage(3, 0)).toBe(1);
  });

  it("falls back to 1 for NaN / non-finite input", () => {
    expect(clampPage(Number.NaN, 10)).toBe(1);
    expect(clampPage(Number.POSITIVE_INFINITY, 10)).toBe(1);
  });

  it("truncates fractional requests", () => {
    expect(clampPage(3.9, 10)).toBe(3);
  });
});
