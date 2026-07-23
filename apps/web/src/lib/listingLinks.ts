const BBR_ORIGIN = "https://www.bbr.com";
const WINE_SEARCHER_FIND_URL = "https://www.wine-searcher.com/find/";

/**
 * `product_url` is normally a BBR-relative product path from Algolia. Keep
 * the browser on the known BBR origin when a historical row contains a full
 * URL, rather than turning stored data into an arbitrary external link.
 */
export function bbrProductUrl(productUrl: string | null): string | undefined {
  const path = productUrl?.trim();
  if (!path) return undefined;

  try {
    const url = new URL(path, BBR_ORIGIN);
    return url.origin === BBR_ORIGIN ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function wineSearcherUrl(name: string | null, vintage: number | null): string | undefined {
  const wineName = name?.trim();
  if (!wineName) return undefined;
  const query = vintage === null ? wineName : `${wineName} ${vintage}`;
  return `${WINE_SEARCHER_FIND_URL}${encodeURIComponent(query)}`;
}
