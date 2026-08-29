import "server-only";

import type { OwnerContext } from "@/lib/auth/owner";
import { applyFilters } from "@/lib/query/applyFilters";
import { timeProtectedQuery } from "@/lib/observability/routeTiming";
import { scenarioPreview, scenarioPreviewRange } from "./browser";
import type { ScenarioDefinition } from "./definition";

export type ScenarioResultRow = {
  parent_sku: string | null;
  format_code: string | null;
  name: string | null;
  vintage: number | null;
  case_size: number | null;
  bottle_volume_ml: number | null;
  lowest_ask_per_75cl_p: number | null;
  release_price_per_75cl_p: number | null;
  ask_vs_release_pct: number | null;
  anchor_status: string | null;
};

const COLUMNS =
  "parent_sku,format_code,name,vintage,case_size,bottle_volume_ml,lowest_ask_per_75cl_p,release_price_per_75cl_p,ask_vs_release_pct,anchor_status";

// One bounded page of the wines a scenario definition matches. Shared by the
// saved-scenario detail page and the "Run" preview on both the detail and the
// new-scenario pages, so evaluation stays identical across all three.
export async function evaluateScenario(
  supabase: OwnerContext["supabase"],
  definition: ScenarioDefinition,
  page: number,
  route: string,
): Promise<{ rows: ScenarioResultRow[]; hasNext: boolean }> {
  const request = applyFilters(
    supabase.from("wine_scenario_view").select(COLUMNS),
    definition.filters,
  );
  const { from, to } = scenarioPreviewRange(page);
  const { data, error } = await timeProtectedQuery(route, "scenario_preview", async () =>
    request
      .order(definition.sort.field, { ascending: definition.sort.dir === "asc", nullsFirst: false })
      .order("parent_sku", { ascending: true })
      .order("format_code", { ascending: true })
      .range(from, to),
  );
  if (error) throw new Error("The scenario could not be evaluated.");
  return scenarioPreview((data ?? []) as ScenarioResultRow[]);
}
