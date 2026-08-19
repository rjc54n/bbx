// Server-side search + pagination for the CellarTracker records page, mirroring
// the accepted-offer browser (src/lib/releaseOffers/reviewBrowser.ts). The
// snapshot is small enough for an exact count, but the paginate/clamp shape is
// kept identical so the two record surfaces behave the same way.

export const CELLARTRACKER_PAGE_SIZE = 100;

type SearchParam = string | string[] | undefined;

export type CellarTrackerRecordsQuery = {
  page: number;
  search: string;
};

function firstValue(value: SearchParam): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function parseCellarTrackerRecordsQuery(
  params: Record<string, SearchParam>,
): CellarTrackerRecordsQuery {
  const requestedPage = Number(firstValue(params.page));
  return {
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    search: firstValue(params.q).trim(),
  };
}

export function cellarTrackerRecordsRange(page: number): { from: number; to: number } {
  const from = (page - 1) * CELLARTRACKER_PAGE_SIZE;
  return { from, to: from + CELLARTRACKER_PAGE_SIZE - 1 };
}

export function cellarTrackerRecordsPageCount(totalRows: number): number {
  return Math.max(1, Math.ceil(totalRows / CELLARTRACKER_PAGE_SIZE));
}

export function cellarTrackerRecordsPageForCount(requestedPage: number, totalRows: number): number {
  return Math.min(requestedPage, cellarTrackerRecordsPageCount(totalRows));
}

// PostgREST's or() takes a raw filter string; quote a term containing its
// grouping characters so it stays a value rather than filter syntax.
const OR_FILTER_RESERVED_CHARS = /[,()]/;

export function buildCellarTrackerRecordsSearchFilter(term: string): string {
  const pattern = `%${term}%`;
  const value = OR_FILTER_RESERVED_CHARS.test(pattern) ? `"${pattern}"` : pattern;
  return ["source_wine", "producer", "parent_sku", "region"]
    .map((field) => `${field}.ilike.${value}`)
    .join(",");
}
