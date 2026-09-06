import type { MatchSource } from "@/lib/matching/adapters";

export const WINE_IDENTITY_ALGORITHM_VERSION = "wine-identity-v2.0.0";

export type WineIdentityField = "wine_name" | "producer";
export type ReviewBand = "likely" | "ambiguous" | "weak";

export type CanonicalIdentity = {
  tokens: string[];
  normalisedText: string;
  transformations: string[];
};

export type IdentityComparisonInput = {
  source: MatchSource | "catalogue";
  field: WineIdentityField;
  sourceText: string;
  candidateText: string;
  sourceVintage: number | null;
  candidateVintage: number | null;
  riskFlags?: string[];
  producerAgreement?: boolean | null;
};

export type CandidateEvidence = {
  algorithmVersion: string;
  evidenceScore: number;
  scoreMargin: number | null;
  reviewBand: ReviewBand;
  sourceCoverage: number;
  candidateCoverage: number;
  tokenF1: number;
  canonicalExact: boolean;
  riskFlags: string[];
  reasons: string[];
  components: Record<string, number | boolean | string | string[] | null>;
};

export type EvidenceCandidate<T> = {
  id: string;
  originalRank: number;
  value: T;
  input: IdentityComparisonInput;
};

export type RankedEvidenceCandidate<T> = {
  value: T;
  evidence: CandidateEvidence;
};
