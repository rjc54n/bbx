import { describe, expect, it } from "vitest";
import { applyFilters, buildSearchOrFilter, type AppliedFilter } from "./applyFilters";

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
      { method: "or", args: [buildSearchOrFilter("Lafite")] },
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
});
