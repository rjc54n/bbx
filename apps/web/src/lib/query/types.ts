import {
  CATALOGUE_FILTERS,
  type CatalogueFilterField,
  type CatalogueMetricField,
  type FilterKind,
  type PriceChangeSortField,
} from "./registry";
import type { ListedDays } from "./freshness";

export type SortDir = "asc" | "desc";

// Fields of the catalogue registry whose `kind` is exactly K. Backs the
// kind-specific Filter interfaces below, so e.g. {field: "region", kind:
// "range"} is a compile error -- region is a "enum" field, not "range".
type FieldsOfKind<K extends FilterKind> = {
  [F in CatalogueFilterField]: (typeof CATALOGUE_FILTERS)[F]["kind"] extends K ? F : never;
}[CatalogueFilterField];

export interface EnumFilter {
  field: FieldsOfKind<"enum">;
  kind: "enum";
  value: string[];
}

export interface RangeFilter {
  field: FieldsOfKind<"range">;
  kind: "range";
  min?: number;
  max?: number;
}

export type DateFilter = {
  field: FieldsOfKind<"date">;
  kind: "date";
} & (
  | { days: ListedDays; min?: never; max?: never }
  | { days?: undefined; min?: string; max?: string }
);

export interface TextFilter {
  field: FieldsOfKind<"text">;
  kind: "text";
  value: string;
}

// Exact-match filter resolved via a typeahead RPC (see CATALOGUE_FILTERS.rpc),
// as opposed to TextFilter's partial ilike.
export interface TypeaheadFilter {
  field: FieldsOfKind<"typeahead">;
  kind: "typeahead";
  value: string;
}

export type CatalogueFilter = EnumFilter | RangeFilter | DateFilter | TextFilter | TypeaheadFilter;

export type CatalogueMode = "explore" | "value-research" | "recent-listings";

export interface CatalogueSortState {
  field: CatalogueMetricField;
  dir: SortDir;
}

export interface CatalogueQueryState {
  mode: CatalogueMode;
  filters: CatalogueFilter[];
  sort: CatalogueSortState;
  page: number;
}

export interface PriceChangeSortState {
  field: PriceChangeSortField;
  dir: SortDir;
}

// price-changes mode reads recent_price_change_view and has no filters of its
// own in v1 (see docs/PHASE2-catalogue-browser.md Phase A) -- filters is
// fixed to [] at the type level so a catalogue filter can never leak into it.
export interface PriceChangeQueryState {
  mode: "price-changes";
  filters: [];
  sort: PriceChangeSortState;
  page: number;
}

// Discriminated on `mode` so a value-research/explore/recent-listings state
// can never carry a price-changes sort field, and vice versa -- the type
// system, not just runtime validation, keeps each mode's query aimed at the
// view it actually reads.
export type QueryState = CatalogueQueryState | PriceChangeQueryState;
export type QueryMode = QueryState["mode"];
