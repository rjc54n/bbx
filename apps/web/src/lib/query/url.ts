import { FILTERS } from "./registry";
import type {
  DateFilter,
  Filter,
  QueryMode,
  QueryState,
  RangeFilter,
  SortDir,
  SortState,
} from "./types";

const MODES: QueryMode[] = ["explore", "value-research", "recent-listings", "price-changes"];
const DEFAULT_SORT: SortState = { field: "last_seen_at", dir: "desc" };

function isMode(value: string | null): value is QueryMode {
  return value !== null && (MODES as string[]).includes(value);
}

export function serialize(state: QueryState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("mode", state.mode);
  params.set("sort", `${state.sort.field}:${state.sort.dir}`);
  if (state.page > 0) params.set("page", String(state.page));

  for (const filter of state.filters) {
    switch (filter.kind) {
      case "enum":
        if (filter.value.length > 0) params.set(filter.field, filter.value.join(","));
        break;
      case "range":
        if (filter.min !== undefined) params.set(`${filter.field}_min`, String(filter.min));
        if (filter.max !== undefined) params.set(`${filter.field}_max`, String(filter.max));
        break;
      case "date":
        if (filter.min !== undefined) params.set(`${filter.field}_min`, filter.min);
        if (filter.max !== undefined) params.set(`${filter.field}_max`, filter.max);
        break;
      case "text":
        if (filter.value) params.set(filter.field, filter.value);
        break;
      case "bool":
        params.set(filter.field, filter.value ? "1" : "0");
        break;
    }
  }

  return params;
}

export function parse(params: URLSearchParams): QueryState {
  const modeParam = params.get("mode");
  const mode: QueryMode = isMode(modeParam) ? modeParam : "explore";

  const sortParam = params.get("sort");
  let sort: SortState = DEFAULT_SORT;
  if (sortParam) {
    const [field, dirRaw] = sortParam.split(":");
    if (field) {
      const dir: SortDir = dirRaw === "asc" ? "asc" : "desc";
      sort = { field, dir };
    }
  }

  const pageRaw = Number(params.get("page"));
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 0;

  const filters: Filter[] = [];

  for (const [field, meta] of Object.entries(FILTERS)) {
    switch (meta.kind) {
      case "enum": {
        const raw = params.get(field);
        if (raw === null) break;
        const value = raw.split(",").filter(Boolean);
        if (value.length > 0) filters.push({ field, kind: "enum", value });
        break;
      }
      case "range": {
        const minRaw = params.get(`${field}_min`);
        const maxRaw = params.get(`${field}_max`);
        if (minRaw === null && maxRaw === null) break;
        const filter: RangeFilter = { field, kind: "range" };
        if (minRaw !== null && minRaw !== "" && Number.isFinite(Number(minRaw))) {
          filter.min = Number(minRaw);
        }
        if (maxRaw !== null && maxRaw !== "" && Number.isFinite(Number(maxRaw))) {
          filter.max = Number(maxRaw);
        }
        if (filter.min !== undefined || filter.max !== undefined) filters.push(filter);
        break;
      }
      case "date": {
        const minRaw = params.get(`${field}_min`);
        const maxRaw = params.get(`${field}_max`);
        if (minRaw === null && maxRaw === null) break;
        const filter: DateFilter = { field, kind: "date" };
        if (minRaw) filter.min = minRaw;
        if (maxRaw) filter.max = maxRaw;
        if (filter.min !== undefined || filter.max !== undefined) filters.push(filter);
        break;
      }
      case "text": {
        const raw = params.get(field);
        if (raw) filters.push({ field, kind: "text", value: raw });
        break;
      }
      case "bool": {
        const raw = params.get(field);
        if (raw !== null) filters.push({ field, kind: "bool", value: raw === "1" });
        break;
      }
    }
  }

  return { mode, filters, sort, page };
}
