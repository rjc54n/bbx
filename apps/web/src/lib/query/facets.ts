import { supabase } from "@/lib/supabase";
import { CATALOGUE_FILTERS, type CatalogueFilterField } from "./registry";
import type { FacetRangesRow, FacetValueRow } from "./rows";
import type { Database } from "@/lib/database.types";

// facet_values_view provides the generic enum facets. Format is deliberately
// separate: format_options_view preserves each stored format_code with its
// matching case and bottle measurements.
export type EnumFacetField = {
  [F in CatalogueFilterField]: (typeof CATALOGUE_FILTERS)[F]["kind"] extends "enum" ? F : never;
}[CatalogueFilterField];

export const ENUM_FACET_FIELDS = (Object.keys(CATALOGUE_FILTERS) as CatalogueFilterField[]).filter(
  (field) => CATALOGUE_FILTERS[field].kind === "enum",
) as EnumFacetField[];

function isEnumFacetField(value: string): value is EnumFacetField {
  return (ENUM_FACET_FIELDS as string[]).includes(value);
}

export interface FacetValue {
  value: string;
  n: number;
}

// Global counts, not cross-filtered by other active filters -- deferred, see
// docs/PHASE2-catalogue-browser.md Phase A note 4. Fields with zero matching
// rows are simply absent, not present with an empty array.
export type FacetValues = Partial<Record<EnumFacetField, FacetValue[]>>;

export function groupFacetValues(rows: Pick<FacetValueRow, "facet" | "value" | "n">[]): FacetValues {
  const result: FacetValues = {};
  for (const row of rows) {
    if (!row.facet || row.value === null || row.n === null) continue;
    if (!isEnumFacetField(row.facet)) continue;
    (result[row.facet] ??= []).push({ value: row.value, n: row.n });
  }
  // Vintage is a chronological choice, not an alphabetic facet. The source
  // view supplies it as text so it can share the common facet shape.
  result.vintage?.sort((a, b) => Number(b.value) - Number(a.value));
  return result;
}

export async function fetchFacetValues(): Promise<FacetValues> {
  const { data, error } = await supabase.from("facet_values_view").select("*");
  if (error) throw error;
  return groupFacetValues(data ?? []);
}

export type FormatOption = Database["public"]["Views"]["format_options_view"]["Row"];

export function sortFormatOptions(options: FormatOption[]): FormatOption[] {
  return [...options].sort((a, b) => (b.n ?? 0) - (a.n ?? 0));
}

export async function fetchFormatOptions(): Promise<FormatOption[]> {
  const { data, error } = await supabase.from("format_options_view").select("*");
  if (error) throw error;
  return sortFormatOptions(data ?? []);
}

export interface FacetRange<T> {
  min: T | null;
  max: T | null;
}

export interface FacetRanges {
  vintage: FacetRange<number>;
  ask: FacetRange<number>;
  case_size: FacetRange<number>;
  bottle_volume_ml: FacetRange<number>;
  first_seen_at: FacetRange<string>;
  last_seen_at: FacetRange<string>;
}

export function shapeFacetRanges(row: FacetRangesRow): FacetRanges {
  return {
    vintage: { min: row.vintage_min, max: row.vintage_max },
    ask: { min: row.ask_min, max: row.ask_max },
    case_size: { min: row.case_size_min, max: row.case_size_max },
    bottle_volume_ml: { min: row.bottle_volume_ml_min, max: row.bottle_volume_ml_max },
    first_seen_at: { min: row.first_seen_at_min, max: row.first_seen_at_max },
    last_seen_at: { min: row.last_seen_at_min, max: row.last_seen_at_max },
  };
}

// facet_ranges_view is a single aggregate row by construction (Phase A) --
// .single() is the right fetch here, not .limit(1) + array indexing.
export async function fetchFacetRanges(): Promise<FacetRanges> {
  const { data, error } = await supabase.from("facet_ranges_view").select("*").single();
  if (error) throw error;
  return shapeFacetRanges(data);
}
