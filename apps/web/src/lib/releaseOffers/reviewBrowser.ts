export const ACCEPTED_OFFER_PAGE_SIZE = 100;

type SearchParam = string | string[] | undefined;

export type AcceptedOfferQuery = {
  page: number;
  search: string;
};

function firstValue(value: SearchParam): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function parseAcceptedOfferQuery(params: Record<string, SearchParam>): AcceptedOfferQuery {
  const requestedPage = Number(firstValue(params.page));
  return {
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    search: firstValue(params.q).trim(),
  };
}

export function acceptedOfferRange(page: number): { from: number; to: number } {
  const from = (page - 1) * ACCEPTED_OFFER_PAGE_SIZE;
  return { from, to: from + ACCEPTED_OFFER_PAGE_SIZE - 1 };
}

export function acceptedOfferPageCount(totalRows: number): number {
  return Math.max(1, Math.ceil(totalRows / ACCEPTED_OFFER_PAGE_SIZE));
}

export function acceptedOfferPageForCount(requestedPage: number, totalRows: number): number {
  return Math.min(requestedPage, acceptedOfferPageCount(totalRows));
}

// PostgREST's or() accepts a raw filter string. Quote values containing its
// grouping characters so a search term remains text rather than filter syntax.
const OR_FILTER_RESERVED_CHARS = /[,()]/;

export function buildAcceptedOfferSearchFilter(term: string): string {
  const pattern = `%${term}%`;
  const value = OR_FILTER_RESERVED_CHARS.test(pattern) ? `"${pattern}"` : pattern;
  return ["source_wine", "source_product_id", "parent_sku", "source_price_text"]
    .map((field) => `${field}.ilike.${value}`)
    .join(",");
}

export function acceptedOfferHref(page: number, search: string): string {
  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set("q", search);
  return `/release-prices?${params.toString()}`;
}
