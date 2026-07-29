import { describe, expect, it } from "vitest";
import { exactParentSkus, topHistoricOfferCandidates } from "./algoliaMatching";
import fixtures from "./fixtures/algoliaHistoricOfferResults.json";

const group = {
  match_group_key: "2018|test wine",
  source_match_key: "test wine",
  source_vintage: 2018,
  source_wine: "2018 Test Wine",
};

describe("historic-offer Algolia matching", () => {
  it("recognises one exact normalised name and vintage", () => {
    expect(exactParentSkus(group, [
      { parent_sku: "20180000001", name: "2018 Test Wine", vintage: 2018 },
      { parent_sku: "20170000001", name: "2017 Test Wine", vintage: 2017 },
    ])).toEqual(["20180000001"]);
  });

  it("keeps ambiguous exact Parent IDs separate", () => {
    expect(exactParentSkus(group, [
      { parent_sku: "20180000001", name: "2018 Test Wine", vintage: 2018 },
      { parent_sku: "20180000002", name: "Test Wine 2018", vintage: 2018 },
    ])).toEqual(["20180000001", "20180000002"]);
  });

  it("recognises an exact name when only the candidate's trailing country label differs", () => {
    expect(exactParentSkus({
      match_group_key: "2021|tignanello antinori tuscany",
      source_match_key: "tignanello antinori tuscany",
      source_vintage: 2021,
      source_wine: "2021 Tignanello, Antinori, Tuscany",
    }, [{
      parent_sku: "20218007313",
      name: "2021 Tignanello, Antinori, Tuscany, Italy",
      vintage: 2021,
      country: "Italy",
    }])).toEqual(["20218007313"]);
  });

  /**
   * BBR's geographic tail runs more than one segment deep on roughly a third of
   * the catalogue, so a source name that stops earlier has to compare equal.
   */
  it("recognises an exact name when the candidate repeats a region the source omits", () => {
    expect(exactParentSkus({
      match_group_key: "2021|tignanello antinori",
      source_match_key: "tignanello antinori",
      source_vintage: 2021,
      source_wine: "2021 Tignanello, Antinori",
    }, [{
      parent_sku: "20218007313",
      name: "2021 Tignanello, Antinori, Tuscany, Italy",
      vintage: 2021,
      country: "Italy",
      region: "Tuscany",
    }])).toEqual(["20218007313"]);
  });

  it("does not ignore a country word which is not the candidate's own country", () => {
    expect(exactParentSkus(group, [{
      parent_sku: "20180000001",
      name: "2018 Test Wine, Italy",
      vintage: 2018,
      country: "France",
    }])).toEqual([]);
  });

  /**
   * Stripping stops at the first segment carrying identity, so a geographic
   * segment sitting mid-name is never removed. "Côtes de Provence" separates
   * cuvees here even though the candidate declares it as its own subregion.
   */
  it("stops stripping at the first segment that carries identity", () => {
    expect(exactParentSkus({
      match_group_key: "2025|chateau galoupet rose",
      source_match_key: "chateau galoupet rose",
      source_vintage: 2025,
      source_wine: "2025 Château Galoupet, Rosé",
    }, [{
      parent_sku: "20258007952",
      name: "2025 Château Galoupet, Côtes de Provence, Rosé",
      vintage: 2025,
      country: "France",
      region: "Provence",
      subregion: "Côtes de Provence",
    }])).toEqual([]);
  });

  it("never treats a missing-vintage group as exact", () => {
    expect(exactParentSkus({ ...group, source_vintage: null }, [
      { parent_sku: "20180000001", name: "2018 Test Wine", vintage: 2018 },
    ])).toEqual([]);
  });

  it("records display evidence and the identity score", () => {
    expect(topHistoricOfferCandidates([
      { ...fixtures.offBiddableExact, _rankingInfo: { nbTypos: 1 }, _highlightResult: { name: { matchedWords: ["txakoli", "rezabal"] } } },
      { parent_sku: "bad", name: "Invalid" },
    ], fixtures.offBiddableExact.name)).toEqual([expect.objectContaining({
      rank: 1,
      parent_sku: "20258330552",
      stock_origin: "BBR",
      purchase_mode: "Delivery",
      typo_count: 1,
      matched_words: ["txakoli", "rezabal"],
      match_score: 1,
    })]);
  });

  /**
   * Algolia ranks the wrong Leflaive first here. Ranking by how much of the
   * source identity each candidate accounts for promotes the right one.
   */
  it("ranks by identity overlap rather than Algolia order", () => {
    const ranked = topHistoricOfferCandidates([
      {
        parent_sku: "20188016151",
        name: "2018 Puligny-Montrachet, Les Pucelles, 1er Cru, Olivier Leflaive, Burgundy",
        vintage: 2018,
        producer: "Olivier Leflaive",
        country: "France",
        region: "Burgundy",
        subregion: "Côte de Beaune",
      },
      {
        parent_sku: "20181073515",
        name: "2018 Puligny-Montrachet, Les Pucelles, 1er Cru, Domaine Leflaive, Burgundy",
        vintage: 2018,
        producer: "Domaine Leflaive",
        country: "France",
        region: "Burgundy",
        subregion: "Côte de Beaune",
      },
    ], "2018 Puligny-Montrachet, Les Pucelles, 1er Cru, Domaine Leflaive, Burgundy");
    expect(ranked.map((candidate) => candidate.parent_sku)).toEqual(["20181073515", "20188016151"]);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].match_score).toBeGreaterThan(ranked[1].match_score);
  });

  it("keeps Algolia order between candidates the score cannot separate", () => {
    const ranked = topHistoricOfferCandidates([
      { parent_sku: "20180000001", name: "2018 Test Wine", vintage: 2018 },
      { parent_sku: "20180000002", name: "2018 Test Wine", vintage: 2018 },
    ], "2018 Test Wine");
    expect(ranked.map((candidate) => candidate.parent_sku)).toEqual(["20180000001", "20180000002"]);
  });

  it("rejects an adjacent vintage from an otherwise exact source name", () => {
    expect(exactParentSkus({
      match_group_key: "2025|txakoli rezabal getariako txakolina spain",
      source_match_key: "txakoli rezabal getariako txakolina spain",
      source_vintage: 2025,
      source_wine: fixtures.offBiddableExact.name,
    }, [fixtures.adjacentVintage])).toEqual([]);
  });
});
