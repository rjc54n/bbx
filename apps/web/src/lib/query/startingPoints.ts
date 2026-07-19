import type { CatalogueFilterField } from "./registry";
import type { CatalogueMode, CatalogueQueryState, PriceChangeQueryState, QueryMode, QueryState } from "./types";

export interface StartingPoint<S extends QueryState = QueryState> {
  mode: S["mode"];
  label: string;
  description: string;
  initialState: S;
  /**
   * Filter fields this entry point wants surfaced/expanded in the UI by
   * default -- not applied filters, just which controls to put in front of
   * the user. This is how "value research exposes price controls" is
   * data-driven rather than hardcoded into a component.
   */
  suggestedFilters: CatalogueFilterField[];
}

// Each entry point sets only the filters/sort expressing its intent -- these
// are starting points a user can freely adjust, sort and save, never fixed
// policies. In particular, value-research imposes no hard-coded discount
// threshold: initialState.filters is empty, it just surfaces the price_vs_*
// controls (via suggestedFilters) and sorts to put the biggest discount to
// market first.
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
    suggestedFilters: [],
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
    suggestedFilters: ["price_vs_market_pct", "price_vs_last_pct", "price_vs_next_pct"],
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
    suggestedFilters: ["first_seen_at"],
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
    suggestedFilters: [],
  },
];

// Overloaded so a caller with a literal mode (the common case: startingPointFor("explore"))
// gets back a StartingPoint narrowed to that mode's own state shape, instead
// of the full QueryState union -- e.g. .initialState.sort.field is typed as
// PriceChangeSortField, not CatalogueMetricField | PriceChangeSortField. The
// two specific overloads must come before the general QueryMode fallback:
// overload resolution picks the first match, and a literal like "explore" is
// assignable to the general QueryMode too, so the specific ones need first
// refusal. A non-literal `mode: QueryMode` variable (e.g. from url.ts's
// parse(), where the mode came off a URL param at runtime) falls through to
// the general overload.
export function startingPointFor(mode: CatalogueMode): StartingPoint<CatalogueQueryState>;
export function startingPointFor(mode: "price-changes"): StartingPoint<PriceChangeQueryState>;
export function startingPointFor(mode: QueryMode): StartingPoint;
export function startingPointFor(mode: QueryMode): StartingPoint {
  return STARTING_POINTS.find((sp) => sp.mode === mode) ?? STARTING_POINTS[0];
}
