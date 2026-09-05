import type { Database } from "@/lib/database.types";
import { formatPence } from "@/lib/format";

export type BbrCellarRow =
  Database["public"]["Views"]["bbr_cellar_positions_market_view"]["Row"];

export type CellarSortField =
  | "wine"
  | "membership"
  | "region"
  | "vintage"
  | "quantity_bottles"
  | "maturity"
  | "first_seen"
  | "last_seen"
  | "reported_price"
  | "highest_bid_p"
  | "lowest_ask_p"
  | "ask_premium_p"
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
  /** D7: `current` when the `Current holdings only` box is ticked; `all`
   * otherwise, and `all` is never written to the URL. */
  holdings: "all" | "current";
  sort: {
    field: CellarSortField;
    dir: "asc" | "desc";
  };
};

const SORT_FIELDS = new Set<CellarSortField>([
  "wine",
  "membership",
  "region",
  "vintage",
  "quantity_bottles",
  "maturity",
  "first_seen",
  "last_seen",
  "reported_price",
  "highest_bid_p",
  "lowest_ask_p",
  "ask_premium_p",
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
    holdings: params.get("holdings") === "current" ? "current" : "all",
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

/** Ordering rank for the tri-state membership: current holdings first, former
 * next, an un-nominated database last. Keeps a `membership` sort grouped rather
 * than alphabetical (`current` < `former` < `unknown` alphabetically anyway,
 * but this stays correct if the labels ever change). */
function membershipRank(membership: string | null): number {
  switch (membership) {
    case "current":
      return 0;
    case "former":
      return 1;
    case "unknown":
      return 2;
    default:
      return 3;
  }
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
    case "membership":
      return membershipRank(row.membership);
    case "region":
      return row.region;
    case "vintage":
      return row.vintage;
    case "quantity_bottles":
      return row.current_quantity_bottles;
    case "maturity":
      return row.maturity;
    case "first_seen":
      return row.first_seen;
    case "last_seen":
      return row.last_seen;
    case "reported_price":
      return row.reported_price_min_p;
    case "highest_bid_p":
      return row.highest_bid_p;
    case "lowest_ask_p":
      return row.lowest_ask_p;
    case "ask_premium_p":
      return askPremiumP(row);
    case "last_rest_checked_at":
      return row.last_rest_checked_at;
  }
}

export function filterAndSortCellarRows(
  rows: BbrCellarRow[],
  query: CellarQuery,
): BbrCellarRow[] {
  const filtered = rows.filter((row) => {
    if (query.holdings === "current" && row.membership !== "current") {
      return false;
    }
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

/** Lowest ask minus the most recently reported purchase case price; negative
 * means a discount to the owner's own reported price. A position with a
 * reported-price range is measured against its latest observation. */
export function askPremiumP(row: BbrCellarRow): number | null {
  if (
    row.lowest_ask_p === null
    || row.latest_purchase_price_per_case_p === null
  ) {
    return null;
  }
  return row.lowest_ask_p - row.latest_purchase_price_per_case_p;
}

/** One reported purchase price when the observed range holds a single value, a
 * range otherwise (spec §6.7–6.8). `–` when nothing was ever reported. */
export function reportedPriceLabel(row: BbrCellarRow): string {
  const min = row.reported_price_min_p;
  const max = row.reported_price_max_p;
  if (min === null && max === null) return "–";
  if (min === max) return formatPence(min);
  return `${formatPence(min)}–${formatPence(max)}`;
}

/** Current bottle count for the position: the nominated quantity, `0` for a
 * former position, and `Not nominated` when no current snapshot exists (D8 --
 * the view carries NULL, not zero, in that state). */
export function currentBottlesLabel(row: BbrCellarRow): string {
  if (row.current_quantity_bottles === null) return "Not nominated";
  return String(row.current_quantity_bottles);
}

/** Whether any current snapshot is nominated. False for an empty set and for a
 * set in which every position is `unknown`. */
export function hasNomination(rows: BbrCellarRow[]): boolean {
  return rows.some((row) => row.membership !== "unknown");
}

/** Current positions and current bottles over whatever rows are passed. Only
 * `membership === 'current'` rows count, and only their
 * `current_quantity_bottles` are summed, so former and unknown rows contribute
 * nothing. The caller passes the filtered rows (owner decision, 5 Sep 2026):
 * facet and search filters narrow these figures; the `Current holdings only`
 * filter does not, since it only removes rows that already contribute zero. */
export function currentTotals(
  rows: BbrCellarRow[],
): { positions: number; bottles: number } {
  let positions = 0;
  let bottles = 0;
  for (const row of rows) {
    if (row.membership !== "current") continue;
    positions += 1;
    bottles += row.current_quantity_bottles ?? 0;
  }
  return { positions, bottles };
}
