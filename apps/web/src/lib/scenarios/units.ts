import type { FilterMeta } from "@/lib/query/registry";
import { SCENARIO_FILTERS, type ScenarioFilterField } from "./registry";

// The typed unit boundary (docs/PHASE8-scenario-query-engine.md Phase 1). The
// stored definition always holds a field's *canonical* value -- the same unit as
// the view column, so applyFilters / evaluateScenario never convert. Only the
// builder crosses the boundary: money fields are entered and shown in pounds,
// stored in pence.

function fieldType(field: string): "money" | "percent" | "number" {
  const meta = SCENARIO_FILTERS[field as ScenarioFilterField] as FilterMeta | undefined;
  return meta?.type ?? "number";
}

// Canonical (stored) -> the number shown in the builder input.
export function toInputValue(field: string, canonical: number | undefined): number | undefined {
  if (canonical === undefined) return undefined;
  return fieldType(field) === "money" ? canonical / 100 : canonical;
}

// A builder input string -> canonical (stored). Empty/invalid clears the bound.
export function fromInputValue(field: string, raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return fieldType(field) === "money" ? Math.round(n * 100) : n;
}

// Canonical value -> a human string for the summary line ("£30.00", "10%", "6").
export function formatBound(field: string, canonical: number): string {
  switch (fieldType(field)) {
    case "money":
      return `£${(canonical / 100).toFixed(2)}`;
    case "percent":
      return `${canonical}%`;
    default:
      return String(canonical);
  }
}
