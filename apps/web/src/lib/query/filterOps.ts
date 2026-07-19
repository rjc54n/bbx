import type { CatalogueFilterField } from "./registry";
import type { CatalogueFilter } from "./types";

// One canonical filter per field (see docs/PHASE2-catalogue-browser.md Phase
// B url.ts notes) -- these are the two mutations the UI needs and both
// preserve that invariant, rather than the UI pushing raw arrays around.
export function setFilter(filters: CatalogueFilter[], filter: CatalogueFilter): CatalogueFilter[] {
  const canonical = filter.kind === "enum"
    ? { ...filter, value: [...new Set(filter.value)].sort() }
    : filter;
  return [...filters.filter((f) => f.field !== filter.field), canonical];
}

export function removeFilter(filters: CatalogueFilter[], field: CatalogueFilterField): CatalogueFilter[] {
  return filters.filter((f) => f.field !== field);
}

export function getFilter<F extends CatalogueFilterField>(
  filters: CatalogueFilter[],
  field: F,
): Extract<CatalogueFilter, { field: F }> | undefined {
  return filters.find((f) => f.field === field) as Extract<CatalogueFilter, { field: F }> | undefined;
}
