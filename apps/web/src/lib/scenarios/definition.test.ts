import { describe, expect, it } from "vitest";
import { parseScenarioDefinition } from "./definition";

describe("parseScenarioDefinition", () => {
  it("keeps a valid range filter and defaults the sort", () => {
    const parsed = parseScenarioDefinition({
      filters: [{ field: "ask_vs_release_pct", kind: "range", max: 10 }],
    });
    expect(parsed.filters).toEqual([{ kind: "range", field: "ask_vs_release_pct", min: undefined, max: 10 }]);
    expect(parsed.sort).toEqual({ field: "ask_vs_release_pct", dir: "asc" });
  });

  it("keeps includeNulls on a range only when it is exactly true", () => {
    expect(parseScenarioDefinition({
      filters: [{ field: "bid_vs_release_pct", kind: "range", min: -90, max: 10, includeNulls: true }],
    }).filters).toEqual([{ kind: "range", field: "bid_vs_release_pct", min: -90, max: 10, includeNulls: true }]);
    expect(parseScenarioDefinition({
      filters: [{ field: "bid_vs_release_pct", kind: "range", max: 10, includeNulls: "yes" }],
    }).filters).toEqual([{ kind: "range", field: "bid_vs_release_pct", min: undefined, max: 10 }]);
  });

  it("accepts is_biddable as a boolean filter", () => {
    expect(parseScenarioDefinition({ filters: [{ field: "is_biddable", kind: "boolean", value: true }] }).filters)
      .toEqual([{ kind: "boolean", field: "is_biddable", value: true }]);
  });

  it("takes the operator from the registry, not the input", () => {
    // Field is an enum in the registry; a claimed range kind is ignored.
    const parsed = parseScenarioDefinition({ filters: [{ field: "colour", kind: "range", value: ["Red", "White"] }] });
    expect(parsed.filters).toEqual([{ kind: "enum", field: "colour", value: ["Red", "White"] }]);
  });

  it("restricts anchor_status to the known statuses and drops empties", () => {
    const parsed = parseScenarioDefinition({
      filters: [{ field: "anchor_status", kind: "enum", value: ["owner", "bogus"] }],
    });
    expect(parsed.filters).toEqual([{ kind: "enum", field: "anchor_status", value: ["owner"] }]);
  });

  it("drops unknown fields, empty filters and a range with no bound", () => {
    const parsed = parseScenarioDefinition({
      filters: [
        { field: "definitely_not_a_field", kind: "range", min: 1 },
        { field: "ask_vs_release_pct", kind: "range" },
        { field: "region", kind: "enum", value: [] },
        { field: "search", kind: "text", value: "   " },
      ],
    });
    expect(parsed.filters).toEqual([]);
  });

  it("normalises sort and rejects an out-of-registry sort field", () => {
    expect(parseScenarioDefinition({ sort: { field: "lowest_ask_p", dir: "desc" } }).sort)
      .toEqual({ field: "lowest_ask_p", dir: "desc" });
    expect(parseScenarioDefinition({ sort: { field: "hacker", dir: "sideways" } }).sort)
      .toEqual({ field: "ask_vs_release_pct", dir: "asc" });
  });

  it("survives entirely malformed input", () => {
    expect(parseScenarioDefinition(null)).toEqual({ filters: [], sort: { field: "ask_vs_release_pct", dir: "asc" } });
    expect(parseScenarioDefinition("nope")).toEqual({ filters: [], sort: { field: "ask_vs_release_pct", dir: "asc" } });
  });
});
