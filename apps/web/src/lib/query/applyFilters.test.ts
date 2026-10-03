import { describe, expect, it } from "vitest";
import { applyFilters, buildSearchFilter, parseCatalogueSearch, type AppliedFilter } from "./applyFilters";

type Call = { method: string; args: unknown[] };

function makeBuilder() {
  const calls: Call[] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["in", "gte", "lte", "or", "eq"]) {
    builder[method] = (...args: unknown[]) => { calls.push({ method, args }); return builder; };
  }
  return { builder, calls };
}

describe("applyFilters", () => {
  it("translates each filter kind to the right PostgREST call", () => {
    const { builder, calls } = makeBuilder();
    const filters: AppliedFilter[] = [
      { kind: "range", field: "ask_vs_release_pct", min: -5, max: 10 },
      { kind: "enum", field: "region", value: ["Bordeaux", "Burgundy"] },
      { kind: "boolean", field: "is_listed", value: true },
      { kind: "text", field: "search", value: "Lafite" },
    ];
    applyFilters(builder, filters);
    expect(calls).toEqual([
      { method: "gte", args: ["ask_vs_release_pct", -5] },
      { method: "lte", args: ["ask_vs_release_pct", 10] },
      { method: "in", args: ["region", ["Bordeaux", "Burgundy"]] },
      { method: "eq", args: ["is_listed", true] },
      { method: "or", args: [buildSearchFilter("Lafite")] },
    ]);
  });

  it("keeps NULL rows alongside the bounds when includeNulls is set", () => {
    const { builder, calls } = makeBuilder();
    applyFilters(builder, [
      { kind: "range", field: "bid_vs_release_pct", min: -90, max: 10, includeNulls: true },
      { kind: "range", field: "lowest_ask_p", max: 30, includeNulls: true },
    ]);
    expect(calls).toEqual([
      { method: "or", args: ["and(bid_vs_release_pct.gte.-90,bid_vs_release_pct.lte.10),bid_vs_release_pct.is.null"] },
      { method: "or", args: ["lowest_ask_p.lte.30,lowest_ask_p.is.null"] },
    ]);
  });

  it("skips an empty enum and an open range", () => {
    const { builder, calls } = makeBuilder();
    applyFilters(builder, [
      { kind: "enum", field: "colour", value: [] },
      { kind: "range", field: "lowest_ask_p" },
    ]);
    expect(calls).toEqual([]);
  });

  it("returns the same builder it was given", () => {
    const { builder } = makeBuilder();
    expect(applyFilters(builder, [])).toBe(builder);
  });

  it("uses one standalone year as the vintage and searches the remaining wine text", () => {
    const { builder, calls } = makeBuilder();
    applyFilters(builder, [{ kind: "text", field: "search", value: "2020  Batailley" }]);
    expect(calls).toEqual([
      { method: "eq", args: ["vintage", "2020"] },
      { method: "or", args: [buildSearchFilter("Batailley")] },
    ]);
  });

  it("searches by vintage when the year is the whole query", () => {
    const { builder, calls } = makeBuilder();
    applyFilters(builder, [{ kind: "text", field: "search", value: "2020" }]);
    expect(calls).toEqual([{ method: "eq", args: ["vintage", "2020"] }]);
  });
});

describe("parseCatalogueSearch", () => {
  it("accepts the vintage at either end of the query", () => {
    expect(parseCatalogueSearch("Batailley 2020")).toEqual({ text: "Batailley", vintage: "2020" });
    expect(parseCatalogueSearch("2020 Batailley")).toEqual({ text: "Batailley", vintage: "2020" });
  });

  it("does not guess how to combine multiple years", () => {
    expect(parseCatalogueSearch("2019 2020 Batailley")).toEqual({ text: "2019 2020 Batailley" });
  });
});

describe("buildSearchFilter", () => {
  it("requires each word while allowing words to match in different columns", () => {
    expect(buildSearchFilter("lafarge bourgogne")).toBe(
      "and(or(name.ilike.%lafarge%,producer.ilike.%lafarge%),or(name.ilike.%bourgogne%,producer.ilike.%bourgogne%))",
    );
  });
});
