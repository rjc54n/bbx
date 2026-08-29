import { describe, expect, it } from "vitest";
import { decodeScenarioPreview, encodeScenarioPreview, scenarioPreviewHref } from "./preview";
import type { ScenarioDefinition } from "./definition";

const definition: ScenarioDefinition = {
  filters: [
    { kind: "range", field: "ask_vs_release_pct", min: -10, max: 10 },
    { kind: "text", field: "search", value: "Château 100%" },
  ],
  sort: { field: "ask_vs_release_pct", dir: "asc" },
};

describe("scenario preview param", () => {
  it("round-trips a definition through encode/decode", () => {
    const decoded = decodeScenarioPreview(encodeScenarioPreview(definition));
    expect(decoded).toEqual(definition);
  });

  it("round-trips through a URLSearchParams transport (percent-safe values)", () => {
    const href = scenarioPreviewHref("/scenarios/x", definition);
    const raw = new URLSearchParams(href.split("?")[1]).get("preview");
    expect(decodeScenarioPreview(raw ?? undefined)).toEqual(definition);
  });

  it("returns null for absent, malformed, or filter-less input", () => {
    expect(decodeScenarioPreview(undefined)).toBeNull();
    expect(decodeScenarioPreview("not json")).toBeNull();
    expect(decodeScenarioPreview(JSON.stringify({ filters: [], sort: definition.sort }))).toBeNull();
    expect(decodeScenarioPreview(JSON.stringify({ filters: [{ field: "bogus" }] }))).toBeNull();
  });

  it("takes the first value when the param repeats", () => {
    expect(decodeScenarioPreview([encodeScenarioPreview(definition), "junk"])).toEqual(definition);
  });
});
