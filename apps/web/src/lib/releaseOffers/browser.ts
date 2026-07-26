export type ReleasePriceRow = {
  parent_sku: string;
  format_code: string;
  anchor_status: string;
  release_offer_price_id: number;
  offer_date: string;
  release_price_p: number;
  source_wine: string;
  source_product_url: string | null;
  name: string | null;
  vintage: number | null;
  region: string | null;
  colour: string | null;
  producer: string | null;
  product_url: string | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  is_listed: boolean | null;
  lowest_ask_p: number | null;
  highest_bid_p: number | null;
  market_price_p: number | null;
  last_rest_checked_at: string | null;
  ask_vs_release_p: number | null;
  ask_vs_release_pct: number | null;
  bid_vs_release_p: number | null;
  bid_vs_release_pct: number | null;
  seller_net_highest_bid_p: number | null;
  recoup_bid_p: number;
  seller_commission_rate: number;
};

export type ReleaseSortField = "wine" | "vintage" | "offer_date" | "release_price_p" | "lowest_ask_p" | "highest_bid_p" | "ask_vs_release_pct" | "last_rest_checked_at";

export type ReleasePriceQuery = {
  search: string;
  region: string;
  format: string;
  anchor: "" | "provisional" | "confirmed";
  listing: "" | "listed" | "unlisted";
  bid: "" | "yes" | "no";
  below: "" | "yes" | "no";
  vintageMin: number | null;
  vintageMax: number | null;
  sort: { field: ReleaseSortField; dir: "asc" | "desc" };
};

const sortFields = new Set<ReleaseSortField>([
  "wine", "vintage", "offer_date", "release_price_p", "lowest_ask_p",
  "highest_bid_p", "ask_vs_release_pct", "last_rest_checked_at",
]);

function integer(value: string | null): number | null {
  if (!value || !/^\d{4}$/.test(value)) return null;
  return Number(value);
}

export function parseReleasePriceQuery(params: URLSearchParams): ReleasePriceQuery {
  const [rawField, rawDir] = (params.get("sort") ?? "wine:asc").split(":");
  const field = sortFields.has(rawField as ReleaseSortField)
    ? rawField as ReleaseSortField
    : "wine";
  return {
    search: (params.get("q") ?? "").trim(),
    region: params.get("region") ?? "",
    format: params.get("format") ?? "",
    anchor: params.get("anchor") === "confirmed" || params.get("anchor") === "provisional" ? params.get("anchor") as "confirmed" | "provisional" : "",
    listing: params.get("listing") === "listed" || params.get("listing") === "unlisted" ? params.get("listing") as "listed" | "unlisted" : "",
    bid: params.get("bid") === "yes" || params.get("bid") === "no" ? params.get("bid") as "yes" | "no" : "",
    below: params.get("below") === "yes" || params.get("below") === "no" ? params.get("below") as "yes" | "no" : "",
    vintageMin: integer(params.get("vintage_min")),
    vintageMax: integer(params.get("vintage_max")),
    sort: { field, dir: rawDir === "desc" ? "desc" : "asc" },
  };
}

function comparable(row: ReleasePriceRow, field: ReleaseSortField): string | number | null {
  if (field === "wine") return row.name ?? row.source_wine;
  return row[field];
}

export function filterAndSortReleasePrices(
  rows: ReleasePriceRow[],
  query: ReleasePriceQuery,
): ReleasePriceRow[] {
  const search = query.search.toLocaleLowerCase("en-GB");
  return rows.filter((row) => {
    const searchable = [row.name, row.source_wine, row.producer, row.parent_sku]
      .filter(Boolean).join(" ").toLocaleLowerCase("en-GB");
    if (search && !searchable.includes(search)) return false;
    if (query.region && row.region !== query.region) return false;
    if (query.format && row.format_code !== query.format) return false;
    if (query.anchor && row.anchor_status !== query.anchor) return false;
    if (query.listing === "listed" && row.is_listed !== true) return false;
    if (query.listing === "unlisted" && row.is_listed !== false) return false;
    if (query.bid === "yes" && row.highest_bid_p === null) return false;
    if (query.bid === "no" && row.highest_bid_p !== null) return false;
    if (query.below === "yes" && !(row.lowest_ask_p !== null && row.lowest_ask_p < row.release_price_p)) return false;
    if (query.below === "no" && row.lowest_ask_p !== null && row.lowest_ask_p < row.release_price_p) return false;
    if (query.vintageMin !== null && (row.vintage === null || row.vintage < query.vintageMin)) return false;
    if (query.vintageMax !== null && (row.vintage === null || row.vintage > query.vintageMax)) return false;
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
