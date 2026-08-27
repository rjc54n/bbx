// Pagination for a scenario preview. It deliberately fetches one row beyond
// the visible page so it never needs a costly exact total.

export const SCENARIO_PAGE_SIZE = 50;

export function scenarioPreviewRange(page: number): { from: number; to: number } {
  const from = (page - 1) * SCENARIO_PAGE_SIZE;
  return { from, to: from + SCENARIO_PAGE_SIZE };
}

export function scenarioPreview<Row>(rows: Row[]): { rows: Row[]; hasNext: boolean } {
  return {
    rows: rows.slice(0, SCENARIO_PAGE_SIZE),
    hasNext: rows.length > SCENARIO_PAGE_SIZE,
  };
}

export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
