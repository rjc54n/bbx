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
const VINTAGE_TOKEN = /^(?:1[5-9]\d{2}|20\d{2})$/;

export interface CatalogueSearch {
  text: string;
  vintage?: string;
}

// Treat one standalone vintage-looking year as the catalogue's explicit
// vintage field, rather than requiring the stored wine name to contain it.
// The remaining text keeps the existing partial name-or-producer match, so
// both "2020 Batailley" and "Batailley 2020" produce the same query.
// Multiple years remain free text: a catalogue row has one vintage, and
// guessing whether the user meant an AND or an OR would make the result less
// predictable.
export function parseCatalogueSearch(value: string): CatalogueSearch {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  const vintageIndexes = tokens
    .map((token, index) => VINTAGE_TOKEN.test(token) ? index : -1)
    .filter((index) => index >= 0);
  if (vintageIndexes.length !== 1) return { text: tokens.join(" ") };

  const [vintageIndex] = vintageIndexes;
  return {
    text: tokens.filter((_, index) => index !== vintageIndex).join(" "),
    vintage: tokens[vintageIndex],
  };
}

export function buildSearchOrFilter(term: string): string {
  const pattern = `%${term}%`;
  const value = OR_FILTER_RESERVED_CHARS.test(pattern) ? `"${pattern}"` : pattern;
  return `name.ilike.${value},producer.ilike.${value}`;
}

// A phrase can span the separate wine-name and producer columns. Require every
// word, but let each word match either column: "lafarge bourgogne" can match a
// Lafarge producer and a Bourgogne wine name. PostgREST combines the nested
// OR groups with AND inside the single raw .or() expression.
export function buildSearchFilter(text: string): string {
  const terms = text.split(/\s+/).filter(Boolean);
  if (terms.length <= 1) return buildSearchOrFilter(terms[0] ?? "");
  return `and(${terms.map((term) => `or(${buildSearchOrFilter(term)})`).join(",")})`;
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
        if (filter.value) {
          const search = parseCatalogueSearch(filter.value);
          if (search.vintage) q = q.eq("vintage", search.vintage);
          if (search.text) q = q.or(buildSearchFilter(search.text));
        }
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
