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

  it("never treats a missing-vintage group as exact", () => {
    expect(exactParentSkus({ ...group, source_vintage: null }, [
      { parent_sku: "20180000001", name: "2018 Test Wine", vintage: 2018 },
    ])).toEqual([]);
  });

  it("preserves Algolia order and records display evidence", () => {
    expect(topHistoricOfferCandidates([
      { ...fixtures.offBiddableExact, _rankingInfo: { nbTypos: 1 }, _highlightResult: { name: { matchedWords: ["txakoli", "rezabal"] } } },
      { parent_sku: "bad", name: "Invalid" },
    ])).toEqual([expect.objectContaining({
      rank: 1,
      parent_sku: "20258330552",
      stock_origin: "BBR",
      purchase_mode: "Delivery",
      typo_count: 1,
      matched_words: ["txakoli", "rezabal"],
    })]);
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
