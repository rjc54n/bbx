import type { AppliedFilter } from "@/lib/query/applyFilters";
import {
  SCENARIO_ANCHOR_STATUSES,
  SCENARIO_FILTERS,
  SCENARIO_SORT_FIELDS,
  type ScenarioFilterField,
  type ScenarioSortField,
} from "./registry";

export type SortDir = "asc" | "desc";

export interface ScenarioDefinition {
  filters: AppliedFilter[];
  sort: { field: ScenarioSortField; dir: SortDir };
}

export const DEFAULT_SCENARIO_SORT: { field: ScenarioSortField; dir: SortDir } = {
  field: "ask_vs_release_pct",
  dir: "asc",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .map((item) => (typeof item === "number" ? String(item) : item))
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseFilter(raw: unknown): AppliedFilter | null {
  if (!isRecord(raw)) return null;
  const field = raw.field;
  if (typeof field !== "string" || !(field in SCENARIO_FILTERS)) return null;
  // Kind is taken from the registry, never from the untrusted input, so a stored
  // definition can never point a filter at the wrong operator.
  const kind = SCENARIO_FILTERS[field as ScenarioFilterField].kind;

  switch (kind) {
    case "range": {
      const min = typeof raw.min === "number" && Number.isFinite(raw.min) ? raw.min : undefined;
      const max = typeof raw.max === "number" && Number.isFinite(raw.max) ? raw.max : undefined;
      if (min === undefined && max === undefined) return null;
      return raw.includeNulls === true
        ? { kind: "range", field, min, max, includeNulls: true }
        : { kind: "range", field, min, max };
    }
    case "enum": {
      let value = toStringList(raw.value);
      if (field === "anchor_status") {
        const allowed = new Set<string>(SCENARIO_ANCHOR_STATUSES);
        value = value.filter((item) => allowed.has(item));
      }
      if (value.length === 0) return null;
      return { kind: "enum", field, value };
    }
    case "boolean": {
      if (typeof raw.value !== "boolean") return null;
      return { kind: "boolean", field, value: raw.value };
    }
    case "text": {
      const value = typeof raw.value === "string" ? raw.value.trim() : "";
      if (!value) return null;
      return { kind: "text", field, value };
    }
    default:
      return null;
  }
}

function parseSort(raw: unknown): { field: ScenarioSortField; dir: SortDir } {
  if (!isRecord(raw)) return { ...DEFAULT_SCENARIO_SORT };
  const field = SCENARIO_SORT_FIELDS.includes(raw.field as ScenarioSortField)
    ? (raw.field as ScenarioSortField)
    : DEFAULT_SCENARIO_SORT.field;
  const dir: SortDir = raw.dir === "desc" ? "desc" : "asc";
  return { field, dir };
}

// Validates and normalises an untrusted definition (stored JSONB or form input)
// against the registry. Unknown fields, wrong-typed values and empty filters are
// dropped rather than throwing, so a stray key never breaks the whole scenario.
export function parseScenarioDefinition(raw: unknown): ScenarioDefinition {
  const source = isRecord(raw) ? raw : {};
  const filtersRaw = Array.isArray(source.filters) ? source.filters : [];
  const filters = filtersRaw
    .map(parseFilter)
    .filter((filter): filter is AppliedFilter => filter !== null);
  return { filters, sort: parseSort(source.sort) };
}
