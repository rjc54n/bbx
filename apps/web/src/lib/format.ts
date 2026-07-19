export function formatPence(p: number | null): string {
  if (p === null || p === undefined) return "–";
  return `£${(p / 100).toFixed(2)}`;
}

export function formatPct(p: number | null): string {
  if (p === null || p === undefined) return "–";
  return `${p.toFixed(1)}%`;
}

export function formatFormat(caseSize: number | null, bottleVolumeMl: number | null): string {
  if (caseSize === null || bottleVolumeMl === null) return "–";
  return `${caseSize} x ${bottleVolumeMl / 10}cl`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
