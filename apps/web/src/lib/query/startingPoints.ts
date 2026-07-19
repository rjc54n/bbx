import type { QueryMode, QueryState } from "./types";

export interface StartingPoint {
  mode: QueryMode;
  label: string;
  description: string;
  initialState: QueryState;
}

// Each entry point sets only the filters/sort expressing its intent -- these
// are starting points a user can freely adjust, sort and save, never fixed
// policies. In particular, value-research imposes no hard-coded discount
// threshold: it just surfaces the price_vs_* controls and sorts to put the
// biggest discount to market first.
export const STARTING_POINTS: StartingPoint[] = [
  {
    mode: "explore",
    label: "Explore catalogue",
    description: "Browse the full active BBX catalogue. No price constraints.",
    initialState: {
      mode: "explore",
      filters: [],
      sort: { field: "last_seen_at", dir: "desc" },
      page: 0,
    },
  },
  {
    mode: "value-research",
    label: "Value research",
    description:
      "Compare ask against market, last-transaction and next-offer references. No fixed discount threshold.",
    initialState: {
      mode: "value-research",
      filters: [],
      sort: { field: "price_vs_market_pct", dir: "asc" },
      page: 0,
    },
  },
  {
    mode: "recent-listings",
    label: "Recent listings",
    description: "Newest SKUs to appear in the catalogue.",
    initialState: {
      mode: "recent-listings",
      filters: [],
      sort: { field: "first_seen_at", dir: "desc" },
      page: 0,
    },
  },
  {
    mode: "price-changes",
    label: "Price changes",
    description: "Most recent price-change events across active SKUs.",
    initialState: {
      mode: "price-changes",
      filters: [],
      sort: { field: "observed_at", dir: "desc" },
      page: 0,
    },
  },
];

export function startingPointFor(mode: QueryMode): StartingPoint {
  return STARTING_POINTS.find((sp) => sp.mode === mode) ?? STARTING_POINTS[0];
}
