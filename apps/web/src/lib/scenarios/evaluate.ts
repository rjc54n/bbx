import "server-only";

import type { OwnerContext } from "@/lib/auth/owner";
import { applyFilters } from "@/lib/query/applyFilters";
import { timeProtectedQuery } from "@/lib/observability/routeTiming";
import { scenarioPreview, scenarioPreviewRange } from "./browser";
import { usesLegacyReleaseFields, type ScenarioDefinition } from "./definition";

type CommonRow = {
  parent_sku: string | null;
  format_code: string | null;
  name: string | null;
  vintage: number | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  lowest_ask_per_75cl_p: number | null;
};

type LegacyRow = CommonRow & {
  release_price_per_75cl_p: number | null;
  ask_vs_release_pct: number | null;
  anchor_status: string | null;
};

type ReferenceRow = CommonRow & {
  reference_price_per_75cl_p: number | null;
  ask_vs_reference_pct: number | null;
  reference_resolution_kind: string | null;
  reference_needs_review: boolean | null;
};

export type ScenarioResultRow = CommonRow & {
  reference_price_per_75cl_p: number | null;
  ask_vs_reference_pct: number | null;
  reference_resolution_kind: string | null;
  reference_needs_review: boolean;
  legacy: boolean;
};

const COMMON_COLUMNS =
  "parent_sku,format_code,name,vintage,case_size,bottle_volume_ml,lowest_ask_per_75cl_p";
const LEGACY_COLUMNS =
  `${COMMON_COLUMNS},release_price_per_75cl_p,ask_vs_release_pct,anchor_status`;
const REFERENCE_COLUMNS =
  `${COMMON_COLUMNS},reference_price_per_75cl_p,ask_vs_reference_pct,reference_resolution_kind,reference_needs_review`;

// Old definitions keep their original evaluation path until the owner previews
// and re-saves them. New definitions use the market cache and live reference.
export async function evaluateScenario(
  supabase: OwnerContext["supabase"],
  definition: ScenarioDefinition,
  page: number,
  route: string,
): Promise<{ rows: ScenarioResultRow[]; hasNext: boolean }> {
  const legacy = usesLegacyReleaseFields(definition);
  const { from, to } = scenarioPreviewRange(page);
  const { data, error } = await timeProtectedQuery(route, "scenario_preview", async () => {
    if (legacy) {
      return applyFilters(supabase.from("wine_scenario_view").select(LEGACY_COLUMNS), definition.filters)
        .order(definition.sort.field, { ascending: definition.sort.dir === "asc", nullsFirst: false })
        .order("parent_sku", { ascending: true })
        .order("format_code", { ascending: true })
        .range(from, to);
    }
    return applyFilters(
      supabase.from("wine_scenario_reference_view").select(REFERENCE_COLUMNS)
        .eq("bottle_volume_ml", 750),
      definition.filters,
    )
      .order(definition.sort.field, { ascending: definition.sort.dir === "asc", nullsFirst: false })
      .order("parent_sku", { ascending: true })
      .order("format_code", { ascending: true })
      .range(from, to);
  });
  if (error) throw new Error("The scenario could not be evaluated.");
  const rows: ScenarioResultRow[] = legacy
    ? ((data ?? []) as LegacyRow[]).map((row) => ({
      ...row,
      reference_price_per_75cl_p: row.release_price_per_75cl_p,
      ask_vs_reference_pct: row.ask_vs_release_pct,
      reference_resolution_kind: row.anchor_status,
      reference_needs_review: false,
      legacy: true,
    }))
    : ((data ?? []) as ReferenceRow[]).map((row) => ({
      ...row,
      reference_needs_review: row.reference_needs_review ?? false,
      legacy: false,
    }));
  return scenarioPreview(rows);
}
