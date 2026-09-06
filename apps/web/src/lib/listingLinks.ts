const BBR_ORIGIN = "https://www.bbr.com";
const WINE_SEARCHER_FIND_URL = "https://www.wine-searcher.com/find/";

export type BbrWineDestination = {
  url: string;
  kind: "product" | "search";
};

export function bbrProductDetailUrl(
  productUrl: string | null | undefined,
  parentSku: string,
): string | undefined {
  const path = productUrl?.trim();
  const sku = parentSku.trim();
  if (!path || !/^\d{5,30}$/.test(sku)) return undefined;

  try {
    const url = new URL(path, BBR_ORIGIN);
    const expectedPrefix = `/products-${sku}-`;
    return url.protocol === "https:"
      && url.origin === BBR_ORIGIN
      && url.pathname.startsWith(expectedPrefix)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function wineSearchQuery(name: string | null, vintage: number | null): string | undefined {
  const wineName = name?.trim();
  if (!wineName) return undefined;
  if (vintage === null || new RegExp(`(^|\\D)${vintage}(\\D|$)`).test(wineName)) {
    return wineName;
  }
  return `${wineName} ${vintage}`;
}

export function bbrSearchUrl(name: string | null, vintage: number | null): string | undefined {
  const query = wineSearchQuery(name, vintage);
  return query ? `${BBR_ORIGIN}/?q=${encodeURIComponent(query)}` : undefined;
}

export function bbrWineDestination({
  parentSku,
  name,
  vintage,
  productUrls,
}: {
  parentSku: string;
  name: string | null;
  vintage: number | null;
  productUrls: readonly (string | null | undefined)[];
}): BbrWineDestination {
  for (const productUrl of productUrls) {
    const url = bbrProductDetailUrl(productUrl, parentSku);
    if (url) return { url, kind: "product" };
  }

  return {
    url: bbrSearchUrl(name, vintage)
      ?? `${BBR_ORIGIN}/?q=${encodeURIComponent(parentSku)}`,
    kind: "search",
  };
}

export function wineSearcherUrl(name: string | null, vintage: number | null): string | undefined {
  const query = wineSearchQuery(name, vintage);
  if (!query) return undefined;
  return `${WINE_SEARCHER_FIND_URL}${encodeURIComponent(query)}`;
}
