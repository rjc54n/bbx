import { describe, expect, it } from "vitest";
import { CATALOGUE_SELECT, PAGE_SIZE, buildSearchFilter, buildSearchOrFilter, mergeReferencePrices, pageWithNext, paginationRange } from "./fetchCatalogue";

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

describe("buildSearchFilter", () => {
  it("combines several terms so they can match between wine name and producer", () => {
    expect(buildSearchFilter("lafarge bourgogne")).toContain("and(or(name.ilike.%lafarge%");
    expect(buildSearchFilter("lafarge bourgogne")).toContain("or(name.ilike.%bourgogne%");
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

describe("pageWithNext", () => {
  it("keeps exactly one page and reports a next page only when the extra row exists", () => {
    const exactPage = Array.from({ length: PAGE_SIZE }, (_, index) => index);
    expect(pageWithNext(exactPage)).toEqual({ rows: exactPage, hasNext: false });
    expect(pageWithNext([...exactPage, PAGE_SIZE])).toEqual({ rows: exactPage, hasNext: true });
  });
});

describe("mergeReferencePrices", () => {
  it("scales a per-bottle reference to a 75cl catalogue case", () => {
    const rows = [{ parent_sku: "12345678901", format_code: "06-00750", case_size: 6, bottle_volume_ml: 750, name: "Test wine" }];
    const merged = mergeReferencePrices(rows as never, [{
      parent_sku: "12345678901", price_per_75cl_p: 12500, resolution_kind: "automatic", source_kind: "bbr", reference_date: "2020-01-01", date_meaning: "BBR snapshot observation date", needs_review: false, has_competing_evidence: false,
    }]);
    expect(merged[0].reference_price_p).toBe(75000);
    expect(merged[0].reference_source).toBe("bbr");
  });

  it("uses the same reference for another 75cl case size", () => {
    const rows = [{ parent_sku: "12345678901", format_code: "12-00750", case_size: 12, bottle_volume_ml: 750, name: "Test wine" }];
    const merged = mergeReferencePrices(rows as never, [{
      parent_sku: "12345678901", price_per_75cl_p: 12500, resolution_kind: "automatic", source_kind: "bbr", reference_date: null, date_meaning: "BBR snapshot observation date", needs_review: false, has_competing_evidence: false,
    }]);
    expect(merged[0].reference_price_p).toBe(150000);
  });

  it("does not apply a 75cl reference to another bottle volume", () => {
    const rows = [{ parent_sku: "12345678901", format_code: "01-01500", case_size: 1, bottle_volume_ml: 1500, name: "Test wine" }];
    const merged = mergeReferencePrices(rows as never, [{
      parent_sku: "12345678901", price_per_75cl_p: 9900, resolution_kind: "owner", source_kind: "owner", reference_date: null, date_meaning: "Owner-entered reference date", needs_review: false, has_competing_evidence: false,
    }]);
    expect(merged[0].reference_price_p).toBeNull();
  });
});

describe("CATALOGUE_SELECT", () => {
  it("lists explicit columns and leaves out last_rest_checked_at, so Postgres can drop the join", () => {
    const columns = CATALOGUE_SELECT.split(",");
    expect(columns).not.toContain("*");
    expect(columns).not.toContain("last_rest_checked_at");
    expect(columns).toContain("market_price_p");
    expect(new Set(columns).size).toBe(columns.length);
  });
});
