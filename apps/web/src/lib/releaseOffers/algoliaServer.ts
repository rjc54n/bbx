import "server-only";

import {
  exactParentSkus,
  topHistoricOfferCandidates,
  type AlgoliaWineHit,
  type HistoricOfferMatchGroup,
  type RankedHistoricOfferCandidate,
} from "./algoliaMatching";
import { cellarTrackerCatalogueQuery, type CellarTrackerMatchGroup } from "@/lib/cellar/cellartrackerMatching";

const ALGOLIA_INDEX = "prod_product";
const INITIAL_HITS_PER_PAGE = 20;
const VALIDATION_HITS_PER_PAGE = 100;
const MAX_VALIDATION_PAGES = 10;

type AlgoliaResult = {
  hits?: AlgoliaWineHit[];
  nbHits?: number;
  nbPages?: number;
  exhaustiveNbHits?: boolean;
  message?: string;
};

type SearchRequest = { indexName: string; params: string };

export type AlgoliaGroupResult = {
  group: HistoricOfferMatchGroup;
  candidates: RankedHistoricOfferCandidate[];
  exactParentSkus: string[];
  exhaustive: boolean;
  observedAt: string;
  error?: string;
  /**
   * Set when the exact-validation pass could not be completed for this group.
   * Distinct from `error`: the suggestions above are good, they just carry no
   * auto-link evidence. The caller records the group as processed.
   */
  validationError?: string;
};

export type CellarTrackerGroupResult = {
  group: CellarTrackerMatchGroup;
  hits: AlgoliaWineHit[];
  observedAt: string;
  error?: string;
};

function credentials() {
  const appId = process.env.ALGOLIA_APP_ID?.trim();
  const apiKey = process.env.ALGOLIA_API_KEY?.trim();
  if (!appId || !apiKey) {
    throw new Error("The server-side Algolia search credentials are not configured.");
  }
  return { appId, apiKey };
}

function searchParams(group: HistoricOfferMatchGroup, hitsPerPage: number, page = 0) {
  const facetFilters = ["family_type:Wines"];
  if (group.source_vintage !== null) facetFilters.push(`vintage:${group.source_vintage}`);
  return new URLSearchParams({
    query: group.catalogue_query ?? group.source_wine,
    hitsPerPage: String(hitsPerPage),
    page: String(page),
    facetFilters: JSON.stringify(facetFilters),
    attributesToRetrieve: "parent_sku,name,vintage,producer,region,subregion,country,stock_origin,purchase_mode,product_url,url",
    attributesToHighlight: "name",
    getRankingInfo: "true",
  }).toString();
}

/**
 * Algolia rejects a multi-query request carrying more than 50 queries outright,
 * with HTTP 400 "Too many queries in multi query request" — the whole request,
 * not the queries past the cap. The exact-validation phase below fans out to one
 * query per result page per group, so a batch of broad queries passes 50 without
 * anything being wrong with the queries themselves.
 */
const MAX_QUERIES_PER_REQUEST = 50;

async function postQueries(requests: SearchRequest[]): Promise<AlgoliaResult[]> {
  const { appId, apiKey } = credentials();
  const response = await fetch(`https://${appId}-dsn.algolia.net/1/indexes/*/queries`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-algolia-application-id": appId,
      "x-algolia-api-key": apiKey,
    },
    body: JSON.stringify({ requests }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Algolia returned HTTP ${response.status}.`);
  const payload = await response.json() as { results?: AlgoliaResult[] };
  if (!Array.isArray(payload.results) || payload.results.length !== requests.length) {
    throw new Error("Algolia returned an incomplete multi-search response.");
  }
  return payload.results;
}

async function executeQueries(requests: SearchRequest[]): Promise<AlgoliaResult[]> {
  const results: AlgoliaResult[] = [];
  for (let start = 0; start < requests.length; start += MAX_QUERIES_PER_REQUEST) {
    results.push(...await postQueries(requests.slice(start, start + MAX_QUERIES_PER_REQUEST)));
  }
  return results;
}

/**
 * The exact-validation pass only ever upgrades a group's suggestions to
 * auto-link evidence, so a failure fetching one of its pages must cost that
 * group its `exhaustive` flag — not the suggestions the first pass already
 * found, and not the other groups in the batch. Returns a null per unanswered
 * request rather than throwing, and fails only the chunk that actually failed.
 */
async function executePageQueries(
  requests: SearchRequest[],
): Promise<{ results: Array<AlgoliaResult | null>; failure?: string }> {
  const results: Array<AlgoliaResult | null> = [];
  let failure: string | undefined;
  for (let start = 0; start < requests.length; start += MAX_QUERIES_PER_REQUEST) {
    const chunk = requests.slice(start, start + MAX_QUERIES_PER_REQUEST);
    try {
      results.push(...await postQueries(chunk));
    } catch (caught) {
      failure ??= caught instanceof Error ? caught.message : "The validation search failed.";
      results.push(...chunk.map(() => null));
    }
  }
  return { results, failure };
}

function request(group: HistoricOfferMatchGroup, hitsPerPage: number, page = 0): SearchRequest {
  return { indexName: ALGOLIA_INDEX, params: searchParams(group, hitsPerPage, page) };
}

export async function searchHistoricOfferGroups(
  groups: HistoricOfferMatchGroup[],
): Promise<AlgoliaGroupResult[]> {
  const observedAt = new Date().toISOString();
  const initial = await executeQueries(groups.map((group) => request(
    group,
    group.source_vintage === null ? INITIAL_HITS_PER_PAGE : VALIDATION_HITS_PER_PAGE,
  )));
  const output = new Map<string, AlgoliaGroupResult>();
  const validationGroups: HistoricOfferMatchGroup[] = [];
  const initialByGroup = new Map<string, AlgoliaResult>();

  groups.forEach((group, index) => {
    const result = initial[index];
    initialByGroup.set(group.match_group_key, result);
    if (result.message || !Array.isArray(result.hits)) {
      output.set(group.match_group_key, {
        group, candidates: [], exactParentSkus: [], exhaustive: false, observedAt,
        error: result.message ?? "Algolia returned no result set.",
      });
      return;
    }
    output.set(group.match_group_key, {
      group,
      candidates: topHistoricOfferCandidates(result.hits, group.source_wine),
      exactParentSkus: [],
      exhaustive: false,
      observedAt,
    });
    if (group.source_vintage !== null) validationGroups.push(group);
  });

  const remainingRequests: Array<{ group: HistoricOfferMatchGroup; page: number }> = [];
  const validationHits = new Map<string, AlgoliaWineHit[]>();
  const validationEligible = new Set<string>();

  validationGroups.forEach((group) => {
    const result = initialByGroup.get(group.match_group_key);
    if (!result) return;
    if (result.message || !Array.isArray(result.hits)) return;
    const pageCount = result.nbPages;
    if (typeof pageCount !== "number" || !Number.isInteger(pageCount) || pageCount < 0
      || result.exhaustiveNbHits === false || pageCount > MAX_VALIDATION_PAGES) return;
    validationEligible.add(group.match_group_key);
    validationHits.set(group.match_group_key, [...result.hits]);
    for (let page = 1; page < pageCount; page += 1) remainingRequests.push({ group, page });
  });

  const { results: remainingPages, failure: validationFailure } = await executePageQueries(
    remainingRequests.map(({ group, page }) => request(group, VALIDATION_HITS_PER_PAGE, page)),
  );
  const validationFailed = new Set<string>();
  remainingRequests.forEach(({ group }, index) => {
    const result = remainingPages[index];
    if (!result) {
      validationEligible.delete(group.match_group_key);
      validationFailed.add(group.match_group_key);
      return;
    }
    if (result.message || !Array.isArray(result.hits)) {
      validationEligible.delete(group.match_group_key);
      return;
    }
    validationHits.get(group.match_group_key)?.push(...result.hits);
  });

  for (const group of validationGroups) {
    if (!validationEligible.has(group.match_group_key)) continue;
    const result = output.get(group.match_group_key);
    if (!result) continue;
    result.exactParentSkus = exactParentSkus(
      group,
      validationHits.get(group.match_group_key) ?? [],
    );
    result.exhaustive = true;
  }
  if (validationFailure) {
    for (const key of validationFailed) {
      const result = output.get(key);
      if (result) result.validationError = validationFailure;
    }
  }
  return groups.map((group) => output.get(group.match_group_key)!);
}

const CELLARTRACKER_ATTRIBUTES_TO_RETRIEVE =
  "parent_sku,name,vintage,producer,region,subregion,country,stock_origin,purchase_mode,product_url,url";

function cellarTrackerSearchParams(
  query: string,
  vintage: number | null,
  extra?: Record<string, string>,
): string {
  const facetFilters = ["family_type:Wines"];
  if (vintage !== null) facetFilters.push(`vintage:${vintage}`);
  return new URLSearchParams({
    query,
    hitsPerPage: "20",
    page: "0",
    facetFilters: JSON.stringify(facetFilters),
    attributesToRetrieve: CELLARTRACKER_ATTRIBUTES_TO_RETRIEVE,
    attributesToHighlight: "name",
    getRankingInfo: "true",
    ...extra,
  }).toString();
}

export async function searchCellarTrackerGroups(
  groups: CellarTrackerMatchGroup[],
): Promise<CellarTrackerGroupResult[]> {
  const observedAt = new Date().toISOString();
  const requests: SearchRequest[] = groups.flatMap((group) => {
    const queryA = cellarTrackerCatalogueQuery(group.source_wine, group.source_producer);
    const queryB = `${group.source_wine} ${group.source_producer ?? ""}`.trim();
    return [
      { indexName: ALGOLIA_INDEX, params: cellarTrackerSearchParams(queryA, group.source_vintage) },
      {
        indexName: ALGOLIA_INDEX,
        params: cellarTrackerSearchParams(queryB, group.source_vintage, { removeWordsIfNoResults: "allOptional" }),
      },
    ];
  });
  const results = await executeQueries(requests);
  return groups.map((group, index) => {
    const resultA = results[index * 2];
    const resultB = results[index * 2 + 1];
    const failedA = Boolean(resultA.message) || !Array.isArray(resultA.hits);
    const failedB = Boolean(resultB.message) || !Array.isArray(resultB.hits);
    if (failedA && failedB) {
      return {
        group,
        hits: [],
        observedAt,
        error: resultA.message ?? resultB.message ?? "Algolia returned no result set.",
      };
    }
    const hits = [
      ...(failedA ? [] : resultA.hits!),
      ...(failedB ? [] : resultB.hits!),
    ];
    return { group, hits, observedAt };
  });
}

export async function searchBbrCatalogue(query: string, vintage: number | null) {
  const group: HistoricOfferMatchGroup = {
    match_group_key: "manual-search",
    source_match_key: "",
    source_vintage: vintage,
    source_wine: query,
  };
  const [result] = await executeQueries([request(group, 10)]);
  if (result.message || !Array.isArray(result.hits)) {
    throw new Error(result.message ?? "Algolia returned no result set.");
  }
  return topHistoricOfferCandidates(result.hits, group.source_wine, 10);
}
