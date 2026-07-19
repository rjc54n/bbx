export type QueryMode = "explore" | "value-research" | "recent-listings" | "price-changes";

export type SortDir = "asc" | "desc";

export interface SortState {
  field: string;
  dir: SortDir;
}

export interface EnumFilter {
  field: string;
  kind: "enum";
  value: string[];
}

export interface RangeFilter {
  field: string;
  kind: "range";
  min?: number;
  max?: number;
}

export interface DateFilter {
  field: string;
  kind: "date";
  min?: string;
  max?: string;
}

export interface TextFilter {
  field: string;
  kind: "text";
  value: string;
}

export interface BoolFilter {
  field: string;
  kind: "bool";
  value: boolean;
}

export type Filter = EnumFilter | RangeFilter | DateFilter | TextFilter | BoolFilter;

export interface QueryState {
  mode: QueryMode;
  filters: Filter[];
  sort: SortState;
  page: number;
}
