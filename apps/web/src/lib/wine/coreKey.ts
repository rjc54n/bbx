/**
 * Shared wine-identity primitives.
 *
 * BBR renders a wine as "<vintage> <name>, <producer>, <geography>", with the
 * geographic tail varying in depth between renderings of the same wine. Both
 * import sources have to compare against that shape, so the normalisation and
 * the geography stripping live here rather than in either source's module.
 */

/**
 * Articles and conjunctions only. Producer words such as "chateau", "domaine"
 * and "tenuta" are deliberately kept: dropping them collapses "Chateau Margaux"
 * to the Margaux appellation, which matches every Margaux property.
 */
const CORE_STOPWORDS = new Set(
  "de du des da di do dos del della delle la le les el il al lo the a an and et e y und von van der den ter".split(" "),
);

const VINTAGE_TOKEN = /^(?:18|19|20)\d{2}$/;

/** Sorted, distinct identity tokens. */
export function wineCoreTokens(value: string | null | undefined): string[] {
  const words = (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll("æ", "a")
    .replaceAll("œ", "o")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ");
  const kept = words.filter((word) => word && !CORE_STOPWORDS.has(word) && !VINTAGE_TOKEN.test(word));
  return [...new Set(kept)].sort();
}

export function coreKey(tokens: readonly string[]): string {
  return tokens.join(" ");
}

/** F1 over the two token sets: 2|A n B| / (|A| + |B|). */
export function coreKeyScore(source: readonly string[], candidate: readonly string[]): number {
  if (source.length === 0 || candidate.length === 0) return 0;
  const candidateTokens = new Set(candidate);
  const shared = source.filter((token) => candidateTokens.has(token)).length;
  if (shared === 0) return 0;
  return (2 * shared) / (source.length + candidate.length);
}

export function sharedTokenCount(source: readonly string[], candidate: readonly string[]): number {
  const candidateTokens = new Set(candidate);
  return source.filter((token) => candidateTokens.has(token)).length;
}

/** The tokens a catalogue record itself declares as its geography. */
export function geographyTokens(...values: Array<string | null | undefined>): Set<string> {
  return new Set(wineCoreTokens(values.filter(Boolean).join(" ")));
}

function isGeographic(segment: string, geography: ReadonlySet<string>): boolean {
  const tokens = wineCoreTokens(segment);
  return tokens.length > 0 && tokens.every((token) => geography.has(token));
}

/**
 * Removes comma segments that only restate the record's own geography, so two
 * renderings of the same wine with different geographic depth compare equal.
 *
 * Segments are dropped whole rather than token by token, and the first segment
 * is never dropped: removing geography tokens individually would reduce
 * "2015 Chateau Margaux, Margaux, Bordeaux" to "chateau".
 *
 * `trailingOnly` stops at the first segment that carries identity, which is the
 * conservative reading — a geographic segment sitting mid-name may be the only
 * thing separating two cuvees. Pass `false` when the source holds its geography
 * in separate columns and cannot be relied on to order the name the same way.
 */
export function stripGeographicSegments(
  name: string | null | undefined,
  geography: ReadonlySet<string>,
  { trailingOnly = true }: { trailingOnly?: boolean } = {},
): string {
  const segments = (name ?? "").split(",");
  if (!trailingOnly) {
    return segments
      .filter((segment, index) => index === 0 || !isGeographic(segment, geography))
      .join(",");
  }
  let end = segments.length;
  while (end > 1) {
    const tokens = wineCoreTokens(segments[end - 1]);
    if (tokens.length > 0 && !isGeographic(segments[end - 1], geography)) break;
    end -= 1;
  }
  return segments.slice(0, end).join(",");
}
