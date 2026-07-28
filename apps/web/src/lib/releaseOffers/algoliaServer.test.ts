import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchHistoricOfferGroups } from "./algoliaServer";
import fixtures from "./fixtures/algoliaHistoricOfferResults.json";

const group = {
  match_group_key: "2018|off catalogue wine",
  source_match_key: "off catalogue wine",
  source_vintage: 2018,
  source_wine: "Off catalogue wine 2018",
};

function response(results: unknown[]) {
  return Promise.resolve(new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
}

describe("historic-offer Algolia server search", () => {
  beforeEach(() => {
    process.env.ALGOLIA_APP_ID = "test-app";
    process.env.ALGOLIA_API_KEY = "search-only";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ALGOLIA_APP_ID;
    delete process.env.ALGOLIA_API_KEY;
  });

  it("auto-link evidence requires an exhaustive exact validation query", async () => {
    const exactHit = { parent_sku: "88888888888", name: "Off catalogue wine 2018", vintage: 2018 };
    const fetchMock = vi.fn(() => response([{
      hits: [exactHit], nbPages: 1, exhaustiveNbHits: true,
    }]));
    vi.stubGlobal("fetch", fetchMock);

    const [result] = await searchHistoricOfferGroups([group]);
    expect(result).toMatchObject({ exhaustive: true, exactParentSkus: ["88888888888"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps non-exact Algolia ranking provisional", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response([{
      hits: [fixtures.typoCandidate],
      nbPages: 1,
      exhaustiveNbHits: true,
    }])));

    const [result] = await searchHistoricOfferGroups([group]);
    expect(result.candidates).toHaveLength(1);
    expect(result.exactParentSkus).toEqual([]);
    expect(result.exhaustive).toBe(true);
  });

  it("does not treat a result beyond the validation page cap as exhaustive", async () => {
    const exactHit = { parent_sku: "88888888888", name: "Off catalogue wine 2018", vintage: 2018 };
    const fetchMock = vi.fn(() => response([{
      hits: [exactHit], nbPages: 11, exhaustiveNbHits: true,
    }]));
    vi.stubGlobal("fetch", fetchMock);

    const [result] = await searchHistoricOfferGroups([group]);
    expect(result.exhaustive).toBe(false);
    expect(result.exactParentSkus).toEqual([]);
  });

  it("records a successful no-result search without fabricating candidates", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response([{ hits: [], nbHits: 0, nbPages: 0, exhaustiveNbHits: true }])));
    const [result] = await searchHistoricOfferGroups([group]);
    expect(result).toMatchObject({ candidates: [], exactParentSkus: [], exhaustive: true });
    expect(result.error).toBeUndefined();
  });

  it("finds an exact result below the five retained candidates", async () => {
    const hits = Array.from({ length: 20 }, (_, index) => ({
      parent_sku: `777777777${String(index).padStart(2, "0")}`,
      name: `Other wine ${index} 2018`,
      vintage: 2018,
    }));
    hits.push({ parent_sku: "88888888888", name: "Off catalogue wine 2018", vintage: 2018 });
    vi.stubGlobal("fetch", vi.fn(() => response([{
      hits, nbPages: 1, exhaustiveNbHits: true,
    }])));

    const [result] = await searchHistoricOfferGroups([group]);
    expect(result.candidates).toHaveLength(5);
    expect(result.exactParentSkus).toEqual(["88888888888"]);
    expect(result.exhaustive).toBe(true);
  });
});
