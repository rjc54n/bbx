// Machine-readable filter/metric metadata. This drives the filter UI (Phase D)
// and is the seam a later chatbot interface reads to propose/explain the same
// filters the UI uses -- see docs/PHASE2-catalogue-browser.md Phase B.
//
// CATALOGUE_FILTERS/CATALOGUE_METRICS/PRICE_CHANGE_METRICS are declared
// `as const satisfies Record<...>` so their keys and each entry's `kind`
// stay literal types -- types.ts derives CatalogueFilterField, the
// field<->kind mapping, and the sortable-field unions straight from these
// objects instead of redeclaring the field list by hand.

export type FilterGroup = "Wine" | "Format" | "Price" | "Freshness";
export type FilterKind = "enum" | "range" | "text" | "date" | "typeahead";

export interface FilterMeta {
  field: string;
  label: string;
  group: FilterGroup;
  kind: FilterKind;
  units?: string;
  min?: number;
  max?: number;
  /** True when the underlying value is a stored estimate, not a live/observed fact. */
  estimate: boolean;
  explanation: string;
  /** For kind: "typeahead" -- the RPC that backs the async lookup. */
  rpc?: string;
}

export interface MetricMeta {
  field: string;
  label: string;
  units?: string;
  min?: number;
  max?: number;
  estimate: boolean;
  explanation: string;
}

// Filterable fields over catalogue_view (explore / value-research / recent-listings
// modes). price-changes mode reads recent_price_change_view and has no filters
// of its own yet.
//
// "search" and "producer" are both text-shaped but resolve differently:
// search is a partial ilike across name+producer with no backing RPC; producer
// is an exact match, chosen from the search_producers typeahead (Phase A) --
// hence its own "typeahead" kind rather than reusing "text".
export const CATALOGUE_FILTERS = {
  search: {
    field: "search",
    label: "Search",
    group: "Wine",
    kind: "text",
    estimate: false,
    explanation: "Matches wine name or producer (partial, case-insensitive).",
  },
  producer: {
    field: "producer",
    label: "Producer",
    group: "Wine",
    kind: "typeahead",
    rpc: "search_producers",
    estimate: false,
    explanation: "Exact producer, chosen from the producer typeahead.",
  },
  region: {
    field: "region",
    label: "Region",
    group: "Wine",
    kind: "enum",
    estimate: false,
    explanation: "Wine region.",
  },
  subregion: {
    field: "subregion",
    label: "Subregion",
    group: "Wine",
    kind: "enum",
    estimate: false,
    explanation: "Wine subregion.",
  },
  country: {
    field: "country",
    label: "Country",
    group: "Wine",
    kind: "enum",
    estimate: false,
    explanation: "Country of origin.",
  },
  colour: {
    field: "colour",
    label: "Colour",
    group: "Wine",
    kind: "enum",
    estimate: false,
    explanation: "Wine colour.",
  },
  vintage: {
    field: "vintage",
    label: "Vintage",
    group: "Wine",
    kind: "range",
    estimate: false,
    explanation: "Vintage year.",
  },
  case_size: {
    field: "case_size",
    label: "Case size",
    group: "Format",
    kind: "enum",
    units: "bottles",
    estimate: false,
    explanation: "Bottles per case.",
  },
  bottle_volume_ml: {
    field: "bottle_volume_ml",
    label: "Bottle size",
    group: "Format",
    kind: "enum",
    units: "ml",
    estimate: false,
    explanation: "Bottle volume in millilitres.",
  },
  ask: {
    field: "ask",
    label: "Ask",
    group: "Price",
    kind: "range",
    units: "pence",
    estimate: false,
    explanation: "Lowest current listing price, as of the last scan.",
  },
  price_vs_market_pct: {
    field: "price_vs_market_pct",
    label: "Price vs market",
    group: "Price",
    kind: "range",
    units: "%",
    estimate: false,
    explanation: "Ask vs BBX market price. Negative means ask is cheaper than market.",
  },
  price_vs_last_pct: {
    field: "price_vs_last_pct",
    label: "Price vs last transaction",
    group: "Price",
    kind: "range",
    units: "%",
    estimate: false,
    explanation: "Ask vs the last recorded transaction price. Negative means ask is cheaper.",
  },
  price_vs_next_pct: {
    field: "price_vs_next_pct",
    label: "Price vs next offer",
    group: "Price",
    kind: "range",
    units: "%",
    estimate: true,
    explanation:
      "Ask vs the next-cheapest competing offer found in store. Stored estimate as of last scan, not a live order-book check. Negative means ask is cheaper.",
  },
  first_seen_at: {
    field: "first_seen_at",
    label: "First seen",
    group: "Freshness",
    kind: "date",
    estimate: false,
    explanation: "When this SKU was first observed in the catalogue.",
  },
  last_seen_at: {
    field: "last_seen_at",
    label: "Last seen",
    group: "Freshness",
    kind: "date",
    estimate: false,
    explanation: "When this SKU was last observed (most recent scan).",
  },
} as const satisfies Record<string, FilterMeta>;

export type CatalogueFilterField = keyof typeof CATALOGUE_FILTERS;

// Display columns for catalogue_view (explore / value-research / recent-listings),
// superset of CATALOGUE_FILTERS -- includes columns shown in the table that
// aren't independently filterable. Also the set of valid catalogue sort fields.
export const CATALOGUE_METRICS = {
  name: { field: "name", label: "Wine", estimate: false, explanation: "Wine name." },
  vintage: CATALOGUE_FILTERS.vintage,
  country: CATALOGUE_FILTERS.country,
  region: CATALOGUE_FILTERS.region,
  subregion: CATALOGUE_FILTERS.subregion,
  colour: CATALOGUE_FILTERS.colour,
  producer: CATALOGUE_FILTERS.producer,
  case_size: CATALOGUE_FILTERS.case_size,
  bottle_volume_ml: CATALOGUE_FILTERS.bottle_volume_ml,
  ask: CATALOGUE_FILTERS.ask,
  market_price_p: {
    field: "market_price_p",
    label: "Market",
    units: "pence",
    estimate: false,
    explanation: "BBX market price, as of the last scan.",
  },
  last_transaction_p: {
    field: "last_transaction_p",
    label: "Last transaction",
    units: "pence",
    estimate: false,
    explanation: "Price of the last recorded transaction.",
  },
  highest_bid_p: {
    field: "highest_bid_p",
    label: "Highest bid",
    units: "pence",
    estimate: false,
    explanation: "Highest current bid, as of the last scan.",
  },
  next_lowest_price_p: {
    field: "next_lowest_price_p",
    label: "Next offer",
    units: "pence",
    estimate: true,
    explanation:
      "Next-cheapest competing offer found in store. Stored estimate as of last scan, not a live order-book check.",
  },
  qty_available: {
    field: "qty_available",
    label: "Qty",
    estimate: false,
    explanation: "Quantity available at the ask price, as of the last scan.",
  },
  source_agreement: {
    field: "source_agreement",
    label: "Source agreement",
    estimate: false,
    explanation: "Whether stored and live-scanned prices agreed, as of the last check.",
  },
  first_seen_at: CATALOGUE_FILTERS.first_seen_at,
  last_seen_at: CATALOGUE_FILTERS.last_seen_at,
  price_vs_market_pct: CATALOGUE_FILTERS.price_vs_market_pct,
  price_vs_last_pct: CATALOGUE_FILTERS.price_vs_last_pct,
  price_vs_next_pct: CATALOGUE_FILTERS.price_vs_next_pct,
} as const satisfies Record<string, MetricMeta>;

export type CatalogueMetricField = keyof typeof CATALOGUE_METRICS;

// Display columns for recent_price_change_view (price-changes mode). No
// filters of its own in v1 -- see docs/PHASE2-catalogue-browser.md Phase A.
export const PRICE_CHANGE_METRICS = {
  name: CATALOGUE_METRICS.name,
  vintage: CATALOGUE_FILTERS.vintage,
  country: CATALOGUE_FILTERS.country,
  region: CATALOGUE_FILTERS.region,
  subregion: CATALOGUE_FILTERS.subregion,
  colour: CATALOGUE_FILTERS.colour,
  producer: CATALOGUE_FILTERS.producer,
  case_size: CATALOGUE_FILTERS.case_size,
  bottle_volume_ml: CATALOGUE_FILTERS.bottle_volume_ml,
  field_name: {
    field: "field_name",
    label: "Field changed",
    estimate: false,
    explanation: "Which stored price field changed.",
  },
  old_value_raw: {
    field: "old_value_raw",
    label: "Old value",
    estimate: false,
    explanation: "Value before the change.",
  },
  new_value_raw: {
    field: "new_value_raw",
    label: "New value",
    estimate: false,
    explanation: "Value after the change.",
  },
  observed_at: {
    field: "observed_at",
    label: "Changed",
    estimate: false,
    explanation: "When the change was observed.",
  },
} as const satisfies Record<string, MetricMeta>;

export type PriceChangeMetricField = keyof typeof PRICE_CHANGE_METRICS;

// price-changes mode has exactly one meaningful sort dimension in v1.
export const PRICE_CHANGE_SORT_FIELDS = ["observed_at"] as const;
export type PriceChangeSortField = (typeof PRICE_CHANGE_SORT_FIELDS)[number];
