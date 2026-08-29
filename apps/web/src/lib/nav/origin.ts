// Wine cards are reached from several list and record pages. Each link carries
// the originating in-app location as a `from` param so the card can offer a
// "Back to results" control that returns to the exact view -- filters, sort,
// page and (via useScrollMemory) scroll position -- rather than a browser Back
// that lands on a reset page.

export const ORIGIN_PARAM = "from";

// A `from` value is only ever used as a client-side navigation target, so it
// must be a same-origin relative path: it has to start with a single "/" and
// must not begin "//" or "/\" (both are treated as protocol-relative by
// browsers). Anything else is dropped and the card falls back to router.back().
export function readOrigin(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value[0] !== "/" || value[1] === "/" || value[1] === "\\") return null;
  return value;
}

// Builds "/path?a=b" from a pathname and its current search params, omitting the
// "?" when there is no query. Used by client list pages that read their state
// from the URL.
export function currentLocation(pathname: string, search: URLSearchParams | string): string {
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

// The href for a wine card, tagging on the originating location so the card can
// render a "Back to results" link. `from` is encoded once here.
export function wineHref(parentSku: string, from?: string | null): string {
  const base = `/wine/parent/${parentSku}`;
  const origin = readOrigin(from);
  return origin ? `${base}?${ORIGIN_PARAM}=${encodeURIComponent(origin)}` : base;
}
