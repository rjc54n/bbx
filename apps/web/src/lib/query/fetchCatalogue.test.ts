import { describe, expect, it } from "vitest";
import { PAGE_SIZE, buildSearchOrFilter, paginationRange } from "./fetchCatalogue";

describe("buildSearchOrFilter", () => {
  it("builds an ilike-across-name-and-producer clause", () => {
    expect(buildSearchOrFilter("Lafite")).toBe("name.ilike.%Lafite%,producer.ilike.%Lafite%");
  });

  it("quote-wraps a term containing a comma so it can't split into an extra OR condition", () => {
    const clause = buildSearchOrFilter("Smith, John");
    expect(clause).toBe('name.ilike."%Smith, John%",producer.ilike."%Smith, John%"');
    // The comma inside the quoted value must not be interpretable as a
    // top-level separator between OR conditions.
    expect(clause.split(",").filter((part) => !part.includes('"')).length).toBe(0);
  });

  it("quote-wraps a term containing parentheses so it can't inject filter grouping", () => {
    const clause = buildSearchOrFilter("Ch. Foo (Reserve)");
    expect(clause).toContain('"%Ch. Foo (Reserve)%"');
  });

  it("leaves an ordinary term unquoted", () => {
    expect(buildSearchOrFilter("Bordeaux")).not.toContain('"');
  });
});

describe("paginationRange", () => {
  it("computes a zero-indexed inclusive range for page 0", () => {
    expect(paginationRange(0)).toEqual({ from: 0, to: PAGE_SIZE - 1 });
  });

  it("computes the range for a later page with no gap or overlap", () => {
    const page1 = paginationRange(1);
    const page2 = paginationRange(2);
    expect(page1).toEqual({ from: PAGE_SIZE, to: PAGE_SIZE * 2 - 1 });
    expect(page2.from).toBe(page1.to + 1);
  });

  it("respects a custom page size", () => {
    expect(paginationRange(2, 10)).toEqual({ from: 20, to: 29 });
  });
});
