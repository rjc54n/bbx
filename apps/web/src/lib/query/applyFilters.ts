import { recentListedRange, type ListedDays } from "./freshness";

// The one translation from a typed filter to PostgREST calls, shared by the
// catalogue browser (over catalogue_view) and saved scenarios (over
// wine_scenario_view). Kept structural — `field` is any column string — so the
// same engine serves both surfaces and, later, the agent's evaluation path.
export type AppliedFilter =
  | { kind: "enum"; field: string; value: string[] }
  | { kind: "range"; field: string; min?: number; max?: number; includeNulls?: boolean }
  | { kind: "date"; field: string; days?: ListedDays; min?: string; max?: string }
  | { kind: "text"; field: string; value: string }
  | { kind: "typeahead"; field: string; value: string }
  | { kind: "boolean"; field: string; value: boolean };

// PostgREST's or() takes a raw filter-syntax string, not a parameterised value,
// so a term containing "," or "(" would otherwise be read as filter syntax.
// Quote-wrap when a reserved character is present, mirroring how postgrest-js
// escapes values for .in().
const OR_FILTER_RESERVED_CHARS = /[,()]/;

export function buildSearchOrFilter(term: string): string {
  const pattern = `%${term}%`;
  const value = OR_FILTER_RESERVED_CHARS.test(pattern) ? `"${pattern}"` : pattern;
  return `name.ilike.${value},producer.ilike.${value}`;
}

// Applies each filter to the query in place and returns the same builder type.
// The internal `any` is contained here: `field` is a runtime column name, and
// the builder's methods return narrowed types that don't survive a reassignment
// loop, so callers keep their static type via the Q in/out signature.
export function applyFilters<Q>(query: Q, filters: readonly AppliedFilter[]): Q {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  for (const filter of filters) {
    switch (filter.kind) {
      case "enum":
        if (filter.value.length > 0) q = q.in(filter.field, filter.value);
        break;
      case "range": {
        if (filter.min === undefined && filter.max === undefined) break;
        if (filter.includeNulls) {
          // Keep rows in the bound(s) OR rows where the column is NULL, so a
          // range over a nullable derived column (ask_vs_release_pct, …) does
          // not silently become an "is not null" filter. The bounds stay AND'd
          // to each other inside the or() logic tree.
          const bounds: string[] = [];
          if (filter.min !== undefined) bounds.push(`${filter.field}.gte.${filter.min}`);
          if (filter.max !== undefined) bounds.push(`${filter.field}.lte.${filter.max}`);
          const inRange = bounds.length > 1 ? `and(${bounds.join(",")})` : bounds[0];
          q = q.or(`${inRange},${filter.field}.is.null`);
          break;
        }
        if (filter.min !== undefined) q = q.gte(filter.field, filter.min);
        if (filter.max !== undefined) q = q.lte(filter.field, filter.max);
        break;
      }
      case "date":
        if (filter.days !== undefined) {
          q = q.gte(filter.field, recentListedRange(filter.days).min);
          break;
        }
        if (filter.min !== undefined) q = q.gte(filter.field, filter.min);
        if (filter.max !== undefined) q = q.lte(filter.field, filter.max);
        break;
      case "text":
        if (filter.value) q = q.or(buildSearchOrFilter(filter.value));
        break;
      case "typeahead":
        if (filter.value) q = q.eq(filter.field, filter.value);
        break;
      case "boolean":
        q = q.eq(filter.field, filter.value);
        break;
    }
  }
  return q as Q;
}
