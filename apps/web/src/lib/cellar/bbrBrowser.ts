import type { Database } from "@/lib/database.types";

export type BbrCellarRow =
  Database["public"]["Views"]["bbr_cellar_market_view"]["Row"];

export type CellarSortField =
  | "wine"
  | "region"
  | "vintage"
  | "quantity_bottles"
  | "maturity"
  | "purchase_price_per_case_p"
  | "highest_bid_p"
  | "lowest_ask_p"
  | "last_rest_checked_at";

export type CellarQuery = {
  search: string;
  region: string;
  colour: string;
  maturity: string;
  vintageMin?: number;
  vintageMax?: number;
  eligibility: "any" | "eligible" | "not-eligible";
  listing: "any" | "listed" | "unlisted";
  bid: "any" | "has-bid" | "no-bid";
  sort: {
    field: CellarSortField;
    dir: "asc" | "desc";
  };
};

const SORT_FIELDS = new Set<CellarSortField>([
  "wine",
  "region",
  "vintage",
  "quantity_bottles",
  "maturity",
  "purchase_price_per_case_p",
  "highest_bid_p",
  "lowest_ask_p",
  "last_rest_checked_at",
]);

function optionalInteger(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export function parseCellarQuery(params: URLSearchParams): CellarQuery {
  let vintageMin = optionalInteger(params.get("vintage_min"));
  let vintageMax = optionalInteger(params.get("vintage_max"));
  if (
    vintageMin !== undefined
    && vintageMax !== undefined
    && vintageMin > vintageMax
  ) {
    [vintageMin, vintageMax] = [vintageMax, vintageMin];
  }

  const eligibilityParam = params.get("eligibility");
  const listingParam = params.get("listing");
  const bidParam = params.get("bid");
  const sortParam = params.get("sort");
  const [sortField, sortDir] = sortParam?.split(":") ?? [];

  return {
    search: params.get("q")?.trim() ?? "",
    region: params.get("region") ?? "",
    colour: params.get("colour") ?? "",
    maturity: params.get("maturity") ?? "",
    vintageMin,
    vintageMax,
    eligibility:
      eligibilityParam === "eligible" || eligibilityParam === "not-eligible"
        ? eligibilityParam
        : "any",
    listing:
      listingParam === "listed" || listingParam === "unlisted"
        ? listingParam
        : "any",
    bid:
      bidParam === "has-bid" || bidParam === "no-bid"
        ? bidParam
        : "any",
    sort: {
      field: SORT_FIELDS.has(sortField as CellarSortField)
        ? sortField as CellarSortField
        : "wine",
      dir: sortDir === "desc" ? "desc" : "asc",
    },
  };
}

function wineName(row: BbrCellarRow): string {
  return row.catalogue_name ?? row.description ?? row.parent_sku ?? "";
}

function includesSearch(row: BbrCellarRow, search: string): boolean {
  if (!search) return true;
  const term = search.toLocaleLowerCase("en-GB");
  return [
    row.description,
    row.catalogue_name,
    row.producer,
    row.parent_sku,
  ].some((value) => value?.toLocaleLowerCase("en-GB").includes(term));
}

function compareNullable(
  left: string | number | null,
  right: string | number | null,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right), "en-GB", {
    sensitivity: "base",
    numeric: true,
  });
}

function sortValue(
  row: BbrCellarRow,
  field: CellarSortField,
): string | number | null {
  switch (field) {
    case "wine":
      return wineName(row);
    case "region":
      return row.region;
    case "vintage":
      return row.vintage;
    case "quantity_bottles":
      return row.quantity_bottles;
    case "maturity":
      return row.maturity;
    case "purchase_price_per_case_p":
      return row.purchase_price_per_case_p;
    case "highest_bid_p":
      return row.highest_bid_p;
    case "lowest_ask_p":
      return row.lowest_ask_p;
    case "last_rest_checked_at":
      return row.last_rest_checked_at;
  }
}

export function filterAndSortCellarRows(
  rows: BbrCellarRow[],
  query: CellarQuery,
): BbrCellarRow[] {
  const filtered = rows.filter((row) => {
    if (!includesSearch(row, query.search)) return false;
    if (query.region && row.region !== query.region) return false;
    if (query.colour && row.colour !== query.colour) return false;
    if (query.maturity && row.maturity !== query.maturity) return false;
    if (
      query.vintageMin !== undefined
      && (row.vintage === null || row.vintage < query.vintageMin)
    ) return false;
    if (
      query.vintageMax !== undefined
      && (row.vintage === null || row.vintage > query.vintageMax)
    ) return false;
    if (query.eligibility === "eligible" && row.eligible_for_bbx !== true) {
      return false;
    }
    if (
      query.eligibility === "not-eligible"
      && row.eligible_for_bbx !== false
    ) return false;
    if (query.listing === "listed" && row.is_listed !== true) return false;
    if (query.listing === "unlisted" && row.is_listed !== false) return false;
    if (query.bid === "has-bid" && row.highest_bid_p === null) return false;
    if (query.bid === "no-bid" && row.highest_bid_p !== null) return false;
    return true;
  });

  return filtered.sort((left, right) => {
    const leftValue = sortValue(left, query.sort.field);
    const rightValue = sortValue(right, query.sort.field);
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;
    const primary = compareNullable(
      leftValue,
      rightValue,
    );
    if (primary !== 0) {
      return query.sort.dir === "asc" ? primary : -primary;
    }

    const name = compareNullable(wineName(left), wineName(right));
    if (name !== 0) return name;
    const vintage = compareNullable(left.vintage, right.vintage);
    if (vintage !== 0) return vintage;
    return compareNullable(left.format_code, right.format_code);
  });
}

export function lowestAskLabel(row: BbrCellarRow): string | null {
  if (row.is_listed === false) return "Unlisted";
  if (row.is_listed === null) return "Market unavailable";
  if (row.lowest_ask_p === null) return "Price unavailable";
  return null;
}
