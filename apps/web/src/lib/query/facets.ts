import { supabase } from "@/lib/supabase";
import { CATALOGUE_FILTERS, type CatalogueFilterField } from "./registry";
import type { FacetRangesRow, FacetValueRow } from "./rows";

// The enum-kind filters facet_values_view groups counts for (region,
// subregion, country, colour, case_size, bottle_volume_ml as of Phase A).
// Derived from the registry rather than hardcoded so a new enum filter can't
// silently go un-faceted without a type/test failure pointing at the gap.
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
  return result;
}

export async function fetchFacetValues(): Promise<FacetValues> {
  const { data, error } = await supabase.from("facet_values_view").select("*");
  if (error) throw error;
  return groupFacetValues(data ?? []);
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
