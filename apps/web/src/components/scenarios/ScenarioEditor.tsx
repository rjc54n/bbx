"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { scenarioPreviewHref } from "@/lib/scenarios/preview";
import type { FilterMeta } from "@/lib/query/registry";
import type { AppliedFilter } from "@/lib/query/applyFilters";
import type { SortDir } from "@/lib/scenarios/definition";
import { parseScenarioDefinition } from "@/lib/scenarios/definition";
import {
  SCENARIO_ANCHOR_STATUSES,
  SCENARIO_FILTERS,
  SCENARIO_SORT_FIELDS,
  SCENARIO_SORT_LABELS,
  type ScenarioFilterField,
  type ScenarioSortField,
} from "@/lib/scenarios/registry";

const FIELD_ORDER = Object.keys(SCENARIO_FILTERS) as ScenarioFilterField[];

function defaultFilter(field: ScenarioFilterField): AppliedFilter {
  const kind = SCENARIO_FILTERS[field].kind;
  switch (kind) {
    case "range": return { kind: "range", field };
    case "enum": return { kind: "enum", field, value: [] };
    case "boolean": return { kind: "boolean", field, value: true };
    default: return { kind: "text", field, value: "" };
  }
}

export function ScenarioEditor({
  action,
  submitLabel,
  previewBasePath,
  initialName = "",
  initialFilters = [],
  initialSort = { field: "ask_vs_release_pct", dir: "asc" },
}: {
  action: (formData: FormData) => void | Promise<void>;
  submitLabel: string;
  /** Path the "Run" button previews against, e.g. "/scenarios/{id}" or
   *  "/scenarios/new". Omit to hide "Run" (save-only editors). */
  previewBasePath?: string;
  initialName?: string;
  initialFilters?: AppliedFilter[];
  initialSort?: { field: ScenarioSortField; dir: SortDir };
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [filters, setFilters] = useState<AppliedFilter[]>(initialFilters);
  const [sort, setSort] = useState(initialSort);

  const used = new Set(filters.map((filter) => filter.field));
  const addable = FIELD_ORDER.filter((field) => !used.has(field));

  const definition = useMemo(() => JSON.stringify({ filters, sort }), [filters, sort]);
  const hasValidFilter = useMemo(
    () => parseScenarioDefinition({ filters, sort }).filters.length > 0,
    [filters, sort],
  );

  function update(index: number, next: AppliedFilter) {
    setFilters((current) => current.map((filter, i) => (i === index ? next : filter)));
  }
  function remove(index: number) {
    setFilters((current) => current.filter((_, i) => i !== index));
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="definition" value={definition} />
      <label className="grid max-w-md gap-1 text-xs text-ink-muted">Scenario name
        <input name="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Biddable, ask within 10% of release" className="rounded border border-border px-3 py-2 text-sm text-ink" />
      </label>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Filters</p>
        {!hasValidFilter && <p className="text-sm text-ink-muted">Add at least one valid filter before this scenario can run.</p>}
        {filters.map((filter, index) => (
          <div key={filter.field} className="flex flex-wrap items-center gap-2 rounded border border-border bg-background p-2 text-sm">
            <span className="min-w-[9rem] font-medium">{(SCENARIO_FILTERS[filter.field as ScenarioFilterField] as FilterMeta).label}</span>
            <FilterControl filter={filter} onChange={(next) => update(index, next)} />
            <span className="text-xs text-ink-muted">{(SCENARIO_FILTERS[filter.field as ScenarioFilterField] as FilterMeta).units ?? ""}</span>
            <button type="button" onClick={() => remove(index)} className="ml-auto text-xs text-accent underline-offset-2 hover:underline">Remove</button>
          </div>
        ))}
        {addable.length > 0 && <select
          value=""
          onChange={(event) => { const field = event.target.value as ScenarioFilterField; if (field) setFilters((current) => [...current, defaultFilter(field)]); }}
          className="rounded border border-border px-2 py-2 text-sm text-ink"
        >
          <option value="">+ Add filter…</option>
          {addable.map((field) => <option key={field} value={field}>{SCENARIO_FILTERS[field].label}</option>)}
        </select>}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-ink-muted">Sort by
          <select value={sort.field} onChange={(event) => setSort((s) => ({ ...s, field: event.target.value as ScenarioSortField }))} className="rounded border border-border px-2 py-2 text-sm text-ink">
            {SCENARIO_SORT_FIELDS.map((field) => <option key={field} value={field}>{SCENARIO_SORT_LABELS[field]}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-ink-muted">Direction
          <select value={sort.dir} onChange={(event) => setSort((s) => ({ ...s, dir: event.target.value as SortDir }))} className="rounded border border-border px-2 py-2 text-sm text-ink">
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
        {previewBasePath && <button
          type="button"
          disabled={!hasValidFilter}
          onClick={() => router.push(scenarioPreviewHref(previewBasePath, { filters, sort }))}
          className="rounded border border-accent px-4 py-2 text-sm font-medium text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >Run</button>}
        <button type="submit" disabled={!hasValidFilter} className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:cursor-not-allowed disabled:opacity-50">{submitLabel}</button>
      </div>
    </form>
  );
}

function FilterControl({ filter, onChange }: { filter: AppliedFilter; onChange: (next: AppliedFilter) => void }) {
  if (filter.kind === "range") {
    return <>
      <input type="number" inputMode="decimal" value={filter.min ?? ""} placeholder="min" onChange={(event) => onChange({ ...filter, min: event.target.value === "" ? undefined : Number(event.target.value) })} className="w-24 rounded border border-border px-2 py-1.5 text-sm" />
      <span className="text-ink-muted">to</span>
      <input type="number" inputMode="decimal" value={filter.max ?? ""} placeholder="max" onChange={(event) => onChange({ ...filter, max: event.target.value === "" ? undefined : Number(event.target.value) })} className="w-24 rounded border border-border px-2 py-1.5 text-sm" />
      <label className="flex items-center gap-1 text-xs text-ink-muted" title="Also keep rows where this value is missing. Off by default, a range excludes them.">
        <input type="checkbox" checked={filter.includeNulls ?? false} onChange={(event) => onChange({ ...filter, includeNulls: event.target.checked || undefined })} />
        include missing
      </label>
    </>;
  }
  if (filter.kind === "boolean") {
    return <select value={filter.value ? "true" : "false"} onChange={(event) => onChange({ ...filter, value: event.target.value === "true" })} className="rounded border border-border px-2 py-1.5 text-sm">
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>;
  }
  if (filter.kind === "text") {
    return <input value={filter.value} onChange={(event) => onChange({ ...filter, value: event.target.value })} placeholder="text…" className="w-56 rounded border border-border px-2 py-1.5 text-sm" />;
  }
  if (filter.kind !== "enum") return null;
  if (filter.field === "anchor_status") {
    const selected = new Set(filter.value);
    return <span className="flex flex-wrap gap-2">
      {SCENARIO_ANCHOR_STATUSES.map((status) => <label key={status} className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={selected.has(status)} onChange={(event) => {
          const next = new Set(selected);
          if (event.target.checked) next.add(status); else next.delete(status);
          onChange({ ...filter, value: [...next] });
        }} />
        {status}
      </label>)}
    </span>;
  }
  return <input
    value={filter.value.join(", ")}
    onChange={(event) => onChange({ ...filter, value: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
    placeholder="comma-separated"
    className="w-56 rounded border border-border px-2 py-1.5 text-sm"
  />;
}
