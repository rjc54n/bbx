import { wineCoreTokens } from "./coreKey";
import type {
  CanonicalIdentity,
  IdentityComparisonInput,
  WineIdentityField,
} from "./identityTypes";

const WINE_NAME_ALIASES: Record<IdentityComparisonInput["source"], Record<string, string>> = {
  release_offer: { ch: "chateau", dom: "domaine" },
  cellartracker: { ch: "chateau", dom: "domaine" },
  catalogue: { ch: "chateau", dom: "domaine" },
};

function normalisedWords(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll("æ", "a")
    .replaceAll("œ", "o")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

export function canonicaliseWineIdentity(
  value: string,
  field: WineIdentityField,
  source: IdentityComparisonInput["source"],
): CanonicalIdentity {
  const transformations = new Set<string>();
  const words = normalisedWords(value).map((word) => {
    const replacement = field === "wine_name" ? WINE_NAME_ALIASES[source][word] : undefined;
    if (!replacement) return word;
    transformations.add(`alias:${word}:${replacement}`);
    return replacement;
  });
  const normalisedText = words.join(" ");
  return {
    tokens: wineCoreTokens(normalisedText),
    normalisedText,
    transformations: [...transformations].sort(),
  };
}

export function wineIdentityQueryVariants(
  value: string,
  field: WineIdentityField,
  source: IdentityComparisonInput["source"],
): string[] {
  const canonical = canonicaliseWineIdentity(value, field, source);
  if (canonical.transformations.length === 0 || canonical.normalisedText === normalisedWords(value).join(" ")) {
    return [value];
  }
  return [value, canonical.normalisedText].slice(0, 2);
}
