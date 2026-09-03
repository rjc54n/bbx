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

  // A batch of 25 vintage-bearing groups whose results run to several pages each
  // fans the exact-validation phase out to one query per page. Algolia rejects a
  // multi-query request carrying more than 50 queries with HTTP 400 ("Too many
  // queries in multi query request"), failing the whole batch, so the fan-out has
  // to be split across requests.
  it("splits the validation fan-out into requests Algolia will accept", async () => {
    const PAGES = 4;
    const batch = Array.from({ length: 25 }, (_, index) => ({
      match_group_key: `2018|off catalogue wine ${index}`,
      source_match_key: `off catalogue wine ${index}`,
      source_vintage: 2018,
      source_wine: `Off catalogue wine ${index} 2018`,
    }));

    const requestCounts: number[] = [];
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      const { requests } = JSON.parse(String(init.body)) as {
        requests: Array<{ params: string }>;
      };
      requestCounts.push(requests.length);
      return response(requests.map(({ params }) => {
        const parsed = new URLSearchParams(params);
        const page = Number(parsed.get("page"));
        const index = batch.findIndex((group) => group.source_wine === parsed.get("query"));
        // The exact match hides on the last page, so a mis-stitched chunk boundary
        // would attribute it to the wrong group.
        const hits = page === PAGES - 1
          ? [{ parent_sku: `8888888${String(index).padStart(4, "0")}`, name: batch[index].source_wine, vintage: 2018 }]
          : [{ parent_sku: `7777777${String(index).padStart(4, "0")}`, name: `Other wine ${index} 2018`, vintage: 2018 }];
        return { hits, nbPages: PAGES, exhaustiveNbHits: true };
      }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchHistoricOfferGroups(batch);

    // 25 initial queries + 25 x 3 remaining pages, none of them over the cap.
    expect(requestCounts.reduce((total, count) => total + count, 0)).toBe(100);
    expect(Math.max(...requestCounts)).toBeLessThanOrEqual(50);
    expect(results.every((result) => result.exhaustive)).toBe(true);
    expect(results.map((result) => result.exactParentSkus)).toEqual(
      batch.map((_, index) => [`8888888${String(index).padStart(4, "0")}`]),
    );
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
