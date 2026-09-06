import { coreKeyScore, sharedTokenCount, wineCoreSequence } from "./coreKey";
import { canonicaliseWineIdentity } from "./identityCanonicaliser";
import {
  WINE_IDENTITY_ALGORITHM_VERSION,
  type CandidateEvidence,
  type IdentityComparisonInput,
  type ReviewBand,
} from "./identityTypes";

export const IDENTITY_LIKELY_SCORE = 0.82;
export const IDENTITY_AMBIGUOUS_SCORE = 0.55;
export const IDENTITY_LIKELY_MARGIN = 0.08;

const SECOND_WINE_MARKERS = [
  "petit mouton",
  "pavillon blanc",
  "pavillon rouge",
  "les forts",
  "carruades",
  "clos du marquis",
  "la croix",
  "alter ego",
  "echo de lynch",
  "petit cheval",
  "reserve de la comtesse",
] as const;

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function markerSet(value: string): Set<string> {
  const padded = ` ${wineCoreSequence(value).join(" ")} `;
  return new Set(SECOND_WINE_MARKERS.filter((marker) =>
    padded.includes(` ${wineCoreSequence(marker).join(" ")} `)));
}

export function hasSecondWineConflict(sourceText: string, candidateText: string): boolean {
  const sourceMarkers = markerSet(sourceText);
  const candidateMarkers = markerSet(candidateText);
  return SECOND_WINE_MARKERS.some((marker) => sourceMarkers.has(marker) !== candidateMarkers.has(marker));
}

function reviewBand(score: number, riskFlags: readonly string[]): ReviewBand {
  if (riskFlags.includes("vintage_disagreement")) return "weak";
  if (score < IDENTITY_AMBIGUOUS_SCORE) return "weak";
  if (riskFlags.length > 0) return "ambiguous";
  return score >= IDENTITY_LIKELY_SCORE ? "likely" : "ambiguous";
}

export function compareWineIdentity(input: IdentityComparisonInput): CandidateEvidence {
  const source = canonicaliseWineIdentity(input.sourceText, input.field, input.source);
  const candidate = canonicaliseWineIdentity(input.candidateText, input.field, "catalogue");
  const shared = sharedTokenCount(source.tokens, candidate.tokens);
  const sourceCoverage = source.tokens.length === 0 ? 0 : shared / source.tokens.length;
  const candidateCoverage = candidate.tokens.length === 0 ? 0 : shared / candidate.tokens.length;
  const tokenF1 = coreKeyScore(source.tokens, candidate.tokens);
  const canonicalExact = source.tokens.length > 0
    && source.tokens.length === candidate.tokens.length
    && shared === source.tokens.length;

  const risks = new Set(input.riskFlags ?? []);
  if (input.sourceVintage !== null && input.candidateVintage !== null
    && input.sourceVintage !== input.candidateVintage) risks.add("vintage_disagreement");
  if (hasSecondWineConflict(input.sourceText, input.candidateText)) risks.add("second_wine_conflict");
  if (sourceCoverage === 1 && candidateCoverage < 0.8) risks.add("candidate_extra_terms");

  const evidenceScore = round4(
    (tokenF1 * 0.5)
      + (sourceCoverage * 0.2)
      + (candidateCoverage * 0.2)
      + (canonicalExact ? 0.1 : 0),
  );
  const reasons = new Set<string>();
  if (canonicalExact) reasons.add("canonical_name_exact");
  else if (tokenF1 >= 0.8) reasons.add("high_token_overlap");
  if (input.sourceVintage !== null && input.sourceVintage === input.candidateVintage) {
    reasons.add("vintage_agreement");
  }
  if (source.transformations.length > 0 || candidate.transformations.length > 0) {
    reasons.add("approved_alias_normalised");
  }
  if (input.producerAgreement === true) reasons.add("producer_agreement");

  const riskFlags = [...risks].sort();
  return {
    algorithmVersion: WINE_IDENTITY_ALGORITHM_VERSION,
    evidenceScore,
    scoreMargin: null,
    reviewBand: reviewBand(evidenceScore, riskFlags),
    sourceCoverage: round4(sourceCoverage),
    candidateCoverage: round4(candidateCoverage),
    tokenF1: round4(tokenF1),
    canonicalExact,
    riskFlags,
    reasons: [...reasons].sort(),
    components: {
      source_tokens: source.tokens,
      candidate_tokens: candidate.tokens,
      source_transformations: source.transformations,
      candidate_transformations: candidate.transformations,
      vintage_agreement: input.sourceVintage === null || input.candidateVintage === null
        ? null
        : input.sourceVintage === input.candidateVintage,
      producer_agreement: input.producerAgreement ?? null,
    },
  };
}

export function bandWithMargin(evidence: CandidateEvidence, margin: number | null): CandidateEvidence {
  const risks = new Set(evidence.riskFlags);
  if (margin !== null && margin < IDENTITY_LIKELY_MARGIN) risks.add("small_score_margin");
  const riskFlags = [...risks].sort();
  return {
    ...evidence,
    scoreMargin: margin === null ? null : round4(margin),
    riskFlags,
    reviewBand: reviewBand(evidence.evidenceScore, riskFlags),
  };
}
