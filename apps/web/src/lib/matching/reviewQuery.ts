import { MATCH_SOURCES, type MatchSource } from "./adapters";

export const MATCH_REVIEW_STATES = [
  "with-suggestions", "no-suggestions", "errors",
  "linked", "no-suitable-match", "all", "needs-review",
] as const;
export type MatchReviewState = (typeof MATCH_REVIEW_STATES)[number];

export const DEFAULT_MATCH_REVIEW_STATE: MatchReviewState = "with-suggestions";

export const MATCH_REVIEW_SORTS = ["queue", "match", "coverage"] as const;
export type MatchReviewSort = (typeof MATCH_REVIEW_SORTS)[number];

export const MATCH_REVIEW_SORTABLE_STATES: MatchReviewState[] = [
  "with-suggestions", "all", "needs-review",
];

export const LEGACY_COVERAGE_TIERS = ["workable", "low", "all"] as const;
export type LegacyCoverageTier = (typeof LEGACY_COVERAGE_TIERS)[number];
export const DEFAULT_LEGACY_COVERAGE_TIER: LegacyCoverageTier = "all";

export const MATCH_REVIEW_BANDS = ["all", "likely", "ambiguous", "weak", "legacy"] as const;
export type MatchReviewBandFilter = (typeof MATCH_REVIEW_BANDS)[number];
export const DEFAULT_MATCH_REVIEW_BAND: MatchReviewBandFilter = "all";

export type MatchReviewSource = "all" | MatchSource;

export type MatchReviewQuery = {
  source: MatchReviewSource;
  state: MatchReviewState;
  sort: MatchReviewSort;
  tier: LegacyCoverageTier;
  tierApplies: boolean;
  review: MatchReviewBandFilter;
  search: string;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseMatchReviewQuery(params: SearchParams): MatchReviewQuery {
  const sourceParam = firstParam(params.source);
  const source: MatchReviewSource = MATCH_SOURCES.includes(sourceParam as MatchSource)
    ? sourceParam as MatchSource
    : "all";

  const stateParam = firstParam(params.state);
  const state = MATCH_REVIEW_STATES.includes(stateParam as MatchReviewState)
    ? stateParam as MatchReviewState
    : DEFAULT_MATCH_REVIEW_STATE;

  const tierApplies = MATCH_REVIEW_SORTABLE_STATES.includes(state);
  const sortParam = firstParam(params.sort);
  const sort: MatchReviewSort = tierApplies
    && (sortParam === "match" || sortParam === "coverage")
    ? sortParam
    : "queue";

  const tierParam = firstParam(params.tier);
  const tier = tierApplies && LEGACY_COVERAGE_TIERS.includes(tierParam as LegacyCoverageTier)
    ? tierParam as LegacyCoverageTier
    : DEFAULT_LEGACY_COVERAGE_TIER;

  const reviewParam = firstParam(params.review);
  const review = tierApplies && MATCH_REVIEW_BANDS.includes(reviewParam as MatchReviewBandFilter)
    ? reviewParam as MatchReviewBandFilter
    : DEFAULT_MATCH_REVIEW_BAND;

  const search = firstParam(params.q)?.trim().slice(0, 200) ?? "";
  const page = Math.max(1, Number(firstParam(params.page) ?? "1") || 1);

  return { source, state, sort, tier, tierApplies, review, search, page };
}
