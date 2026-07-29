import { releaseWineMatchKey } from "@/lib/releaseOffers/parser";

/**
 * CellarTracker commonly prefixes its Wine field with the Producer field,
 * while BBR commonly puts the producer later in the product name. Removing a
 * leading producer gives Algolia the distinctive cuvee or property name. Exact
 * matching still compares the full source and candidate identities.
 */
export function cellarTrackerCatalogueQuery(sourceWine: string, sourceProducer: string | null): string {
  const wineKey = releaseWineMatchKey(sourceWine);
  const producerKey = sourceProducer ? releaseWineMatchKey(sourceProducer) : "";
  if (!producerKey || wineKey === producerKey || !wineKey.startsWith(`${producerKey} `)) {
    return sourceWine;
  }
  const remainder = wineKey.slice(producerKey.length + 1).trim();
  return remainder.length >= 3 ? remainder : sourceWine;
}
