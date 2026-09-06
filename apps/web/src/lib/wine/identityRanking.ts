import { bandWithMargin, compareWineIdentity } from "./identityEvidence";
import type {
  EvidenceCandidate,
  RankedEvidenceCandidate,
} from "./identityTypes";

export function rankIdentityCandidates<T>(
  candidates: Array<EvidenceCandidate<T>>,
): Array<RankedEvidenceCandidate<T>> {
  const scored = candidates.map((candidate) => ({
    ...candidate,
    evidence: compareWineIdentity(candidate.input),
  }));
  const hasHardRisk = (riskFlags: readonly string[]) => riskFlags.some((risk) =>
    risk === "vintage_disagreement" || risk === "second_wine_conflict");
  scored.sort((left, right) =>
    Number(hasHardRisk(left.evidence.riskFlags)) - Number(hasHardRisk(right.evidence.riskFlags))
      || right.evidence.evidenceScore - left.evidence.evidenceScore
      || left.originalRank - right.originalRank
      || left.id.localeCompare(right.id));

  return scored.map((candidate, index) => {
    const runnerUp = index === 0 ? scored[1] : undefined;
    const margin = index === 0 && runnerUp
      ? Math.max(0, candidate.evidence.evidenceScore - runnerUp.evidence.evidenceScore)
      : null;
    return {
      value: candidate.value,
      evidence: bandWithMargin(candidate.evidence, margin),
    };
  });
}
