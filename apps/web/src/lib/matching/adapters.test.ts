import { describe, expect, it } from "vitest";
import {
  MATCH_ADAPTERS,
  MATCH_SOURCES,
  isMatchSource,
  matchGroupRpc,
  resolveMatchAdapter,
  safeMatchReturnPath,
} from "./adapters";

describe("match source allowlist", () => {
  it("accepts only the two known sources", () => {
    expect(isMatchSource("release_offer")).toBe(true);
    expect(isMatchSource("cellartracker")).toBe(true);
    expect(isMatchSource("bbr_holdings")).toBe(false);
    expect(isMatchSource("")).toBe(false);
    expect(isMatchSource("release_offer; drop table")).toBe(false);
  });

  it("resolveMatchAdapter throws on anything off the allowlist", () => {
    expect(() => resolveMatchAdapter("catalogue")).toThrow(/unknown match source/i);
    expect(resolveMatchAdapter("cellartracker")).toBe(MATCH_ADAPTERS.cellartracker);
  });
});

describe("group RPC dispatch", () => {
  it("maps every op to the source's own literal RPC, with manual reusing confirm", () => {
    expect(matchGroupRpc("release_offer", "confirm")).toBe("confirm_release_offer_match_group");
    expect(matchGroupRpc("release_offer", "manual")).toBe("confirm_release_offer_match_group");
    expect(matchGroupRpc("release_offer", "edit")).toBe("edit_release_offer_match_group");
    expect(matchGroupRpc("release_offer", "suppress")).toBe("suppress_release_offer_match_group");
    expect(matchGroupRpc("release_offer", "unlink")).toBe("unlink_release_offer_match_group");
    expect(matchGroupRpc("release_offer", "restore")).toBe("restore_release_offer_match_group");
    expect(matchGroupRpc("release_offer", "exclude")).toBe("exclude_release_offer_match_group");

    expect(matchGroupRpc("cellartracker", "confirm")).toBe("confirm_cellartracker_match_group");
    expect(matchGroupRpc("cellartracker", "manual")).toBe("confirm_cellartracker_match_group");
    expect(matchGroupRpc("cellartracker", "edit")).toBe("edit_cellartracker_match_group");
    expect(matchGroupRpc("cellartracker", "suppress")).toBe("suppress_cellartracker_match_group");
    expect(matchGroupRpc("cellartracker", "unlink")).toBe("unlink_cellartracker_match_group");
    expect(matchGroupRpc("cellartracker", "restore")).toBe("restore_cellartracker_match_group");
    expect(matchGroupRpc("cellartracker", "exclude")).toBe("exclude_cellartracker_match_group");
  });

  it("never crosses the two sources' RPC namespaces", () => {
    for (const source of MATCH_SOURCES) {
      const other = source === "release_offer" ? "cellartracker" : "release_offer";
      for (const rpc of Object.values(MATCH_ADAPTERS[source].groupRpc)) {
        expect(rpc).toContain(source);
        expect(rpc).not.toContain(other);
      }
    }
  });
});

describe("safeMatchReturnPath", () => {
  it("keeps a release-offer path on its own routes and rejects anything else", () => {
    expect(safeMatchReturnPath("release_offer", "/release-prices/matches?state=linked&page=2"))
      .toBe("/release-prices/matches?state=linked&page=2");
    expect(safeMatchReturnPath("release_offer", "/release-prices/offers/00000000-0000-0000-0000-000000000000/7"))
      .toBe("/release-prices/offers/00000000-0000-0000-0000-000000000000/7");
    expect(safeMatchReturnPath("release_offer", "/evil")).toBe("/release-prices/matches");
    expect(safeMatchReturnPath("release_offer", "https://example.com")).toBe("/release-prices/matches");
  });

  it("does not let a CellarTracker return path reach the offer-record route", () => {
    expect(safeMatchReturnPath("cellartracker", "/cellartracker/matches?state=all"))
      .toBe("/cellartracker/matches?state=all");
    expect(safeMatchReturnPath("cellartracker", "/release-prices/offers/00000000-0000-0000-0000-000000000000/7"))
      .toBe("/cellartracker/matches");
  });
});

describe("exclude prompt copy", () => {
  it("pluralises per source", () => {
    expect(MATCH_ADAPTERS.release_offer.excludePrompt(1)).toContain("1 historic offer record?");
    expect(MATCH_ADAPTERS.release_offer.excludePrompt(3)).toContain("3 historic offer records?");
    expect(MATCH_ADAPTERS.cellartracker.excludePrompt(1)).toContain("1 CellarTracker record?");
    expect(MATCH_ADAPTERS.cellartracker.excludePrompt(2)).toContain("2 CellarTracker records?");
  });
});
