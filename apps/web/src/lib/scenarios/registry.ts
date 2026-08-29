import type { FilterKind, FilterMeta } from "@/lib/query/registry";

// Filterable fields over wine_scenario_view. Same machine-readable shape as
// CATALOGUE_FILTERS (docs/WINE-RECORD-SPEC.md §12): this registry is the single
// contract the scenario builder, the stored definition validator and — later —
// the agent all read. Enum options for region/colour/… are dynamic (not fixed
// here); anchor_status is the one closed enum.
export const SCENARIO_FILTERS = {
  search: {
    field: "search", label: "Search", group: "Wine", kind: "text", estimate: false,
    explanation: "Matches wine name or producer (partial, case-insensitive).",
  },
  region: {
    field: "region", label: "Region", group: "Wine", kind: "enum", estimate: false,
    explanation: "Wine region (exact; comma-separate several).",
  },
  country: {
    field: "country", label: "Country", group: "Wine", kind: "enum", estimate: false,
    explanation: "Country of origin (exact; comma-separate several).",
  },
  colour: {
    field: "colour", label: "Colour", group: "Wine", kind: "enum", estimate: false,
    explanation: "Wine colour (exact; comma-separate several).",
  },
  vintage: {
    field: "vintage", label: "Vintage", group: "Wine", kind: "enum", estimate: false,
    explanation: "Vintage year (exact; comma-separate several).",
  },
  format_code: {
    field: "format_code", label: "Format", group: "Format", kind: "enum", estimate: false,
    explanation: "Exact format code, e.g. 06-00750 (comma-separate several).",
  },
  is_listed: {
    field: "is_listed", label: "Listed", group: "Format", kind: "boolean", estimate: false,
    explanation: "Whether the format currently has a live ask on BBX.",
  },
  is_biddable: {
    field: "is_biddable", label: "Biddable", group: "Wine", kind: "boolean", estimate: false,
    explanation: "Whether the wine is in BBX's biddable universe. The view is not scoped to biddable wines, so add this filter to limit a scenario to them.",
  },
  anchor_status: {
    field: "anchor_status", label: "Anchor", group: "Price", kind: "enum", estimate: false,
    explanation: "Release-anchor provenance: owner, confirmed or provisional.",
  },
  lowest_ask_p: {
    field: "lowest_ask_p", label: "Ask", group: "Price", kind: "range", units: "pence / case", estimate: false,
    explanation: "Lowest current listing price, per case, in pence, as of the last scan. The results table shows this per 75cl in pounds.",
  },
  release_price_p: {
    field: "release_price_p", label: "Release price", group: "Price", kind: "range", units: "pence / case", estimate: false,
    explanation: "Resolved release anchor (owner ahead of imported), per case, in pence.",
  },
  ask_vs_release_pct: {
    field: "ask_vs_release_pct", label: "Ask vs release", group: "Price", kind: "range", units: "%", estimate: false,
    explanation: "Ask vs the release anchor. Negative means below release.",
  },
  bid_vs_release_pct: {
    field: "bid_vs_release_pct", label: "Bid vs release", group: "Price", kind: "range", units: "%", estimate: false,
    explanation: "Highest bid vs the release anchor.",
  },
  price_vs_market_pct: {
    field: "price_vs_market_pct", label: "Ask vs market", group: "Price", kind: "range", units: "%", estimate: false,
    explanation: "Ask vs BBX market price. Negative means ask is cheaper than market.",
  },
  price_vs_last_pct: {
    field: "price_vs_last_pct", label: "Ask vs last tx", group: "Price", kind: "range", units: "%", estimate: false,
    explanation: "Ask vs the last recorded transaction price. Negative means cheaper.",
  },
} as const satisfies Record<string, FilterMeta>;

export type ScenarioFilterField = keyof typeof SCENARIO_FILTERS;

export function scenarioFilterKind(field: ScenarioFilterField): FilterKind {
  return SCENARIO_FILTERS[field].kind;
}

export const SCENARIO_ANCHOR_STATUSES = ["owner", "confirmed", "provisional"] as const;

// Sortable columns on wine_scenario_view.
export const SCENARIO_SORT_FIELDS = [
  "ask_vs_release_pct",
  "bid_vs_release_pct",
  "price_vs_market_pct",
  "price_vs_last_pct",
  "lowest_ask_p",
  "highest_bid_p",
  "market_price_p",
  "release_price_p",
  "vintage",
  "name",
] as const;

export type ScenarioSortField = (typeof SCENARIO_SORT_FIELDS)[number];

export const SCENARIO_SORT_LABELS: Record<ScenarioSortField, string> = {
  ask_vs_release_pct: "Ask vs release",
  bid_vs_release_pct: "Bid vs release",
  price_vs_market_pct: "Ask vs market",
  price_vs_last_pct: "Ask vs last tx",
  lowest_ask_p: "Ask",
  highest_bid_p: "Highest bid",
  market_price_p: "Market",
  release_price_p: "Release price",
  vintage: "Vintage",
  name: "Wine name",
};
