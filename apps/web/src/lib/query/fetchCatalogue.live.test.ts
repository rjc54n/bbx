// Live end-to-end smoke test against the linked Supabase project (matches
// how Phase A was verified -- real data, not a mocked PostgREST client).
// Requires NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY, loaded
// from .env.local by vitest.config.ts. Network-dependent, so kept separate
// from the pure-logic unit tests.
import { describe, expect, it } from "vitest";
import { fetchFacetRanges, fetchFacetValues } from "./facets";
import { fetchCatalogue, fetchPriceChanges, PAGE_SIZE } from "./fetchCatalogue";
import { searchProducers } from "./producers";
import { startingPointFor } from "./startingPoints";
import { parse } from "./url";

describe("fetchCatalogue (live)", () => {
  it("explore: returns a page of rows and a total count with no filters applied", async () => {
    const { initialState } = startingPointFor("explore");
    const result = await fetchCatalogue(initialState);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.length).toBeLessThanOrEqual(PAGE_SIZE);
    expect(result.count).toBeGreaterThan(0);
  });

  it("value-research default sort (price_vs_market_pct asc) returns ascending values", async () => {
    const { initialState } = startingPointFor("value-research");
    const result = await fetchCatalogue(initialState);
    const values = result.rows
      .map((r) => r.price_vs_market_pct)
      .filter((v): v is number => v !== null);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });

  it("a range filter on price_vs_market_pct only returns rows within bounds, sign convention intact", async () => {
    const result = await fetchCatalogue({
      mode: "value-research",
      filters: [{ field: "price_vs_market_pct", kind: "range", max: -5 }],
      sort: { field: "price_vs_market_pct", dir: "asc" },
      page: 0,
    });
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.price_vs_market_pct).not.toBeNull();
      expect(row.price_vs_market_pct as number).toBeLessThanOrEqual(-5);
    }
  });

  it("an enum filter narrows to exactly that value", async () => {
    const facetValues = await fetchFacetValues();
    const colour = facetValues.colour?.[0]?.value;
    expect(colour).toBeTruthy();
    const result = await fetchCatalogue({
      mode: "explore",
      filters: [{ field: "colour", kind: "enum", value: [colour!] }],
      sort: { field: "last_seen_at", dir: "desc" },
      page: 0,
    });
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) expect(row.colour).toBe(colour);
  });

  it("is_listed has no default restriction -- a bare explore URL returns both listed and unlisted rows", async () => {
    // No default lives in url.ts parse() (see "is_listed defaults to the
    // whole biddable catalogue" in url.test.ts) -- go through parse() here,
    // the same path CatalogueBrowser actually uses on a fresh page load.
    const state = parse(new URLSearchParams("mode=explore"));
    expect(state.mode).not.toBe("price-changes");
    if (state.mode === "price-changes") return;
    expect(state.filters.some((f) => f.field === "is_listed")).toBe(false);
    const result = await fetchCatalogue(state);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.some((row) => row.is_listed === false)).toBe(true);
  });

  it("is_listed: true ('only listed wines') restricts to listed rows, a strict subset of unfiltered", async () => {
    const unfiltered = await fetchCatalogue({
      mode: "explore",
      filters: [],
      sort: { field: "last_seen_at", dir: "desc" },
      page: 0,
    });
    const filtered = await fetchCatalogue({
      mode: "explore",
      filters: [{ field: "is_listed", kind: "boolean", value: true }],
      sort: { field: "last_seen_at", dir: "desc" },
      page: 0,
    });
    expect(filtered.rows.length).toBeGreaterThan(0);
    for (const row of filtered.rows) expect(row.is_listed).toBe(true);
    expect(filtered.count).toBeLessThan(unfiltered.count);
  });

  it("the free-text search filter matches on name or producer", async () => {
    const result = await fetchCatalogue({
      mode: "explore",
      filters: [{ field: "search", kind: "text", value: "e" }],
      sort: { field: "last_seen_at", dir: "desc" },
      page: 0,
    });
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("pagination doesn't repeat rows across consecutive pages", async () => {
    const state = {
      mode: "explore" as const,
      filters: [],
      sort: { field: "last_seen_at" as const, dir: "desc" as const },
      page: 0,
    };
    const page0 = await fetchCatalogue(state);
    const page1 = await fetchCatalogue({ ...state, page: 1 });
    const page0Skus = new Set(page0.rows.map((r) => `${r.parent_sku}|${r.format_code}`));
    for (const row of page1.rows) {
      expect(page0Skus.has(`${row.parent_sku}|${row.format_code}`)).toBe(false);
    }
  });
});

describe("fetchPriceChanges (live)", () => {
  it("returns rows sorted by observed_at desc by default", async () => {
    const { initialState } = startingPointFor("price-changes");
    const result = await fetchPriceChanges(initialState);
    const observedAts = result.rows.map((r) => r.observed_at).filter((v): v is string => v !== null);
    for (let i = 1; i < observedAts.length; i++) {
      expect(new Date(observedAts[i]).getTime()).toBeLessThanOrEqual(new Date(observedAts[i - 1]).getTime());
    }
  });
});

describe("fetchFacetValues / fetchFacetRanges (live)", () => {
  it("facet values cover the enum fields with positive counts", async () => {
    const facets = await fetchFacetValues();
    expect(Object.keys(facets).length).toBeGreaterThan(0);
    for (const values of Object.values(facets)) {
      for (const { n } of values!) expect(n).toBeGreaterThan(0);
    }
  });

  it("facet ranges are internally consistent (min <= max)", async () => {
    const ranges = await fetchFacetRanges();
    for (const range of Object.values(ranges)) {
      if (range.min !== null && range.max !== null) {
        expect(range.min <= range.max).toBe(true);
      }
    }
  });
});

describe("searchProducers (live)", () => {
  it("returns an empty array for a blank query without hitting the network", async () => {
    expect(await searchProducers("   ")).toEqual([]);
  });

  it("finds a known producer by partial name", async () => {
    const results = await searchProducers("burg");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.n).toBeGreaterThan(0);
  });
});
