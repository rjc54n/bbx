// Query state for the Favourites tab, in the same shape as the release-price
// and BBR cellar browsers: parsed from the URL so a view is shareable and
// survives a refresh(), filtered and sorted in memory because the favourite
// set is small by nature.

export type FavouriteWineRow = {
  parent_sku: string;
  favourited_at: string | null;
  wine_name: string | null;
  vintage: number | null;
  producer: string | null;
  country: string | null;
  region: string | null;
  subregion: string | null;
  colour: string | null;
  product_url: string | null;
  in_tracked_catalogue: boolean | null;
  format_count: number | null;
  listed_format_count: number | null;
  lowest_ask_per_bottle_p: number | null;
  highest_bid_per_bottle_p: number | null;
  guide_per_bottle_p: number | null;
  adjusted_guide_per_bottle_p: number | null;
  latest_release_offer_date: string | null;
  latest_release_price_per_bottle_p: number | null;
  anchor_status: string | null;
  ask_vs_release_pct: number | null;
  bid_vs_release_pct: number | null;
  cellartracker_bottles_home: number | null;
  cellartracker_bottles_bbr: number | null;
  cellartracker_paid_per_bottle_p: number | null;
  cellartracker_record_count: number | null;
  bbr_cellar_bottles: number | null;
  bbr_cellar_holding_count: number | null;
  release_offer_record_count: number | null;
};

export type PendingFavouriteRow = {
  source: string;
  match_group_key: string;
  favourited_at: string | null;
  source_wine: string | null;
  vintage: number | null;
  producer: string | null;
  record_count: number | null;
  bottles: number | null;
  latest_offer_date: string | null;
  suggestion_count: number | null;
  is_stale: boolean | null;
};

export type FavouriteSortField =
  | "favourited_at"
  | "wine"
  | "vintage"
  | "held"
  | "lowest_ask_per_bottle_p"
  | "highest_bid_per_bottle_p"
  | "latest_release_price_per_bottle_p"
  | "ask_vs_release_pct";

export type FavouriteQuery = {
  search: string;
  held: "" | "yes" | "no";
  ask: "" | "yes" | "no";
  listing: "" | "listed" | "unlisted";
  tracked: "" | "yes" | "no";
  sort: { field: FavouriteSortField; dir: "asc" | "desc" };
};

const sortFields = new Set<FavouriteSortField>([
  "favourited_at", "wine", "vintage", "held", "lowest_ask_per_bottle_p",
  "highest_bid_per_bottle_p", "latest_release_price_per_bottle_p", "ask_vs_release_pct",
]);

/**
 * CellarTracker's BBR quantity and the BBR cellar holdings describe the same
 * bottles from two sources, so "held" takes the larger rather than the sum --
 * adding them would double count anything stored at BBR.
 */
export function heldBottles(row: FavouriteWineRow): number {
  const atHome = row.cellartracker_bottles_home ?? 0;
  // The overlap: CellarTracker's BBR quantity and the BBR cellar holdings are
  // the same physical bottles. Take whichever source reports more rather than
  // adding them, and treat a source that says nothing as not disagreeing.
  const atBbr = Math.max(row.cellartracker_bottles_bbr ?? 0, row.bbr_cellar_bottles ?? 0);
  return atHome + atBbr;
}

export function parseFavouriteQuery(params: URLSearchParams): FavouriteQuery {
  const [rawField, rawDir] = (params.get("sort") ?? "favourited_at:desc").split(":");
  const field = sortFields.has(rawField as FavouriteSortField)
    ? rawField as FavouriteSortField
    : "favourited_at";
  const triple = (name: string): "" | "yes" | "no" => {
    const value = params.get(name);
    return value === "yes" || value === "no" ? value : "";
  };
  return {
    search: (params.get("q") ?? "").trim(),
    held: triple("held"),
    ask: triple("ask"),
    listing: params.get("listing") === "listed" || params.get("listing") === "unlisted"
      ? params.get("listing") as "listed" | "unlisted"
      : "",
    tracked: triple("tracked"),
    // Most recently favourited first: the tab is a working set, and the wine
    // you just starred is the one you want to see.
    sort: { field, dir: rawDir === "asc" ? "asc" : "desc" },
  };
}

export function serializeFavouriteQuery(query: FavouriteQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  if (query.held) params.set("held", query.held);
  if (query.ask) params.set("ask", query.ask);
  if (query.listing) params.set("listing", query.listing);
  if (query.tracked) params.set("tracked", query.tracked);
  if (query.sort.field !== "favourited_at" || query.sort.dir !== "desc") {
    params.set("sort", `${query.sort.field}:${query.sort.dir}`);
  }
  return params;
}

function comparable(row: FavouriteWineRow, field: FavouriteSortField): string | number | null {
  if (field === "wine") return row.wine_name;
  if (field === "held") return heldBottles(row);
  return row[field];
}

export function filterAndSortFavourites(
  rows: FavouriteWineRow[],
  query: FavouriteQuery,
): FavouriteWineRow[] {
  const search = query.search.toLocaleLowerCase("en-GB");
  return rows.filter((row) => {
    const searchable = [row.wine_name, row.producer, row.region, row.parent_sku]
      .filter(Boolean).join(" ").toLocaleLowerCase("en-GB");
    if (search && !searchable.includes(search)) return false;
    const held = heldBottles(row);
    if (query.held === "yes" && held === 0) return false;
    if (query.held === "no" && held > 0) return false;
    if (query.ask === "yes" && row.lowest_ask_per_bottle_p === null) return false;
    if (query.ask === "no" && row.lowest_ask_per_bottle_p !== null) return false;
    if (query.listing === "listed" && (row.listed_format_count ?? 0) === 0) return false;
    if (query.listing === "unlisted" && (row.listed_format_count ?? 0) > 0) return false;
    if (query.tracked === "yes" && row.in_tracked_catalogue !== true) return false;
    if (query.tracked === "no" && row.in_tracked_catalogue === true) return false;
    return true;
  }).sort((left, right) => {
    const leftValue = comparable(left, query.sort.field);
    const rightValue = comparable(right, query.sort.field);
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;
    let comparison = 0;
    if (typeof leftValue === "number" && typeof rightValue === "number") comparison = leftValue - rightValue;
    else comparison = String(leftValue ?? "").localeCompare(String(rightValue ?? ""), "en-GB", { sensitivity: "base", numeric: true });
    if (comparison === 0) comparison = left.parent_sku.localeCompare(right.parent_sku, "en-GB", { numeric: true });
    return query.sort.dir === "asc" ? comparison : -comparison;
  });
}

/** Which sources hold a linked record for this wine, for the provenance chips. */
export function sourceChips(row: FavouriteWineRow): string[] {
  const chips: string[] = [];
  if (row.in_tracked_catalogue) chips.push("Catalogue");
  if ((row.release_offer_record_count ?? 0) > 0) chips.push("Release");
  if ((row.cellartracker_record_count ?? 0) > 0) chips.push("CellarTracker");
  if ((row.bbr_cellar_holding_count ?? 0) > 0) chips.push("BBR cellar");
  return chips;
}

/**
 * A favourite with no linked record anywhere. Usually a corrected mis-link:
 * the edit favourites the new wine and leaves this one, deliberately, rather
 * than un-favouriting on the owner's behalf.
 */
export function isOrphan(row: FavouriteWineRow): boolean {
  return sourceChips(row).length === 0;
}
