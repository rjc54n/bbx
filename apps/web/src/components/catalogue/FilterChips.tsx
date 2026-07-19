"use client";

import { formatFormat, formatPence } from "@/lib/format";
import type { FormatOption } from "@/lib/query/facets";
import { CATALOGUE_FILTERS, type CatalogueFilterField, type FilterMeta } from "@/lib/query/registry";
import type { CatalogueFilter } from "@/lib/query/types";

const SLIDER_FIELDS = new Set<CatalogueFilterField>(["price_vs_market_pct", "price_vs_last_pct", "price_vs_next_pct"]);

function formatRangeBound(v: number, units: string | undefined): string {
  if (units === "pence") return formatPence(v);
  if (units === "%") return `${v}%`;
  return String(v);
}

function describeFilter(filter: CatalogueFilter): string {
  // Widen to the FilterMeta interface: CATALOGUE_FILTERS is `as const
  // satisfies Record<...>` so it keeps each entry's literal shape (needed
  // elsewhere to derive per-field `kind`), but that means a lookup by a
  // non-literal field produces a union where optional props like `units`
  // aren't present on every member -- widen here since we just want the
  // interface's `units?: string`, not the per-field literal.
  const meta: FilterMeta = CATALOGUE_FILTERS[filter.field];
  switch (filter.kind) {
    case "enum":
      return `${meta.label}: ${filter.value.map((value) => value.trim()).join(", ")}`;
    case "range": {
      const { min, max } = filter;
      // Same plain-language convention as the slider labels themselves
      // (docs/PHASE2-catalogue-browser.md Phase D) -- the chip should never
      // require the reader to decode a signed percentage.
      if (SLIDER_FIELDS.has(filter.field)) {
        if (max !== undefined && max < 0 && min === undefined) {
          return `${meta.label.replace(/^Price vs /, "Discount to ")}: ${Math.abs(max)}% or more`;
        }
        const below = min !== undefined ? `${Math.abs(min)}% below` : undefined;
        const above = max !== undefined ? `${max}% above` : undefined;
        return `${meta.label}: ${[below, above].filter(Boolean).join(" – ")}`;
      }
      if (min !== undefined && max !== undefined) {
        return `${meta.label}: ${formatRangeBound(min, meta.units)}–${formatRangeBound(max, meta.units)}`;
      }
      if (min !== undefined) return `${meta.label}: ≥ ${formatRangeBound(min, meta.units)}`;
      return `${meta.label}: ≤ ${formatRangeBound(max as number, meta.units)}`;
    }
    case "date": {
      if (filter.days !== undefined) {
        return `Listed: last ${filter.days} ${filter.days === 1 ? "day" : "days"}`;
      }
      const { min, max } = filter;
      if (min && max) return `${meta.label}: ${min.slice(0, 10)} – ${max.slice(0, 10)}`;
      if (min) return `${meta.label}: after ${min.slice(0, 10)}`;
      return `${meta.label}: before ${(max as string).slice(0, 10)}`;
    }
    case "text":
      return `${meta.label}: "${filter.value}"`;
    case "typeahead":
      return `${meta.label}: ${filter.value}`;
  }
}

interface Chip {
  key: string;
  description: string;
  remove: () => void;
}

// Format codes are the sole filter representation. Map each code back to the
// same case × bottle label used in the table, keeping multi-select choices
// readable without reconstructing a false combination from separate facets.
function toChips(
  filters: CatalogueFilter[],
  formatOptions: FormatOption[],
  onRemove: (fieldOrFields: CatalogueFilterField | CatalogueFilterField[]) => void,
): Chip[] {
  const chips: Chip[] = [];
  for (const filter of filters) {
    if (filter.field === "format_code" && filter.kind === "enum") {
      const labels = filter.value.map((formatCode) => {
        const option = formatOptions.find((candidate) => candidate.format_code === formatCode);
        return option ? formatFormat(option.case_size, option.bottle_volume_ml) : formatCode;
      });
      chips.push({
        key: filter.field,
        description: `Format: ${labels.join(", ")}`,
        remove: () => onRemove(filter.field),
      });
      continue;
    }
    chips.push({ key: filter.field, description: describeFilter(filter), remove: () => onRemove(filter.field) });
  }
  return chips;
}

interface FilterChipsProps {
  filters: CatalogueFilter[];
  formatOptions: FormatOption[];
  onRemove: (fieldOrFields: CatalogueFilterField | CatalogueFilterField[]) => void;
  onReset: () => void;
}

export function FilterChips({ filters, formatOptions, onRemove, onReset }: FilterChipsProps) {
  if (filters.length === 0) return null;
  const chips = toChips(filters, formatOptions, onRemove);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent-soft px-3 py-1 text-xs text-ink"
        >
          {chip.description}
          <button
            type="button"
            className="rounded text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={chip.remove}
            aria-label={`Remove filter: ${chip.description}`}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        className="ml-1 rounded text-xs font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={onReset}
      >
        Reset
      </button>
    </div>
  );
}
