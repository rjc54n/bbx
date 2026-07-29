import { releaseWineMatchKey } from "@/lib/releaseOffers/parser";
import {
  toHistoricOfferCandidate,
  type AlgoliaWineHit,
  type HistoricOfferCandidate,
} from "@/lib/releaseOffers/algoliaMatching";
import {
  coreKeyScore,
  geographyTokens,
  sharedTokenCount,
  stripGeographicSegments,
  wineCoreTokens,
} from "@/lib/wine/coreKey";

/**
 * CellarTracker commonly prefixes its Wine field with the Producer field,
 * while BBR commonly puts the producer later in the product name. Removing a
 * leading producer gives Algolia the distinctive cuvee or property name. Exact
 * matching still compares the full source and candidate identities.
 */
export function cellarTrackerCatalogueQuery(sourceWine: string, sourceProducer: string | null): string {
  const wineKey = releaseWineMatchKey(sourceWine);
  const producerKey = sourceProducer ? releaseWineMatchKey(sourceProducer) : "";
  if (!producerKey || wineKey === producerKey || !wineKey.startsWith(`${producerKey} `)) {
    return sourceWine;
  }
  const remainder = wineKey.slice(producerKey.length + 1).trim();
  return remainder.length >= 3 ? remainder : sourceWine;
}

export { coreKey, coreKeyScore, wineCoreTokens } from "@/lib/wine/coreKey";

/**
 * CellarTracker's Wine already contains the designation and vineyard and holds
 * no geography, so nothing is subtracted. Subtracting the Appellation column
 * would be wrong: in Burgundy the cru name is both the appellation and the
 * wine's identity.
 */
export function cellarTrackerCoreTokens(sourceWine: string, sourceProducer: string | null): string[] {
  return wineCoreTokens(`${sourceWine} ${sourceProducer ?? ""}`);
}

export type BbrCatalogueIdentity = {
  name: string;
  producer?: string | null;
  country?: string | null;
  region?: string | null;
  subregion?: string | null;
};

/**
 * BBR names are comma-separated and suffixed with geography, for example
 * "2018 Barrua, Isola dei Nuraghi, Punica, Sardinia, Italy". Trailing segments
 * that are wholly geographic are dropped so the remainder is comparable with a
 * CellarTracker identity.
 *
 * Segments are dropped whole rather than token by token, and the first segment
 * is never dropped: removing geography tokens individually would reduce
 * "2015 Chateau Margaux, Margaux, Bordeaux" to "chateau".
 */
export function bbrCatalogueCoreTokens(product: BbrCatalogueIdentity): string[] {
  const geography = geographyTokens(product.country, product.region, product.subregion);
  const kept = stripGeographicSegments(product.name, geography, { trailingOnly: false });
  return wineCoreTokens(`${kept} ${product.producer ?? ""}`);
}

/**
 * A unique containment winner only auto-links when it is clearly ahead of the
 * best candidate that is not contained either way. Same-producer wines of a
 * different cuvee otherwise sit close behind.
 */
export const CELLARTRACKER_AUTO_LINK_MARGIN = 0.15;
export const CELLARTRACKER_MIN_SHARED_TOKENS = 2;
export const CELLARTRACKER_MAX_SUGGESTIONS = 5;

export type CellarTrackerRankedCandidate = HistoricOfferCandidate & { match_score: number };

export type CellarTrackerMatchGroup = {
  match_group_key: string;
  source_wine: string;
  source_producer: string | null;
  source_vintage: number | null;
};

export type CellarTrackerRanking = {
  candidates: CellarTrackerRankedCandidate[];
  autoLinkParentSku: string | null;
};

/**
 * Ranks a shortlist locally rather than trusting Algolia's ordering, and
 * decides whether the winner is safe to link without review. Whole-catalogue
 * exactness is handled separately by the local SQL tier; this only judges the
 * candidates in the shortlist.
 */
export function rankCellarTrackerCandidates(
  group: CellarTrackerMatchGroup,
  hits: AlgoliaWineHit[],
  limit = CELLARTRACKER_MAX_SUGGESTIONS,
): CellarTrackerRanking {
  const sourceTokens = cellarTrackerCoreTokens(group.source_wine, group.source_producer);
  const scored = new Map<string, {
    candidate: CellarTrackerRankedCandidate;
    tokens: string[];
    shared: number;
    contained: boolean;
    equal: boolean;
  }>();

  for (const hit of hits) {
    const candidate = toHistoricOfferCandidate(hit, 1);
    if (!candidate) continue;
    if (group.source_vintage !== null && candidate.vintage !== group.source_vintage) continue;
    const tokens = bbrCatalogueCoreTokens({
      name: candidate.name,
      producer: candidate.producer,
      country: typeof hit.country === "string" ? hit.country : null,
      region: candidate.region,
      subregion: typeof hit.subregion === "string" ? hit.subregion : null,
    });
    const shared = sharedTokenCount(sourceTokens, tokens);
    const entry = {
      candidate: { ...candidate, match_score: coreKeyScore(sourceTokens, tokens) },
      tokens,
      shared,
      contained: shared === sourceTokens.length || shared === tokens.length,
      equal: shared === sourceTokens.length && shared === tokens.length,
    };
    const existing = scored.get(candidate.parent_sku);
    if (!existing || entry.candidate.match_score > existing.candidate.match_score) {
      scored.set(candidate.parent_sku, entry);
    }
  }

  const ordered = [...scored.values()].sort((left, right) =>
    right.candidate.match_score - left.candidate.match_score
      || left.candidate.parent_sku.localeCompare(right.candidate.parent_sku));

  return {
    candidates: ordered.slice(0, limit).map((entry, index) => ({ ...entry.candidate, rank: index + 1 })),
    autoLinkParentSku: group.source_vintage === null ? null : autoLinkParentSku(ordered, sourceTokens),
  };
}

function autoLinkParentSku(
  ordered: Array<{
    candidate: CellarTrackerRankedCandidate;
    shared: number;
    contained: boolean;
    equal: boolean;
  }>,
  sourceTokens: readonly string[],
): string | null {
  if (sourceTokens.length === 0) return null;

  const equal = ordered.filter((entry) => entry.equal);
  if (equal.length === 1) return equal[0].candidate.parent_sku;
  if (equal.length > 1) return null;

  const contained = ordered.filter((entry) =>
    entry.contained && entry.shared >= CELLARTRACKER_MIN_SHARED_TOKENS);
  if (contained.length !== 1) return null;

  const runnerUp = ordered
    .filter((entry) => entry.candidate.parent_sku !== contained[0].candidate.parent_sku)
    .reduce((best, entry) => Math.max(best, entry.candidate.match_score), 0);
  return contained[0].candidate.match_score - runnerUp >= CELLARTRACKER_AUTO_LINK_MARGIN
    ? contained[0].candidate.parent_sku
    : null;
}
