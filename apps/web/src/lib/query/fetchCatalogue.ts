import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { applyFilters, buildSearchFilter, buildSearchOrFilter, type AppliedFilter } from "./applyFilters";
import type { CatalogueQueryState, PriceChangeQueryState } from "./types";
import type { CatalogueRow, PriceChangeRow } from "./rows";

// Re-exported so existing importers (and their tests) keep their path.
export { buildSearchFilter, buildSearchOrFilter };

export const PAGE_SIZE = 25;

export interface FetchResult<Row> {
  rows: Row[];
  count: number;
}

type ReferencePriceRow = {
  parent_sku: string | null;
  price_per_75cl_p: number | null;
  resolution_kind: string | null;
  source_kind: string | null;
  reference_date: string | null;
  date_meaning: string | null;
  needs_review: boolean | null;
  has_competing_evidence: boolean | null;
};

export function mergeReferencePrices(
  rows: DatabaseCatalogueRow[],
  references: ReferencePriceRow[],
): CatalogueRow[] {
  const referenceByParent = new Map(
    references
      .filter((reference): reference is ReferencePriceRow & { parent_sku: string; price_per_75cl_p: number } =>
        reference.parent_sku !== null && reference.price_per_75cl_p !== null,
      )
      .map((reference) => [reference.parent_sku, reference]),
  );
  return rows.map((row) => {
    const reference = row.parent_sku && row.bottle_volume_ml === 750 && (row.case_size ?? 0) > 0
      ? referenceByParent.get(row.parent_sku)
      : undefined;
    return {
      ...row,
      reference_price_p: reference ? reference.price_per_75cl_p * (row.case_size ?? 0) : null,
      reference_kind: reference?.resolution_kind ?? null,
      reference_source: reference?.source_kind ?? null,
      reference_date: reference?.reference_date ?? null,
      reference_date_meaning: reference?.date_meaning ?? null,
      reference_needs_review: reference?.needs_review ?? false,
      reference_has_competing_evidence: reference?.has_competing_evidence ?? false,
    };
  });
}

type DatabaseCatalogueRow = Omit<Database["public"]["Views"]["catalogue_view"]["Row"], "last_rest_checked_at">;

// Every catalogue_view column except last_rest_checked_at. That column comes
// from a join to private.product_rest_checks; Postgres removes the join when
// the column isn't selected, and with it a hash join over the whole catalogue
// on every page (measured ~4-5x slower per page with select("*"); see
// docs/REST-CHECK-DECOUPLING-2026-10-02.md). Don't switch back to "*".
// One literal string so the Supabase client can type the selected row.
export const CATALOGUE_SELECT = "parent_sku,format_code,name,vintage,country,region,subregion,colour,producer,product_url,case_size,bottle_volume_ml,ask,market_price_p,last_transaction_p,highest_bid_p,next_lowest_price_p,qty_available,source_agreement,first_seen_at,last_seen_at,signal_type,price_vs_market_pct,price_vs_last_pct,price_vs_next_pct,price_per_bottle_p,price_per_litre_p,adjusted_guide_p,price_vs_adjusted_guide_pct,is_listed";

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
  let query = supabase.from("catalogue_view").select(CATALOGUE_SELECT, { count: "exact" });
  query = applyFilters(query, state.filters as readonly AppliedFilter[]);

  // state.sort.field alone isn't unique (e.g. many SKUs share one
  // first_seen_at or market price) -- without a deterministic tiebreaker,
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
  const rows = (data ?? []) as DatabaseCatalogueRow[];
  const parentSkus = [...new Set(rows.flatMap((row) => row.parent_sku ? [row.parent_sku] : []))];
  if (parentSkus.length === 0) return { rows: mergeReferencePrices(rows, []), count: count ?? 0 };
  const { data: referenceData, error: referenceError } = await supabase
    .from("resolved_reference_price_view")
    .select("parent_sku,price_per_75cl_p,resolution_kind,source_kind,reference_date,date_meaning,needs_review,has_competing_evidence")
    .in("parent_sku", parentSkus);
  // Private reference enrichment never suppresses the public catalogue result.
  if (referenceError) return { rows: mergeReferencePrices(rows, []), count: count ?? 0 };
  return {
    rows: mergeReferencePrices(rows, (referenceData ?? []) as ReferencePriceRow[]),
    count: count ?? 0,
  };
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
