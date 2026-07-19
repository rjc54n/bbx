"use client";

import { useEffect, useRef, useState } from "react";
import { formatFormat } from "@/lib/format";
import { LISTED_DAY_OPTIONS, type ListedDays } from "@/lib/query/freshness";
import {
  discountFromMaximumPricePercentage,
  DISCOUNT_MAX,
  maximumPricePercentageForDiscount,
  normaliseDiscount,
} from "@/lib/query/priceRange";
import type { EnumFacetField, FacetRanges, FacetValue, FacetValues, FormatOption } from "@/lib/query/facets";
import { CATALOGUE_FILTERS, type CatalogueFilterField, type FilterGroup, type FilterMeta } from "@/lib/query/registry";
import type { CatalogueFilter } from "@/lib/query/types";
import { ProducerTypeahead } from "./ProducerTypeahead";

const GROUPS: FilterGroup[] = ["Wine", "Format", "Price", "Freshness"];
const WINE_FACET_FIELDS = ["colour", "country", "region", "subregion", "vintage"] as const satisfies readonly EnumFacetField[];
const PRICE_FIELDS = new Set<CatalogueFilterField>([
  "price_vs_market_pct",
  "price_vs_last_pct",
  "price_vs_next_pct",
]);

function displayValue(value: number, units: string | undefined): string {
  return units === "pence" ? String(value / 100) : String(value);
}

function parseValue(text: string, units: string | undefined): number | undefined {
  const value = Number(text.trim());
  if (!text.trim() || !Number.isFinite(value)) return undefined;
  return units === "pence" ? Math.round(value * 100) : value;
}

function FacetOptions({ label, options, selected, onChange }: {
  label: string;
  options: FacetValue[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = query ? options.filter((option) => option.value.toLowerCase().includes(query.toLowerCase())) : options;

  return (
    <div>
      {options.length > 8 && (
        <input
          type="search"
          className="mb-2 w-full rounded border border-border bg-background px-2 py-1 text-sm"
          placeholder={`Find ${label.toLowerCase()}…`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <div className="max-h-48 overflow-y-auto pr-1">
        {filtered.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center justify-between gap-2 py-1 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={(event) => onChange(event.target.checked ? [...selected, option.value] : selected.filter((value) => value !== option.value))}
              />
              <span className="truncate">{option.value.trim()}</span>
            </span>
            <span className="tabular-nums text-xs text-ink-muted">{option.n}</span>
          </label>
        ))}
        {filtered.length === 0 && <p className="py-1 text-xs text-ink-muted">No matches</p>}
      </div>
    </div>
  );
}

function FacetDisclosure({ field, options, selected, open, onToggle, onChange }: {
  field: EnumFacetField;
  options: FacetValue[];
  selected: string[];
  open: boolean;
  onToggle: () => void;
  onChange: (values: string[]) => void;
}) {
  const meta = CATALOGUE_FILTERS[field];
  return (
    <section className="border-t border-border pt-2">
      <button type="button" className="flex w-full items-center justify-between text-left text-sm font-medium text-ink" aria-expanded={open} onClick={onToggle}>
        <span>{meta.label}</span>
        <span className="text-xs font-normal text-ink-muted">{selected.length > 0 ? `${selected.length} selected` : open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="pt-2">
          {selected.length > 0 && <button type="button" className="mb-2 text-xs text-accent hover:underline" onClick={() => onChange([])}>Clear {meta.label.toLowerCase()}</button>}
          <FacetOptions label={meta.label} options={options} selected={selected} onChange={onChange} />
        </div>
      )}
    </section>
  );
}

function RangeControl({ label, units, bounds, min, max, onCommit }: {
  label: string;
  units?: string;
  bounds?: { min: number | null; max: number | null };
  min?: number;
  max?: number;
  onCommit: (min: number | undefined, max: number | undefined) => void;
}) {
  const [minText, setMinText] = useState(min === undefined ? "" : displayValue(min, units));
  const [maxText, setMaxText] = useState(max === undefined ? "" : displayValue(max, units));
  const [previous, setPrevious] = useState({ min, max });
  if (previous.min !== min || previous.max !== max) {
    setPrevious({ min, max });
    setMinText(min === undefined ? "" : displayValue(min, units));
    setMaxText(max === undefined ? "" : displayValue(max, units));
  }
  const commit = () => onCommit(parseValue(minText, units), parseValue(maxText, units));

  return (
    <section>
      <label className="mb-1 block text-sm font-medium text-ink">{label}{units === "pence" ? " (£)" : ""}</label>
      <div className="flex items-center gap-2">
        <input type="number" inputMode="decimal" className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm tabular-nums" placeholder={bounds?.min == null ? "Min" : displayValue(bounds.min, units)} value={minText} onChange={(event) => setMinText(event.target.value)} onBlur={commit} />
        <span className="text-ink-muted">to</span>
        <input type="number" inputMode="decimal" className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm tabular-nums" placeholder={bounds?.max == null ? "Max" : displayValue(bounds.max, units)} value={maxText} onChange={(event) => setMaxText(event.target.value)} onBlur={commit} />
      </div>
    </section>
  );
}

function discountLabel(label: string): string {
  return label.replace(/^Price vs /, "Discount to ");
}

function DiscountSlider({ label, max, onCommit, onClear }: {
  label: string;
  max?: number;
  onCommit: (max: number | undefined) => void;
  onClear: () => void;
}) {
  const value = discountFromMaximumPricePercentage(max);
  const active = value > 0;
  const [discount, setDiscount] = useState(value);
  const [previousMax, setPreviousMax] = useState(max);
  if (previousMax !== max) {
    setPreviousMax(max);
    setDiscount(value);
  }
  const commit = (nextDiscount: number) => onCommit(maximumPricePercentageForDiscount(nextDiscount));
  const controlLabel = discountLabel(label);

  return (
    <section aria-label={`${label} filter`} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">{controlLabel}</span>
        <span className="text-xs text-ink-muted">{active ? `${discount}% or more` : "0% (any)"}</span>
      </div>
      <div className="flex items-end gap-3" aria-label={`${controlLabel} range`}>
        <input type="range" min={0} max={DISCOUNT_MAX} step={1} value={discount} className="discount-range min-w-0 flex-1" aria-label={`${controlLabel}: minimum discount`} onChange={(event) => setDiscount(normaliseDiscount(Number(event.target.value)))} onPointerUp={(event) => commit(Number(event.currentTarget.value))} onKeyUp={(event) => commit(Number(event.currentTarget.value))} />
        <label className="w-20 text-xs text-ink-muted">Minimum
          <span className="relative mt-1 block"><input type="number" min={0} max={DISCOUNT_MAX} step={1} value={discount} aria-label={`${controlLabel}: minimum discount value`} className="w-full rounded border border-border bg-background px-2 py-1 pr-6 text-sm tabular-nums text-ink" onChange={(event) => setDiscount(normaliseDiscount(Number(event.target.value)))} onBlur={() => commit(discount)} onKeyDown={(event) => { if (event.key === "Enter") commit(discount); }} /><span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs">%</span></span>
        </label>
      </div>
      <div className="mt-1 flex justify-between text-xs text-ink-muted"><span>0%</span><span>100% below reference</span></div>
      {active && <button type="button" className="mt-2 text-xs text-accent hover:underline" onClick={onClear}>Clear discount</button>}
    </section>
  );
}

function ListedControl({ days, hasLegacyRange, onSelect, onClear }: {
  days?: ListedDays;
  hasLegacyRange: boolean;
  onSelect: (days: ListedDays) => void;
  onClear: () => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">Listed</p>
        {(days || hasLegacyRange) && <button type="button" className="text-xs text-accent hover:underline" onClick={onClear}>Clear</button>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {LISTED_DAY_OPTIONS.map((option) => (
          <button key={option} type="button" aria-pressed={days === option} className={`rounded border px-2 py-1.5 text-xs ${days === option ? "border-accent bg-accent-soft text-ink" : "border-border text-ink-muted hover:border-accent hover:text-accent"}`} onClick={() => days === option ? onClear() : onSelect(option)}>
            Last {option} {option === 1 ? "day" : "days"}
          </button>
        ))}
      </div>
      {hasLegacyRange && !days && <p className="mt-2 text-xs text-ink-muted">A shared URL supplied a custom listed period.</p>}
    </section>
  );
}

function FormatControl({ options, selected, onChange }: {
  options: FormatOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = query ? options.filter((option) => formatFormat(option.case_size, option.bottle_volume_ml).toLowerCase().includes(query.toLowerCase())) : options;
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">Format</p>
        {selected.length > 0 && <button type="button" className="text-xs text-accent hover:underline" onClick={() => onChange([])}>Clear</button>}
      </div>
      <input type="search" className="mb-2 w-full rounded border border-border bg-background px-2 py-1 text-sm" placeholder="Find a format…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="max-h-72 overflow-y-auto pr-1">
        {filtered.map((option) => {
          if (!option.format_code) return null;
          return (
            <label key={option.format_code} className="flex cursor-pointer items-center justify-between gap-2 py-1 text-sm">
              <span className="flex min-w-0 items-center gap-2"><input type="checkbox" checked={selected.includes(option.format_code)} onChange={(event) => onChange(event.target.checked ? [...selected, option.format_code as string] : selected.filter((value) => value !== option.format_code))} />{formatFormat(option.case_size, option.bottle_volume_ml)}</span>
              <span className="tabular-nums text-xs text-ink-muted">{option.n}</span>
            </label>
          );
        })}
        {options.length === 0 && <p className="py-1 text-xs text-ink-muted">Loading…</p>}
        {options.length > 0 && filtered.length === 0 && <p className="py-1 text-xs text-ink-muted">No matches</p>}
      </div>
    </section>
  );
}

function boundsFor(field: CatalogueFilterField, ranges: FacetRanges | null) {
  if (field === "ask" && ranges) return ranges.ask;
  return undefined;
}

function fieldsForGroup(group: FilterGroup): CatalogueFilterField[] {
  return (Object.keys(CATALOGUE_FILTERS) as CatalogueFilterField[]).filter((field) => CATALOGUE_FILTERS[field].group === group && field !== "search");
}

function WinePanel({ filters, facetValues, onSetFilter, onRemoveFilter }: {
  filters: CatalogueFilter[];
  facetValues: FacetValues;
  onSetFilter: (filter: CatalogueFilter) => void;
  onRemoveFilter: (field: CatalogueFilterField) => void;
}) {
  const [openFacet, setOpenFacet] = useState<EnumFacetField | null>(null);
  const producer = filters.find((filter) => filter.field === "producer");
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-ink">Producer
        <span className="mt-1 block"><ProducerTypeahead value={producer?.kind === "typeahead" ? producer.value : undefined} onSelect={(value) => value ? onSetFilter({ field: "producer", kind: "typeahead", value }) : onRemoveFilter("producer")} /></span>
      </label>
      {WINE_FACET_FIELDS.map((field) => {
        const filter = filters.find((candidate) => candidate.field === field);
        return <FacetDisclosure key={field} field={field} options={facetValues[field] ?? []} selected={filter?.kind === "enum" ? filter.value : []} open={openFacet === field} onToggle={() => setOpenFacet(openFacet === field ? null : field)} onChange={(values) => values.length ? onSetFilter({ field, kind: "enum", value: values } as CatalogueFilter) : onRemoveFilter(field)} />;
      })}
    </div>
  );
}

function FilterControl({ field, filter, facetRanges, onSetFilter, onRemoveFilter }: {
  field: CatalogueFilterField;
  filter: CatalogueFilter | undefined;
  facetRanges: FacetRanges | null;
  onSetFilter: (filter: CatalogueFilter) => void;
  onRemoveFilter: (field: CatalogueFilterField) => void;
}) {
  const meta: FilterMeta = CATALOGUE_FILTERS[field];
  if (field === "first_seen_at") {
    const days = filter?.kind === "date" ? filter.days : undefined;
    const hasLegacyRange = filter?.kind === "date" && (filter.min !== undefined || filter.max !== undefined);
    return <ListedControl days={days} hasLegacyRange={hasLegacyRange} onSelect={(selectedDays) => onSetFilter({ field, kind: "date", days: selectedDays })} onClear={() => onRemoveFilter(field)} />;
  }
  if (meta.kind === "range" && PRICE_FIELDS.has(field)) {
    return <DiscountSlider label={meta.label} max={filter?.kind === "range" ? filter.max : undefined} onCommit={(max) => max === undefined ? onRemoveFilter(field) : onSetFilter({ field, kind: "range", max } as CatalogueFilter)} onClear={() => onRemoveFilter(field)} />;
  }
  if (meta.kind === "range") {
    return <RangeControl label={meta.label} units={meta.units} bounds={boundsFor(field, facetRanges)} min={filter?.kind === "range" ? filter.min : undefined} max={filter?.kind === "range" ? filter.max : undefined} onCommit={(min, max) => min === undefined && max === undefined ? onRemoveFilter(field) : onSetFilter({ field, kind: "range", min, max } as CatalogueFilter)} />;
  }
  return null;
}

interface FilterStripProps {
  filters: CatalogueFilter[];
  facetValues: FacetValues;
  facetRanges: FacetRanges | null;
  formatOptions: FormatOption[];
  onSetFilter: (filter: CatalogueFilter) => void;
  onRemoveFilter: (field: CatalogueFilterField) => void;
  onSetFormat: (formatCodes: string[]) => void;
}

export function FilterStrip({ filters, facetValues, facetRanges, formatOptions, onSetFilter, onRemoveFilter, onSetFormat }: FilterStripProps) {
  const [openGroup, setOpenGroup] = useState<FilterGroup | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeCount = (group: FilterGroup) => fieldsForGroup(group).reduce((count, field) => {
    const filter = filters.find((candidate) => candidate.field === field);
    return count + (filter?.kind === "enum" ? filter.value.length : filter ? 1 : 0);
  }, 0);
  const selectedFormats = filters.find((filter) => filter.field === "format_code");

  useEffect(() => {
    if (!openGroup) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpenGroup(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenGroup(null);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openGroup]);

  const panelId = openGroup ? `${openGroup.toLowerCase()}-filters` : undefined;

  return (
    <div ref={rootRef} className="relative w-full">
      <div className="flex flex-wrap items-center justify-end gap-1">
        {GROUPS.map((group) => {
          const count = activeCount(group);
          const open = group === openGroup;
          return <button key={group} type="button" aria-expanded={open} aria-controls={open ? panelId : undefined} className={`rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${open ? "bg-accent-soft text-ink" : "text-ink-muted hover:text-ink"}`} onClick={() => setOpenGroup(open ? null : group)}>{group}{count > 0 && <span className="ml-1 text-accent">({count})</span>}</button>;
        })}
      </div>
      {openGroup && (
        <section id={panelId} aria-label={`${openGroup} filters`} className="absolute right-0 z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] max-h-[70dvh] overflow-y-auto rounded border border-border bg-background p-4 shadow-lg sm:max-h-[65dvh]">
          <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
            <h2 className="text-sm font-semibold text-ink">{openGroup} filters</h2>
            <button type="button" className="rounded px-1 text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => setOpenGroup(null)} aria-label="Close filters">×</button>
          </div>
          {openGroup === "Wine" && <WinePanel filters={filters} facetValues={facetValues} onSetFilter={onSetFilter} onRemoveFilter={onRemoveFilter} />}
          {openGroup === "Format" && <FormatControl options={formatOptions} selected={selectedFormats?.kind === "enum" ? selectedFormats.value : []} onChange={onSetFormat} />}
          {openGroup === "Price" && <div className="space-y-4">{fieldsForGroup("Price").map((field) => <FilterControl key={field} field={field} filter={filters.find((filter) => filter.field === field)} facetRanges={facetRanges} onSetFilter={onSetFilter} onRemoveFilter={onRemoveFilter} />)}</div>}
          {openGroup === "Freshness" && <FilterControl field="first_seen_at" filter={filters.find((filter) => filter.field === "first_seen_at")} facetRanges={facetRanges} onSetFilter={onSetFilter} onRemoveFilter={onRemoveFilter} />}
        </section>
      )}
    </div>
  );
}
