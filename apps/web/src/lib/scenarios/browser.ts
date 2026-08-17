// Pagination for a scenario's run preview, same paginate/clamp shape as the
// release-prices and cellartracker record browsers.

export const SCENARIO_PAGE_SIZE = 50;

export function scenarioRange(page: number): { from: number; to: number } {
  const from = (page - 1) * SCENARIO_PAGE_SIZE;
  return { from, to: from + SCENARIO_PAGE_SIZE - 1 };
}

export function scenarioPageCount(totalRows: number): number {
  return Math.max(1, Math.ceil(totalRows / SCENARIO_PAGE_SIZE));
}

export function scenarioPageForCount(requestedPage: number, totalRows: number): number {
  return Math.min(requestedPage, scenarioPageCount(totalRows));
}

export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
