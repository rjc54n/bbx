import type { FilterKind, FilterMeta } from "@/lib/query/registry";

// Filterable fields over the current and legacy scenario views. Same machine-readable shape as
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
    explanation: "Whether the wine is in BBX's biddable universe. Current market rows come from tracked BBX formats.",
  },
  anchor_status: {
    field: "anchor_status", label: "Legacy release status", group: "Price", kind: "enum", estimate: false,
    explanation: "Retained while saved release scenarios are converted.",
  },
  lowest_ask_per_75cl_p: {
    field: "lowest_ask_per_75cl_p", label: "Ask", group: "Price", kind: "range", type: "money", nullable: true, units: "£ / 75cl", estimate: false,
    explanation: "Lowest current listing price, per 75cl-equivalent bottle, as of the last scan.",
  },
  release_price_per_75cl_p: {
    field: "release_price_per_75cl_p", label: "Legacy release price", group: "Price", kind: "range", type: "money", nullable: true, units: "£ / 75cl", estimate: false,
    explanation: "Retained while saved release scenarios are converted.",
  },
  ask_vs_release_pct: {
    field: "ask_vs_release_pct", label: "Legacy ask vs release", group: "Price", kind: "range", type: "percent", nullable: true, units: "%", estimate: false,
    explanation: "Retained while saved release scenarios are converted.",
  },
  bid_vs_release_pct: {
    field: "bid_vs_release_pct", label: "Legacy bid vs release", group: "Price", kind: "range", type: "percent", nullable: true, units: "%", estimate: false,
    explanation: "Retained while saved release scenarios are converted.",
  },
  reference_price_per_75cl_p: {
    field: "reference_price_per_75cl_p", label: "Historic reference", group: "Price", kind: "range", type: "money", nullable: true, units: "£ / 75 cl", estimate: false,
    explanation: "Historic in-bond benchmark per 75 cl bottle. Available only for 75 cl formats.",
  },
  ask_vs_reference_pct: {
    field: "ask_vs_reference_pct", label: "Ask vs reference", group: "Price", kind: "range", type: "percent", nullable: true, units: "%", estimate: false,
    explanation: "Current ask compared with the historic reference. Negative means the ask is lower.",
  },
  bid_vs_reference_pct: {
    field: "bid_vs_reference_pct", label: "Bid vs reference", group: "Price", kind: "range", type: "percent", nullable: true, units: "%", estimate: false,
    explanation: "Highest bid compared with the historic reference. Requires a live bid.",
  },
  price_vs_market_pct: {
    field: "price_vs_market_pct", label: "Ask vs market", group: "Price", kind: "range", type: "percent", nullable: true, units: "%", estimate: false,
    explanation: "Ask vs BBX market price. Negative means ask is cheaper than market.",
  },
  price_vs_last_pct: {
    field: "price_vs_last_pct", label: "Ask vs last tx", group: "Price", kind: "range", type: "percent", nullable: true, units: "%", estimate: false,
    explanation: "Ask vs the last recorded transaction price. Negative means cheaper.",
  },
} as const satisfies Record<string, FilterMeta>;

export type ScenarioFilterField = keyof typeof SCENARIO_FILTERS;

export function scenarioFilterKind(field: ScenarioFilterField): FilterKind {
  return SCENARIO_FILTERS[field].kind;
}

export const SCENARIO_ANCHOR_STATUSES = ["owner", "confirmed", "provisional"] as const;
export const LEGACY_SCENARIO_FIELDS = new Set(["anchor_status", "release_price_per_75cl_p", "ask_vs_release_pct", "bid_vs_release_pct"]);

// Sortable columns on wine_scenario_view.
export const SCENARIO_SORT_FIELDS = [
  "ask_vs_reference_pct",
  "bid_vs_reference_pct",
  "ask_vs_release_pct",
  "bid_vs_release_pct",
  "price_vs_market_pct",
  "price_vs_last_pct",
  "lowest_ask_per_75cl_p",
  "highest_bid_per_75cl_p",
  "market_price_per_75cl_p",
  "release_price_per_75cl_p",
  "reference_price_per_75cl_p",
  "vintage",
  "name",
] as const;

export type ScenarioSortField = (typeof SCENARIO_SORT_FIELDS)[number];

export const SCENARIO_SORT_LABELS: Record<ScenarioSortField, string> = {
  ask_vs_reference_pct: "Ask vs reference",
  bid_vs_reference_pct: "Bid vs reference",
  ask_vs_release_pct: "Legacy ask vs release",
  bid_vs_release_pct: "Legacy bid vs release",
  price_vs_market_pct: "Ask vs market",
  price_vs_last_pct: "Ask vs last tx",
  lowest_ask_per_75cl_p: "Ask",
  highest_bid_per_75cl_p: "Highest bid",
  market_price_per_75cl_p: "Market",
  release_price_per_75cl_p: "Legacy release price",
  reference_price_per_75cl_p: "Historic reference",
  vintage: "Vintage",
  name: "Wine name",
};
