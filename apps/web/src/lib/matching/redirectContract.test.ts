import { describe, expect, it } from "vitest";
import { buildMatchesRedirect } from "./redirectContract";

describe("buildMatchesRedirect", () => {
  it("remaps the old candidates state and carries q + page (spec §8 acceptance 2)", () => {
    expect(buildMatchesRedirect("release_offer", { state: "candidates", q: "tinto", page: "3" }))
      .toBe("/matches?source=release_offer&state=with-suggestions&q=tinto&page=3");
  });

  it("remaps suppressed and defaults everything else", () => {
    expect(buildMatchesRedirect("cellartracker", { state: "suppressed" }))
      .toBe("/matches?source=cellartracker&state=no-suitable-match");
  });

  it("maps every known old state", () => {
    const map: Record<string, string> = {
      unresolved: "needs-review",
      candidates: "with-suggestions",
      linked: "linked",
      suppressed: "no-suitable-match",
      all: "all",
    };
    for (const [old, next] of Object.entries(map)) {
      expect(buildMatchesRedirect("release_offer", { state: old }))
        .toBe(`/matches?source=release_offer&state=${next}`);
    }
  });

  it("falls back to needs-review for an absent or unrecognised state", () => {
    expect(buildMatchesRedirect("release_offer", {}))
      .toBe("/matches?source=release_offer&state=needs-review");
    expect(buildMatchesRedirect("release_offer", { state: "bogus" }))
      .toBe("/matches?source=release_offer&state=needs-review");
  });

  it("ignores an inbound source and forces the route's own", () => {
    expect(buildMatchesRedirect("release_offer", { source: "cellartracker", state: "linked" }))
      .toBe("/matches?source=release_offer&state=linked");
  });

  it("drops unknown params", () => {
    expect(buildMatchesRedirect("cellartracker", { foo: "bar", state: "all" }))
      .toBe("/matches?source=cellartracker&state=all");
  });

  it("drops a non-positive-integer page but keeps a valid one", () => {
    expect(buildMatchesRedirect("release_offer", { state: "all", page: "0" }))
      .toBe("/matches?source=release_offer&state=all");
    expect(buildMatchesRedirect("release_offer", { state: "all", page: "-2" }))
      .toBe("/matches?source=release_offer&state=all");
    expect(buildMatchesRedirect("release_offer", { state: "all", page: "abc" }))
      .toBe("/matches?source=release_offer&state=all");
    expect(buildMatchesRedirect("release_offer", { state: "all", page: "12" }))
      .toBe("/matches?source=release_offer&state=all&page=12");
  });

  it("trims and caps an over-long q the same way the page does", () => {
    const long = "x".repeat(250);
    const result = buildMatchesRedirect("release_offer", { state: "all", q: `  ${long}  ` });
    expect(result).toBe(`/matches?source=release_offer&state=all&q=${"x".repeat(200)}`);
  });

  it("takes the first value when a param is repeated", () => {
    expect(buildMatchesRedirect("release_offer", { state: ["candidates", "linked"] }))
      .toBe("/matches?source=release_offer&state=with-suggestions");
  });
});
