export function formatPence(p: number | null): string {
  if (p === null || p === undefined) return "–";
  return `£${(p / 100).toFixed(2)}`;
}

export function formatPct(p: number | null): string {
  if (p === null || p === undefined) return "–";
  return `${p.toFixed(1)}%`;
}

// Signed metrics (price vs market/last/next) must never rely on colour alone
// to convey direction -- see docs/PHASE2-catalogue-browser.md Phase D. `-`
// falls out of toFixed() for negatives; `+` is added explicitly for
// positives so cheaper-than-reference and pricier-than-reference are never
// ambiguous at a glance.
export function formatSignedPct(p: number | null): string {
  if (p === null || p === undefined) return "–";
  if (p === 0) return "0.0%";
  return `${p > 0 ? "+" : ""}${p.toFixed(1)}%`;
}

export function signedPctDirection(p: number | null): "down" | "up" | "flat" | null {
  if (p === null || p === undefined) return null;
  if (p < 0) return "down";
  if (p > 0) return "up";
  return "flat";
}

export function formatFormat(caseSize: number | null, bottleVolumeMl: number | null): string {
  if (caseSize === null || bottleVolumeMl === null) return "–";
  return `${caseSize} x ${bottleVolumeMl / 10}cl`;
}

export function formatCoveragePct(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator <= 0) return "–";
  return `${((numerator / denominator) * 100).toFixed(0)}%`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
