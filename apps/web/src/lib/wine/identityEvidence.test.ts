import { describe, expect, it } from "vitest";
import { canonicaliseWineIdentity, wineIdentityQueryVariants } from "./identityCanonicaliser";
import { compareWineIdentity, hasSecondWineConflict } from "./identityEvidence";
import { rankIdentityCandidates } from "./identityRanking";

describe("canonicaliseWineIdentity", () => {
  it("expands approved whole-token wine-name aliases", () => {
    expect(canonicaliseWineIdentity("2017 Ch. Lynch-Bages", "wine_name", "release_offer"))
      .toMatchObject({
        tokens: ["bages", "chateau", "lynch"],
        transformations: ["alias:ch:chateau"],
      });
    expect(canonicaliseWineIdentity("Dom. Leflaive", "wine_name", "release_offer").tokens)
      .toEqual(["domaine", "leflaive"]);
  });

  it("does not expand aliases inside a word or an unapproved field", () => {
    expect(canonicaliseWineIdentity("Churchill", "wine_name", "release_offer").tokens)
      .toEqual(["churchill"]);
    expect(canonicaliseWineIdentity("Ch", "producer", "release_offer").tokens)
      .toEqual(["ch"]);
  });

  it("creates at most one additional retrieval query", () => {
    expect(wineIdentityQueryVariants("2017 Ch. Lynch-Bages", "wine_name", "release_offer"))
      .toEqual(["2017 Ch. Lynch-Bages", "2017 chateau lynch bages"]);
    expect(wineIdentityQueryVariants("2017 Chateau Lynch-Bages", "wine_name", "release_offer"))
      .toEqual(["2017 Chateau Lynch-Bages"]);
  });
});

describe("identity evidence", () => {
  it("classifies the Lynch-Bages abbreviation match as likely", () => {
    const evidence = compareWineIdentity({
      source: "release_offer",
      field: "wine_name",
      sourceText: "2017 Ch. Lynch-Bages",
      candidateText: "2017 Chateau Lynch-Bages",
      sourceVintage: 2017,
      candidateVintage: 2017,
    });
    expect(evidence).toMatchObject({
      evidenceScore: 1,
      reviewBand: "likely",
      canonicalExact: true,
      riskFlags: [],
    });
    expect(evidence.reasons).toContain("approved_alias_normalised");
  });

  it("keeps a known vintage disagreement weak", () => {
    const evidence = compareWineIdentity({
      source: "release_offer",
      field: "wine_name",
      sourceText: "2017 Chateau Lynch-Bages",
      candidateText: "2016 Chateau Lynch-Bages",
      sourceVintage: 2017,
      candidateVintage: 2016,
    });
    expect(evidence.reviewBand).toBe("weak");
    expect(evidence.riskFlags).toContain("vintage_disagreement");
  });

  it("detects second-wine disagreement symmetrically", () => {
    expect(hasSecondWineConflict("Chateau Margaux", "Pavillon Blanc du Chateau Margaux")).toBe(true);
    expect(hasSecondWineConflict("Pavillon Blanc du Chateau Margaux", "Chateau Margaux")).toBe(true);
    expect(hasSecondWineConflict("Petit Mouton", "Le Petit Mouton de Mouton Rothschild")).toBe(false);
  });

  it("does not treat one-way token containment as exact", () => {
    const evidence = compareWineIdentity({
      source: "release_offer",
      field: "wine_name",
      sourceText: "Chateau Margaux",
      candidateText: "Pavillon Blanc du Chateau Margaux",
      sourceVintage: 2025,
      candidateVintage: 2025,
    });
    expect(evidence.canonicalExact).toBe(false);
    expect(evidence.reviewBand).toBe("ambiguous");
    expect(evidence.riskFlags).toContain("second_wine_conflict");
  });

  it("uses a small top-two margin to force manual ambiguity", () => {
    const ranked = rankIdentityCandidates([
      {
        id: "1",
        originalRank: 1,
        value: "first",
        input: {
          source: "release_offer",
          field: "wine_name",
          sourceText: "Chateau Example",
          candidateText: "Chateau Example",
          sourceVintage: 2020,
          candidateVintage: 2020,
        },
      },
      {
        id: "2",
        originalRank: 2,
        value: "second",
        input: {
          source: "release_offer",
          field: "wine_name",
          sourceText: "Chateau Example",
          candidateText: "Chateau Example",
          sourceVintage: 2020,
          candidateVintage: 2020,
        },
      },
    ]);
    expect(ranked[0].evidence.reviewBand).toBe("ambiguous");
    expect(ranked[0].evidence.riskFlags).toContain("small_score_margin");
  });
});
