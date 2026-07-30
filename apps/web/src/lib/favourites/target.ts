// A favourite is one control with one meaning -- "I care about this wine".
// Which table it lands in only reflects whether we know the wine yet: a linked
// record favourites the Parent ID, an unlinked one holds the star against the
// source's match group until the link lands and the database promotes it.

export const FAVOURITE_SOURCES = ["cellartracker", "release_offer"] as const;

export type FavouriteSource = (typeof FAVOURITE_SOURCES)[number];

export type FavouriteTarget =
  | { kind: "wine"; parentSku: string }
  | { kind: "record"; source: FavouriteSource; matchGroupKey: string };

export const PARENT_SKU_PATTERN = /^\d{5,30}$/;

/** Mirrors the match_group_key length check on public.pending_favourites. */
const MATCH_GROUP_KEY_MAX_LENGTH = 1_100;

export function isFavouriteSource(value: string): value is FavouriteSource {
  return (FAVOURITE_SOURCES as readonly string[]).includes(value);
}

export function isValidFavouriteTarget(target: FavouriteTarget): boolean {
  if (target.kind === "wine") return PARENT_SKU_PATTERN.test(target.parentSku);
  return (
    isFavouriteSource(target.source)
    && target.matchGroupKey.length > 0
    && target.matchGroupKey.length <= MATCH_GROUP_KEY_MAX_LENGTH
  );
}

/**
 * The set of favourites a page holds, as the two tables expose them.
 * Pending keys are namespaced by source because the two sources derive
 * match_group_key from their own name text and can collide.
 */
export type FavouriteState = {
  parentSkus: ReadonlySet<string>;
  pendingKeys: ReadonlySet<string>;
};

export function pendingKey(source: FavouriteSource, matchGroupKey: string): string {
  return `${source}:${matchGroupKey}`;
}

export function buildFavouriteState(
  favouriteParentSkus: readonly string[],
  pending: readonly { source: string; match_group_key: string }[],
): FavouriteState {
  return {
    parentSkus: new Set(favouriteParentSkus),
    pendingKeys: new Set(
      pending
        .filter((row) => isFavouriteSource(row.source))
        .map((row) => pendingKey(row.source as FavouriteSource, row.match_group_key)),
    ),
  };
}

/**
 * A record shows as favourited when either its linked wine is favourited, or a
 * pending star is still held against its match group. Both are checked rather
 * than one or the other: an unlink writes the star back to the group without
 * removing the wine favourite, so the two states legitimately overlap.
 */
export function isFavourited(state: FavouriteState, target: FavouriteTarget): boolean {
  if (target.kind === "wine") return state.parentSkus.has(target.parentSku);
  return state.pendingKeys.has(pendingKey(target.source, target.matchGroupKey));
}

/**
 * What a source record's star should write to. A linked record favourites the
 * wine so the star propagates; an unlinked one falls back to its match group.
 */
export function targetForRecord(
  source: FavouriteSource,
  linkStatus: string | null,
  parentSku: string | null,
  matchGroupKey: string | null,
): FavouriteTarget | null {
  if (linkStatus === "linked" && parentSku) return { kind: "wine", parentSku };
  if (matchGroupKey) return { kind: "record", source, matchGroupKey };
  return null;
}
