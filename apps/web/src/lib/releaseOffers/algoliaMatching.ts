import { releaseWineMatchKey } from "./parser";
import {
  coreKeyScore,
  geographyTokens,
  stripGeographicSegments,
  wineCoreTokens,
} from "@/lib/wine/coreKey";
import { rankIdentityCandidates } from "@/lib/wine/identityRanking";
import type { CandidateEvidence, ReviewBand } from "@/lib/wine/identityTypes";

export type HistoricOfferMatchGroup = {
  match_group_key: string;
  source_match_key: string;
  source_vintage: number | null;
  source_wine: string;
  catalogue_query?: string;
};

export type AlgoliaWineHit = {
  parent_sku?: unknown;
  name?: unknown;
  vintage?: unknown;
  producer?: unknown;
  region?: unknown;
  subregion?: unknown;
  country?: unknown;
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

function catalogueGeography(hit: AlgoliaWineHit): Set<string> {
  return geographyTokens(text(hit.country), text(hit.region), text(hit.subregion));
}

export function exactParentSkus(
  group: HistoricOfferMatchGroup,
  hits: AlgoliaWineHit[],
): string[] {
  if (group.source_vintage === null) return [];
  return [...new Set(hits.flatMap((hit) => {
    const candidate = toHistoricOfferCandidate(hit, 1);
    if (!candidate || candidate.vintage !== group.source_vintage) return [];
    const geography = catalogueGeography(hit);
    return comparableMatchKey(candidate.name, geography) === comparableMatchKey(group.source_wine, geography)
      ? [candidate.parent_sku]
      : [];
  }))];
}

/**
 * BBR renders the same wine with a geographic tail of varying depth, so a
 * release-offer name and the catalogue name frequently differ only in how much
 * geography each repeats. Trailing segments that the candidate itself declares
 * as its country, region or subregion are dropped from both sides before the
 * comparison.
 *
 * Word order is otherwise preserved. Unlike CellarTracker, release offers
 * already use BBR's ordering, so there is nothing for an order-independent
 * comparison to gain and a real precision cost to pay.
 */
function comparableMatchKey(name: string, geography: ReadonlySet<string>): string {
  return releaseWineMatchKey(stripGeographicSegments(name, geography));
}

export type RankedHistoricOfferCandidate = HistoricOfferCandidate & {
  match_score: number;
  algorithm_version: string;
  evidence_score: number;
  score_margin: number | null;
  review_band: ReviewBand;
  risk_flags: string[];
  match_reasons: string[];
  comparison_evidence: CandidateEvidence["components"];
};

function catalogueCoreTokens(hit: AlgoliaWineHit, candidate: HistoricOfferCandidate): string[] {
  return wineCoreTokens(
    `${stripGeographicSegments(candidate.name, catalogueGeography(hit))} ${candidate.producer ?? ""}`,
  );
}

/**
 * Orders a shortlist by how much of the source identity each candidate
 * accounts for. Algolia's own rank breaks ties, so its judgement still decides
 * between candidates the score cannot separate.
 */
export function topHistoricOfferCandidates(
  hits: AlgoliaWineHit[],
  sourceWine: string,
  limit = 5,
  sourceVintage: number | null = null,
): RankedHistoricOfferCandidate[] {
  const sourceTokens = wineCoreTokens(sourceWine);
  const seen = new Set<string>();
  const prepared: Array<{
    candidate: HistoricOfferCandidate & { match_score: number };
    candidateText: string;
    sourceText: string;
    order: number;
  }> = [];
  for (let hitIndex = 0; hitIndex < hits.length; hitIndex += 1) {
    const candidate = toHistoricOfferCandidate(hits[hitIndex], hitIndex + 1);
    if (!candidate || seen.has(candidate.parent_sku)) continue;
    seen.add(candidate.parent_sku);
    const geography = catalogueGeography(hits[hitIndex]);
    const candidateText = `${stripGeographicSegments(candidate.name, geography)} ${candidate.producer ?? ""}`.trim();
    const sourceText = stripGeographicSegments(sourceWine, geography);
    prepared.push({
      candidate: {
        ...candidate,
        match_score: coreKeyScore(sourceTokens, catalogueCoreTokens(hits[hitIndex], candidate)),
      },
      candidateText,
      sourceText,
      order: hitIndex,
    });
  }
  const ranked = rankIdentityCandidates(prepared.map((entry) => ({
    id: entry.candidate.parent_sku,
    originalRank: entry.order,
    value: entry.candidate,
    input: {
      source: "release_offer",
      field: "wine_name",
      sourceText: entry.sourceText,
      candidateText: entry.candidateText,
      sourceVintage,
      candidateVintage: entry.candidate.vintage,
      riskFlags: sourceVintage === null ? ["source_vintage_missing"] : [],
    },
  })));
  return ranked.slice(0, limit).map(({ value, evidence }, index) => ({
    ...value,
    rank: index + 1,
    algorithm_version: evidence.algorithmVersion,
    evidence_score: evidence.evidenceScore,
    score_margin: evidence.scoreMargin,
    review_band: evidence.reviewBand,
    risk_flags: evidence.riskFlags,
    match_reasons: evidence.reasons,
    comparison_evidence: evidence.components,
  }));
}
