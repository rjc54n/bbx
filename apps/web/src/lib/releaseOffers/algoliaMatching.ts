import { releaseWineMatchKey } from "./parser";

export type HistoricOfferMatchGroup = {
  match_group_key: string;
  source_match_key: string;
  source_vintage: number | null;
  source_wine: string;
};

export type AlgoliaWineHit = {
  parent_sku?: unknown;
  name?: unknown;
  vintage?: unknown;
  producer?: unknown;
  region?: unknown;
  stock_origin?: unknown;
  purchase_mode?: unknown;
  product_url?: unknown;
  url?: unknown;
  _rankingInfo?: { nbTypos?: unknown };
  _highlightResult?: { name?: { matchedWords?: unknown } };
};

export type HistoricOfferCandidate = {
  rank: number;
  parent_sku: string;
  name: string;
  vintage: number | null;
  producer: string | null;
  region: string | null;
  stock_origin: string | null;
  purchase_mode: string | null;
  product_url: string | null;
  matched_words: string[];
  typo_count: number | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export function toHistoricOfferCandidate(
  hit: AlgoliaWineHit,
  rank: number,
): HistoricOfferCandidate | null {
  const parentSku = text(hit.parent_sku);
  const name = text(hit.name);
  if (!parentSku || !/^\d{5,30}$/.test(parentSku) || !name) return null;
  const matchedWords = hit._highlightResult?.name?.matchedWords;
  return {
    rank,
    parent_sku: parentSku,
    name,
    vintage: integer(hit.vintage),
    producer: text(hit.producer),
    region: text(hit.region),
    stock_origin: text(hit.stock_origin),
    purchase_mode: text(hit.purchase_mode),
    product_url: text(hit.product_url) ?? text(hit.url),
    matched_words: Array.isArray(matchedWords)
      ? matchedWords.filter((word): word is string => typeof word === "string")
      : [],
    typo_count: integer(hit._rankingInfo?.nbTypos),
  };
}

export function exactParentSkus(
  group: HistoricOfferMatchGroup,
  hits: AlgoliaWineHit[],
): string[] {
  if (group.source_vintage === null) return [];
  return [...new Set(hits.flatMap((hit) => {
    const candidate = toHistoricOfferCandidate(hit, 1);
    if (!candidate || candidate.vintage !== group.source_vintage) return [];
    return releaseWineMatchKey(candidate.name) === group.source_match_key
      ? [candidate.parent_sku]
      : [];
  }))];
}

export function topHistoricOfferCandidates(hits: AlgoliaWineHit[], limit = 5) {
  const seen = new Set<string>();
  const candidates: HistoricOfferCandidate[] = [];
  for (let hitIndex = 0; hitIndex < hits.length; hitIndex += 1) {
    const candidate = toHistoricOfferCandidate(hits[hitIndex], hitIndex + 1);
    if (!candidate || seen.has(candidate.parent_sku)) continue;
    seen.add(candidate.parent_sku);
    candidates.push(candidate);
    if (candidates.length === limit) break;
  }
  return candidates;
}
