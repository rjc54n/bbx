import { describe, expect, it } from "vitest";
import { STARTING_POINTS } from "./startingPoints";
import type { CatalogueFilter, QueryState } from "./types";
import { parse, serialize } from "./url";

// Filters form a set (one per field), not a sequence -- order isn't part of
// the round-trip contract, so comparisons normalise it away.
function normalise(state: QueryState): unknown {
  if (state.mode === "price-changes") return state;
  return { ...state, filters: [...state.filters].sort((a, b) => a.field.localeCompare(b.field)) };
}

describe("serialize/parse round-trip", () => {
  it("round-trips every starting point unchanged", () => {
    for (const sp of STARTING_POINTS) {
      const back = parse(serialize(sp.initialState));
      expect(normalise(back)).toEqual(normalise(sp.initialState));
    }
  });

  it("round-trips a catalogue state with one filter of every kind", () => {
    const state: QueryState = {
      mode: "value-research",
      filters: [
        { field: "region", kind: "enum", value: ["Bordeaux", "Burgundy"] },
        { field: "vintage", kind: "range", min: 2015, max: 2020 },
        { field: "price_vs_market_pct", kind: "range", max: -10 },
        { field: "first_seen_at", kind: "date", min: "2026-01-01" },
        { field: "search", kind: "text", value: "Lafite" },
        { field: "producer", kind: "typeahead", value: "Domaine Leflaive" },
      ],
      sort: { field: "price_vs_market_pct", dir: "asc" },
      page: 3,
    };
    const back = parse(serialize(state));
    expect(normalise(back)).toEqual(normalise(state));
  });

  it("omits page from the URL at page 0 but still round-trips to 0", () => {
    const explore = STARTING_POINTS.find((sp) => sp.mode === "explore")!.initialState;
    const params = serialize(explore);
    expect(params.has("page")).toBe(false);
    expect(parse(params).page).toBe(0);
  });

  it("stamps a version on every serialized URL", () => {
    const explore = STARTING_POINTS.find((sp) => sp.mode === "explore")!.initialState;
    expect(serialize(explore).get("v")).toBe("1");
  });
});

describe("mode-aware defaults (parse is mode-first)", () => {
  it("falls back to explore for an unknown mode", () => {
    expect(parse(new URLSearchParams("mode=bogus")).mode).toBe("explore");
  });

  it("a bare price-changes URL with no sort param gets price-changes' own default sort, not a catalogue field", () => {
    const state = parse(new URLSearchParams("mode=price-changes"));
    expect(state.mode).toBe("price-changes");
    expect(state.sort).toEqual({ field: "observed_at", dir: "desc" });
  });

  it("rejects a catalogue sort field on a price-changes URL and falls back to observed_at", () => {
    const state = parse(new URLSearchParams("mode=price-changes&sort=last_seen_at:desc"));
    expect(state.sort.field).toBe("observed_at");
  });

  it("never lets catalogue filter params leak into price-changes state", () => {
    const state = parse(new URLSearchParams("mode=price-changes&region=Bordeaux&vintage_min=2015"));
    expect(state.filters).toEqual([]);
  });

  it("rejects a price-changes sort field on a catalogue URL and falls back to that mode's default", () => {
    const state = parse(new URLSearchParams("mode=explore&sort=observed_at:desc"));
    expect(state.mode).toBe("explore");
    expect(state.sort).toEqual({ field: "last_seen_at", dir: "desc" });
  });
});

describe("codec robustness", () => {
  it("drops invalid params instead of throwing", () => {
    expect(() =>
      parse(new URLSearchParams("mode=explore&vintage_min=notanumber&last_seen_at_min=notadate&bogus=xyz")),
    ).not.toThrow();
    const state = parse(new URLSearchParams("mode=explore&vintage_min=notanumber&last_seen_at_min=notadate"));
    expect(state.filters).toEqual([]);
  });

  it("swaps a reversed numeric range instead of dropping it", () => {
    const state = parse(new URLSearchParams("mode=explore&vintage_min=2020&vintage_max=2010"));
    const vintage = state.filters.find((f) => f.field === "vintage");
    expect(vintage).toMatchObject({ min: 2010, max: 2020 });
  });

  it("drops an invalid ISO date but keeps the valid bound", () => {
    const state = parse(new URLSearchParams("mode=explore&first_seen_at_min=2026-01-01&first_seen_at_max=notadate"));
    const filter = state.filters.find((f) => f.field === "first_seen_at");
    expect(filter).toMatchObject({ min: "2026-01-01" });
    expect((filter as { max?: string })?.max).toBeUndefined();
  });

  it("dedupes and sorts enum values deterministically regardless of input order", () => {
    const a: QueryState = {
      mode: "explore",
      filters: [{ field: "region", kind: "enum", value: ["Burgundy", "Bordeaux", "Burgundy"] }],
      sort: { field: "last_seen_at", dir: "desc" },
      page: 0,
    };
    const b: QueryState = {
      mode: "explore",
      filters: [{ field: "region", kind: "enum", value: ["Bordeaux", "Burgundy"] }],
      sort: { field: "last_seen_at", dir: "desc" },
      page: 0,
    };
    expect(serialize(a).toString()).toBe(serialize(b).toString());
  });

  it("keeps exactly one filter per field on serialize -- last entry wins, deterministically", () => {
    const filters: CatalogueFilter[] = [
      { field: "vintage", kind: "range", min: 2000, max: 2010 },
      { field: "vintage", kind: "range", min: 2015, max: 2020 },
    ];
    const state: QueryState = {
      mode: "explore",
      filters,
      sort: { field: "last_seen_at", dir: "desc" },
      page: 0,
    };
    const params = serialize(state);
    expect(params.get("vintage_min")).toBe("2015");
    expect(params.get("vintage_max")).toBe("2020");
  });
});
