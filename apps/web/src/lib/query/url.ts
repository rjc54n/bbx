import {
  CATALOGUE_FILTERS,
  CATALOGUE_METRICS,
  PRICE_CHANGE_SORT_FIELDS,
  type CatalogueFilterField,
  type CatalogueMetricField,
  type PriceChangeSortField,
} from "./registry";
import { STARTING_POINTS, startingPointFor } from "./startingPoints";
import type { CatalogueFilter, QueryMode, QueryState, SortDir } from "./types";

// Bump when the param scheme changes in a way parse() can't stay
// backwards-compatible with (e.g. a filter kind's on-the-wire shape changes).
// Not enforced on read yet -- see parse() -- but it's there so Phase E saved
// queries and shared URLs have a documented anchor for a future migration.
const URL_VERSION = "1";

const VALID_MODES = new Set<QueryMode>(STARTING_POINTS.map((sp) => sp.mode));
const CATALOGUE_SORT_FIELDS = new Set(Object.keys(CATALOGUE_METRICS));

function isMode(value: string | null): value is QueryMode {
  return value !== null && VALID_MODES.has(value as QueryMode);
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value));
}

function parsePage(raw: string | null): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function parseSortDir(raw: string | undefined): SortDir {
  return raw === "asc" ? "asc" : "desc";
}

function parseCatalogueSort(raw: string | null): { field: CatalogueMetricField; dir: SortDir } | undefined {
  if (!raw) return undefined;
  const sep = raw.indexOf(":");
  const field = sep === -1 ? raw : raw.slice(0, sep);
  if (!CATALOGUE_SORT_FIELDS.has(field)) return undefined;
  return { field: field as CatalogueMetricField, dir: parseSortDir(raw.slice(sep + 1)) };
}

function parsePriceChangeSort(raw: string | null): { field: PriceChangeSortField; dir: SortDir } | undefined {
  if (!raw) return undefined;
  const sep = raw.indexOf(":");
  const field = sep === -1 ? raw : raw.slice(0, sep);
  if (!(PRICE_CHANGE_SORT_FIELDS as readonly string[]).includes(field)) return undefined;
  return { field: field as PriceChangeSortField, dir: parseSortDir(raw.slice(sep + 1)) };
}

// Reversed bounds (min > max) are swapped rather than dropped -- both values
// came from the user/URL and neither is more "wrong" than the other.
// Non-finite values (NaN, Infinity, empty string) are dropped silently.
function parseRangeBounds(
  minRaw: string | null,
  maxRaw: string | null,
): { min?: number; max?: number } | undefined {
  let min = minRaw !== null && minRaw !== "" && Number.isFinite(Number(minRaw)) ? Number(minRaw) : undefined;
  let max = maxRaw !== null && maxRaw !== "" && Number.isFinite(Number(maxRaw)) ? Number(maxRaw) : undefined;
  if (min !== undefined && max !== undefined && min > max) {
    [min, max] = [max, min];
  }
  if (min === undefined && max === undefined) return undefined;
  return { min, max };
}

function parseCatalogueFilters(params: URLSearchParams): CatalogueFilter[] {
  const filters: CatalogueFilter[] = [];

  for (const field of Object.keys(CATALOGUE_FILTERS) as CatalogueFilterField[]) {
    const meta = CATALOGUE_FILTERS[field];
    switch (meta.kind) {
      case "enum": {
        const raw = params.get(field);
        if (raw === null) break;
        const value = [...new Set(raw.split(",").map((v) => v.trim()).filter(Boolean))].sort();
        if (value.length > 0) {
          filters.push({ field, kind: "enum", value } as CatalogueFilter);
        }
        break;
      }
      case "range": {
        const bounds = parseRangeBounds(params.get(`${field}_min`), params.get(`${field}_max`));
        if (bounds) filters.push({ field, kind: "range", ...bounds } as CatalogueFilter);
        break;
      }
      case "date": {
        const minRaw = params.get(`${field}_min`);
        const maxRaw = params.get(`${field}_max`);
        const min = minRaw && isValidIsoDate(minRaw) ? minRaw : undefined;
        const max = maxRaw && isValidIsoDate(maxRaw) ? maxRaw : undefined;
        if (min !== undefined || max !== undefined) {
          filters.push({ field, kind: "date", min, max } as CatalogueFilter);
        }
        break;
      }
      case "text": {
        const raw = params.get(field);
        if (raw) filters.push({ field, kind: "text", value: raw } as CatalogueFilter);
        break;
      }
      case "typeahead": {
        const raw = params.get(field);
        if (raw) filters.push({ field, kind: "typeahead", value: raw } as CatalogueFilter);
        break;
      }
    }
  }

  return filters;
}

export function serialize(state: QueryState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("v", URL_VERSION);
  params.set("mode", state.mode);
  params.set("sort", `${state.sort.field}:${state.sort.dir}`);
  if (state.page > 0) params.set("page", String(state.page));

  if (state.mode === "price-changes") return params;

  // One canonical filter per field: later entries for the same field win.
  // Deterministic (array order decides), unlike letting params.set() silently
  // overwrite an earlier value mid-loop with no defined precedence.
  const byField = new Map<CatalogueFilterField, CatalogueFilter>();
  for (const filter of state.filters) byField.set(filter.field, filter);

  for (const filter of byField.values()) {
    switch (filter.kind) {
      case "enum": {
        const values = [...new Set(filter.value)].sort();
        if (values.length > 0) params.set(filter.field, values.join(","));
        break;
      }
      case "range": {
        if (filter.min !== undefined && Number.isFinite(filter.min)) {
          params.set(`${filter.field}_min`, String(filter.min));
        }
        if (filter.max !== undefined && Number.isFinite(filter.max)) {
          params.set(`${filter.field}_max`, String(filter.max));
        }
        break;
      }
      case "date": {
        if (filter.min && isValidIsoDate(filter.min)) params.set(`${filter.field}_min`, filter.min);
        if (filter.max && isValidIsoDate(filter.max)) params.set(`${filter.field}_max`, filter.max);
        break;
      }
      case "text":
      case "typeahead":
        if (filter.value) params.set(filter.field, filter.value);
        break;
    }
  }

  return params;
}

// Mode-first: resolve the mode, load that mode's starting-point defaults,
// then overlay only the URL values that validate against that mode's own
// allowed sort fields/filter shapes. A bare `?mode=price-changes` (no sort
// param) must fall back to price-changes' own default sort (observed_at),
// never a catalogue field like last_seen_at -- see docs/PHASE2-catalogue-browser.md
// Phase B.
export function parse(params: URLSearchParams): QueryState {
  const modeParam = params.get("mode");
  const mode: QueryMode = isMode(modeParam) ? modeParam : "explore";
  const fallback = startingPointFor(mode).initialState;
  const page = parsePage(params.get("page"));

  if (fallback.mode === "price-changes") {
    const sort = parsePriceChangeSort(params.get("sort")) ?? fallback.sort;
    return { mode: "price-changes", filters: [], sort, page };
  }

  const sort = parseCatalogueSort(params.get("sort")) ?? fallback.sort;
  const filters = parseCatalogueFilters(params);
  return { mode: fallback.mode, filters, sort, page };
}
