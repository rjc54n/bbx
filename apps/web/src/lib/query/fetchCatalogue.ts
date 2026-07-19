import { supabase } from "@/lib/supabase";
import type { CatalogueQueryState, PriceChangeQueryState } from "./types";
import type { CatalogueRow, PriceChangeRow } from "./rows";

export const PAGE_SIZE = 25;

export interface FetchResult<Row> {
  rows: Row[];
  count: number;
}

// PostgREST's or() takes a raw filter-syntax string, not a parameterised
// value -- a search term containing "," or "(" would otherwise be parsed as
// filter syntax (e.g. splitting into an extra OR condition) rather than
// literal text. Quote-wrapping mirrors how @supabase/postgrest-js itself
// escapes reserved characters for .in() (PostgrestReservedCharsRegexp in
// PostgrestFilterBuilder.ts): wrap in double quotes when a reserved
// character is present.
const OR_FILTER_RESERVED_CHARS = /[,()]/;

export function buildSearchOrFilter(term: string): string {
  const pattern = `%${term}%`;
  const value = OR_FILTER_RESERVED_CHARS.test(pattern) ? `"${pattern}"` : pattern;
  return `name.ilike.${value},producer.ilike.${value}`;
}

export function paginationRange(page: number, pageSize: number = PAGE_SIZE): { from: number; to: number } {
  const from = page * pageSize;
  return { from, to: from + pageSize - 1 };
}

// Read catalogue_view for explore/value-research/recent-listings. Filters
// are applied in the order docs/PHASE2-catalogue-browser.md Phase C
// specifies: in()/eq() for enum/typeahead, gte()/lte() for range and date
// bounds (including the signed price_vs_*_pct columns), or(ilike) for the
// free-text search box.
export async function fetchCatalogue(state: CatalogueQueryState): Promise<FetchResult<CatalogueRow>> {
  let query = supabase.from("catalogue_view").select("*", { count: "exact" });

  for (const filter of state.filters) {
    switch (filter.kind) {
      case "enum":
        if (filter.value.length > 0) query = query.in(filter.field, filter.value);
        break;
      case "range":
        if (filter.min !== undefined) query = query.gte(filter.field, filter.min);
        if (filter.max !== undefined) query = query.lte(filter.field, filter.max);
        break;
      case "date":
        if (filter.min !== undefined) query = query.gte(filter.field, filter.min);
        if (filter.max !== undefined) query = query.lte(filter.field, filter.max);
        break;
      case "text":
        if (filter.value) query = query.or(buildSearchOrFilter(filter.value));
        break;
      case "typeahead":
        if (filter.value) query = query.eq(filter.field, filter.value);
        break;
    }
  }

  // state.sort.field alone isn't unique (e.g. every row from the same scan
  // run shares one last_seen_at) -- without a deterministic tiebreaker,
  // Postgres doesn't guarantee the same row order across two separate
  // range()-paginated queries, so consecutive pages can skip or repeat rows.
  // (parent_sku, format_code) is catalogue_view's primary key, so it's
  // always a valid, stable final tiebreaker regardless of the primary sort.
  query = query
    .order(state.sort.field, { ascending: state.sort.dir === "asc", nullsFirst: false })
    .order("parent_sku", { ascending: true })
    .order("format_code", { ascending: true });

  const { from, to } = paginationRange(state.page);
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: data ?? [], count: count ?? 0 };
}

// Read recent_price_change_view for the price-changes mode. No filters of
// its own in v1 -- see docs/PHASE2-catalogue-browser.md Phase A. The view is
// DISTINCT ON (parent_sku, format_code), so that pair is unique here too and
// works as the same deterministic pagination tiebreaker as fetchCatalogue.
export async function fetchPriceChanges(state: PriceChangeQueryState): Promise<FetchResult<PriceChangeRow>> {
  let query = supabase
    .from("recent_price_change_view")
    .select("*", { count: "exact" })
    .order(state.sort.field, { ascending: state.sort.dir === "asc", nullsFirst: false })
    .order("parent_sku", { ascending: true })
    .order("format_code", { ascending: true });

  const { from, to } = paginationRange(state.page);
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: data ?? [], count: count ?? 0 };
}
