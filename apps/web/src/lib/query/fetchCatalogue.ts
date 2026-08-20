import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { applyFilters, buildSearchOrFilter, type AppliedFilter } from "./applyFilters";
import type { CatalogueQueryState, PriceChangeQueryState } from "./types";
import type { CatalogueRow, PriceChangeRow } from "./rows";

// Re-exported so existing importers (and their tests) keep their path.
export { buildSearchOrFilter };

export const PAGE_SIZE = 25;

export interface FetchResult<Row> {
  rows: Row[];
  count: number;
}

type ReleasePriceAnchorRow = {
  parent_sku: string | null;
  format_code: string | null;
  release_price_p: number | null;
  anchor_status: string | null;
};

export function mergeReleasePrices(
  rows: DatabaseCatalogueRow[],
  anchors: ReleasePriceAnchorRow[],
): CatalogueRow[] {
  const anchorByKey = new Map(
    anchors
      .filter((anchor): anchor is ReleasePriceAnchorRow & { parent_sku: string; format_code: string } =>
        anchor.parent_sku !== null && anchor.format_code !== null,
      )
      .map((anchor) => [`${anchor.parent_sku}|${anchor.format_code}`, anchor]),
  );
  return rows.map((row) => {
    const anchor = anchorByKey.get(`${row.parent_sku}|${row.format_code}`);
    return {
      ...row,
      release_price_p: anchor?.release_price_p ?? null,
      // anchor_status lets the catalogue mark an owner-set price the same way the
      // wine card and scenarios do.
      anchor_status: anchor?.anchor_status ?? null,
    };
  });
}

type DatabaseCatalogueRow = Database["public"]["Views"]["catalogue_view"]["Row"];

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
  query = applyFilters(query, state.filters as readonly AppliedFilter[]);

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
  const rows = (data ?? []) as DatabaseCatalogueRow[];
  const parentSkus = [...new Set(rows.flatMap((row) => row.parent_sku ? [row.parent_sku] : []))];
  if (parentSkus.length === 0) return { rows: mergeReleasePrices(rows, []), count: count ?? 0 };
  const { data: anchorData, error: anchorError } = await supabase
    // resolved_release_anchor_view ranks an owner-set price above the imported
    // anchor; release_price_anchor_view (imported only) would hide owner prices
    // from the catalogue while every other surface already shows them.
    .from("resolved_release_anchor_view")
    .select("parent_sku, format_code, release_price_p, anchor_status")
    .in("parent_sku", parentSkus);
  // Release evidence enriches the catalogue, but it must never suppress the
  // primary result set if the secondary read is unavailable or its RLS session
  // has not refreshed yet in the browser.
  if (anchorError) return { rows: mergeReleasePrices(rows, []), count: count ?? 0 };
  return {
    rows: mergeReleasePrices(rows, (anchorData ?? []) as ReleasePriceAnchorRow[]),
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
